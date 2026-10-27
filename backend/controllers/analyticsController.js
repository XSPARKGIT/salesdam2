import mongoose from 'mongoose';
import DynamicRecord from '../models/DynamicRecord.js';
import ObjectMeta from '../models/ObjectMeta.js';
import User from '../models/User.js';
import { asyncHandler, sendSuccess, AppError } from '../utils/errors.js';

/**
 * GET /api/analytics/overview
 * Tenant-level summary stats.
 */
const getOverview = asyncHandler(async (req, res) => {
  const tenantId = req.tenantId;

  const [objectCount, userCount, recordCounts] = await Promise.all([
    ObjectMeta.countDocuments({ tenantId, isActive: true }),
    User.countDocuments({ tenantId, status: 'active' }),
    DynamicRecord.aggregate([
      {
        $match: {
          tenantId: mongoose.Types.ObjectId.createFromHexString(tenantId),
          isDeleted: false,
        },
      },
      { $group: { _id: '$objectApiName', count: { $sum: 1 } } },
    ]),
  ]);

  const totalRecords = recordCounts.reduce((sum, r) => sum + r.count, 0);

  sendSuccess(res, {
    data: {
      objects: objectCount,
      users: userCount,
      totalRecords,
      recordsByObject: recordCounts,
    },
  });
});

/**
 * POST /api/analytics/report
 * Dynamic aggregation report.
 * Body: { objectApiName, groupBy, aggregations, filters, dateRange }
 */
const runReport = asyncHandler(async (req, res) => {
  const {
    objectApiName,
    groupBy,
    aggregations = [],
    filters = {},
    dateRange,
    limit = 100,
    // Cross-object reporting: join to a related object via a lookup/master-detail field
    relatedLookup, // { field: 'deal', object: 'deal' }
    relatedGroupBy, // field on the related object to group by, e.g. 'stage'
  } = req.body;

  if (!objectApiName) throw new AppError('objectApiName is required.', 400);

  const obj = await ObjectMeta.findOne({
    tenantId: req.tenantId,
    apiName: objectApiName,
  });
  if (!obj) throw new AppError(`Object "${objectApiName}" not found.`, 404);

  const tenantObjId = mongoose.Types.ObjectId.createFromHexString(req.tenantId);

  // Build $match stage
  const match = {
    tenantId: tenantObjId,
    objectApiName,
    isDeleted: false,
  };

  // Apply field filters
  Object.entries(filters).forEach(([field, value]) => {
    if (value !== null && value !== undefined) {
      match[`data.${field}`] = value;
    }
  });

  // Date range
  if (dateRange?.field) {
    match[`data.${dateRange.field}`] = {};
    if (dateRange.from)
      match[`data.${dateRange.field}`].$gte = new Date(dateRange.from);
    if (dateRange.to)
      match[`data.${dateRange.field}`].$lte = new Date(dateRange.to);
  }

  const pipeline = [{ $match: match }];

  // Cross-object join: attach the related record (one lookup/master-detail hop)
  if (relatedLookup?.field && relatedLookup?.object) {
    pipeline.push({
      $lookup: {
        from: 'dynamicrecords',
        let: { relatedId: { $toObjectId: `$data.${relatedLookup.field}` } },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ['$_id', '$$relatedId'] },
              tenantId: tenantObjId,
              objectApiName: relatedLookup.object,
              isDeleted: false,
            },
          },
          { $project: { data: 1 } },
        ],
        as: '_related',
      },
    });
    pipeline.push({ $unwind: { path: '$_related', preserveNullAndEmptyArrays: true } });
  }

  // Determine the effective group-by path
  const groupPath =
    relatedLookup?.field && relatedGroupBy
      ? `$_related.data.${relatedGroupBy}`
      : groupBy
        ? `$data.${groupBy}`
        : null;

  // Group stage
  if (groupPath) {
    const groupStage = { _id: groupPath };

    aggregations.forEach(({ field, func, alias }) => {
      const key = alias || `${func}_${field}`;
      if (func === 'count') groupStage[key] = { $sum: 1 };
      else if (func === 'sum') groupStage[key] = { $sum: `$data.${field}` };
      else if (func === 'avg') groupStage[key] = { $avg: `$data.${field}` };
      else if (func === 'min') groupStage[key] = { $min: `$data.${field}` };
      else if (func === 'max') groupStage[key] = { $max: `$data.${field}` };
    });

    pipeline.push({ $group: groupStage });
    pipeline.push({ $sort: { count: -1 } });
  } else if (aggregations.length > 0) {
    // Global aggregation without grouping
    const groupStage = { _id: null };
    aggregations.forEach(({ field, func, alias }) => {
      const key = alias || `${func}_${field}`;
      if (func === 'count') groupStage[key] = { $sum: 1 };
      else if (func === 'sum') groupStage[key] = { $sum: `$data.${field}` };
      else if (func === 'avg') groupStage[key] = { $avg: `$data.${field}` };
      else if (func === 'min') groupStage[key] = { $min: `$data.${field}` };
      else if (func === 'max') groupStage[key] = { $max: `$data.${field}` };
    });
    pipeline.push({ $group: groupStage });
  }

  pipeline.push({ $limit: Math.min(parseInt(limit), 1000) });

  const results = await DynamicRecord.aggregate(pipeline);

  sendSuccess(res, {
    data: {
      results,
      objectApiName,
      groupBy,
      total: results.length,
    },
  });
});

/**
 * GET /api/analytics/records-over-time?objectApiName=contact&interval=day&days=30
 */
const recordsOverTime = asyncHandler(async (req, res) => {
  const { objectApiName, interval = 'day', days = 30 } = req.query;

  const since = new Date();
  since.setDate(since.getDate() - parseInt(days));

  const dateFormat =
    interval === 'month' ? '%Y-%m' : interval === 'week' ? '%Y-%U' : '%Y-%m-%d';

  const match = {
    tenantId: mongoose.Types.ObjectId.createFromHexString(req.tenantId),
    isDeleted: false,
    createdAt: { $gte: since },
  };
  if (objectApiName) match.objectApiName = objectApiName;

  const results = await DynamicRecord.aggregate([
    { $match: match },
    {
      $group: {
        _id: { $dateToString: { format: dateFormat, date: '$createdAt' } },
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  sendSuccess(res, { data: results });
});

/**
 * GET /api/analytics/salesdam-home
 * Salesdam home dashboard data: annual revenue target, open deals, income projection, orders to deliver.
 */
const getSalesdamHome = asyncHandler(async (req, res) => {
  const tenantId = req.tenantId;
  const tenantObjId = mongoose.Types.ObjectId.createFromHexString(tenantId);

  // Load tenant for settings
  const Tenant = (await import('../models/Tenant.js')).default;
  const tenant = await Tenant.findById(tenantId).select(
    'revenueTargets companyProfile salesdamDashboardConfig',
  );

  const fyStartMonth =
    (tenant?.companyProfile?.financialYearStartMonth || 1) - 1; // 0-based
  const now = new Date();
  let fyStart = new Date(now.getFullYear(), fyStartMonth, 1);
  if (fyStart > now) fyStart = new Date(now.getFullYear() - 1, fyStartMonth, 1);
  let fyEnd = new Date(fyStart.getFullYear() + 1, fyStartMonth, 0, 23, 59, 59);

  const rt = tenant?.revenueTargets || {};
  const annualTarget =
    (rt.q1 || 0) + (rt.q2 || 0) + (rt.q3 || 0) + (rt.q4 || 0);

  // Sum order_value from orders with invoice_date within FY
  const revenueAgg = await DynamicRecord.aggregate([
    {
      $match: {
        tenantId: tenantObjId,
        objectApiName: 'order',
        isDeleted: false,
        'data.invoice_date': { $gte: fyStart, $lte: fyEnd },
      },
    },
    { $group: { _id: null, total: { $sum: { $toDouble: '$data.order_value' } } } },
  ]);
  const revenueActual = revenueAgg[0]?.total || 0;
  const revenuePercent =
    annualTarget > 0
      ? Math.round((revenueActual / annualTarget) * 100)
      : 0;

  // Work in Progress deals about to close (next 10 days)
  const in10Days = new Date(now);
  in10Days.setDate(in10Days.getDate() + 10);
  const openDeals = await DynamicRecord.aggregate([
    {
      $match: {
        tenantId: tenantObjId,
        objectApiName: 'deal',
        isDeleted: false,
        'data.stage': 'work_in_progress',
        'data.closing_date': { $gte: now, $lte: in10Days },
      },
    },
    {
      $lookup: {
        from: 'dynamicrecords',
        let: { clientId: { $toObjectId: '$data.client' } },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ['$_id', '$$clientId'] },
              tenantId: tenantObjId,
              isDeleted: false,
            },
          },
          { $project: { 'data.name': 1 } },
        ],
        as: 'clientData',
      },
    },
    { $sort: { 'data.closing_date': 1 } },
    { $limit: 20 },
  ]);

  const openDealsData = openDeals.map((r) => {
    const d = r.data || {};
    const clientName =
      r.clientData?.[0]?.data?.name ||
      d.client ||
      '—';
    const closingDate = d.closing_date ? new Date(d.closing_date) : null;
    const countdown = closingDate
      ? Math.ceil((closingDate - now) / 86400000)
      : null;
    return {
      id: r._id,
      name: d.name,
      client: clientName,
      closingDate: d.closing_date,
      countdown,
    };
  });

  // Income projection: sum order_value from orders with payment_date within FY
  // Calculate payment dates based on invoice_date + payment_terms
  const projOrders = await DynamicRecord.find({
    tenantId: tenantObjId,
    objectApiName: 'order',
    isDeleted: false,
    'data.invoice_date': { $exists: true, $ne: null },
    'data.payment_terms': { $exists: true, $ne: null },
    'data.order_value': { $exists: true, $ne: null },
  })
    .select('data.invoice_date data.payment_terms data.order_value')
    .lean();

  let incomeProjection = 0;
  projOrders.forEach((order) => {
    const invoiceDate = new Date(order.data.invoice_date);
    const paymentTerms = parseInt(order.data.payment_terms) || 0;

    // Calculate payment date: invoice_date + payment_terms days, then last day of that month
    const paymentDate = new Date(invoiceDate);
    paymentDate.setDate(paymentDate.getDate() + paymentTerms);
    // Get last day of the month
    const lastDayOfMonth = new Date(paymentDate.getFullYear(), paymentDate.getMonth() + 1, 0);

    // Check if payment date falls within fiscal year
    if (lastDayOfMonth >= fyStart && lastDayOfMonth <= fyEnd) {
      const orderValue = parseFloat(order.data.order_value) || 0;
      incomeProjection += orderValue;
    }
  });

  // Orders to deliver in next 10 days (use order with delivery_date within 10 days)
  const in10 = new Date(now);
  in10.setDate(in10.getDate() + 10);
  const ordersRaw = await DynamicRecord.aggregate([
    {
      $match: {
        tenantId: tenantObjId,
        objectApiName: 'order',
        isDeleted: false,
        'data.delivery_date': { $gte: now, $lte: in10 },
      },
    },
    {
      $lookup: {
        from: 'dynamicrecords',
        let: { clientId: { $toObjectId: '$data.client' } },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ['$_id', '$$clientId'] },
              tenantId: tenantObjId,
              isDeleted: false,
            },
          },
          { $project: { 'data.name': 1 } },
        ],
        as: 'clientData',
      },
    },
    { $sort: { 'data.delivery_date': 1 } },
    { $limit: 20 },
  ]);

  const ordersData = ordersRaw.map((r) => {
    const d = r.data || {};
    const clientName =
      r.clientData?.[0]?.data?.name ||
      d.client ||
      '—';
    const deliveryDate = d.delivery_date ? new Date(d.delivery_date) : null;
    const countdown = deliveryDate
      ? Math.ceil((deliveryDate - now) / 86400000)
      : null;
    return {
      id: r._id,
      name: d.name,
      client: clientName,
      deliveryDate: d.delivery_date,
      countdown,
    };
  });

  sendSuccess(res, {
    data: {
      annualTarget,
      revenueActual,
      revenuePercent,
      fyStart,
      fyEnd,
      incomeProjection: Math.round(incomeProjection),
      openDeals: openDealsData,
      ordersToDeliver: ordersData,
    },
  });
});

/**
 * GET /api/analytics/salesdam-orders
 * Orders dashboard: quarterly orders targets + actual, total revenue per month.
 */
const getSalesdamOrders = asyncHandler(async (req, res) => {
  const tenantId = req.tenantId;
  const tenantObjId = mongoose.Types.ObjectId.createFromHexString(tenantId);

  const Tenant = (await import('../models/Tenant.js')).default;
  const tenant = await Tenant.findById(tenantId).select(
    'revenueTargets salesTargets companyProfile salesdamDashboardConfig',
  );

  const fyStart = (tenant?.companyProfile?.financialYearStartMonth || 1) - 1;
  const now = new Date();
  let fy = new Date(now.getFullYear(), fyStart, 1);
  if (fy > now) fy = new Date(now.getFullYear() - 1, fyStart, 1);
  const fyEnd = new Date(fy.getFullYear() + 1, fyStart, 0, 23, 59, 59);

  // Quarterly actuals (orders within each quarter of FY based on invoice_date)
  const quarters = [0, 1, 2, 3].map((i) => {
    const qStart = new Date(fy.getFullYear(), fyStart + i * 3, 1);
    const qEnd = new Date(fy.getFullYear(), fyStart + i * 3 + 3, 0, 23, 59, 59);
    return { qStart, qEnd };
  });

  const quarterActuals = await Promise.all(
    quarters.map(async ({ qStart, qEnd }) => {
      const agg = await DynamicRecord.aggregate([
        {
          $match: {
            tenantId: tenantObjId,
            objectApiName: 'order',
            isDeleted: false,
            'data.invoice_date': { $gte: qStart, $lte: qEnd },
          },
        },
        {
          $group: { _id: null, total: { $sum: { $toDouble: '$data.order_value' } } },
        },
      ]);
      return agg[0]?.total || 0;
    }),
  );

  const rt = tenant?.revenueTargets || {};
  const st = tenant?.salesTargets || {};
  const qTargets = [rt.q1 || 0, rt.q2 || 0, rt.q3 || 0, rt.q4 || 0];
  const sqTargets = [st.q1 || 0, st.q2 || 0, st.q3 || 0, st.q4 || 0];

  const annualTarget = qTargets.reduce((a, b) => a + b, 0);
  const annualActual = quarterActuals.reduce((a, b) => a + b, 0);
  const annualPercent =
    annualTarget > 0
      ? Math.min(100, Math.round((annualActual / annualTarget) * 100))
      : 0;

  // Annual target to-date filter (from saved config or FY start → now) - using orders with invoice_date
  const cfg = tenant?.salesdamDashboardConfig || {};
  const atdFrom = cfg.annualTargetFromDate
    ? new Date(cfg.annualTargetFromDate)
    : fy;
  const atdTo = cfg.annualTargetToDate ? new Date(cfg.annualTargetToDate) : now;
  const atdAgg = await DynamicRecord.aggregate([
    {
      $match: {
        tenantId: tenantObjId,
        objectApiName: 'order',
        isDeleted: false,
        'data.invoice_date': { $gte: atdFrom, $lte: atdTo },
      },
    },
    { $group: { _id: null, total: { $sum: { $toDouble: '$data.order_value' } } } },
  ]);
  const annualToDate = atdAgg[0]?.total || 0;

  // Calculate previous FY dates
  const prevFyStart = new Date(fy.getFullYear() - 1, fyStart, 1);
  const prevFyEnd = new Date(prevFyStart.getFullYear() + 1, fyStart, 0, 23, 59, 59);

  // Monthly revenue for current FY (using orders with order_value and invoice_date)
  const monthlyAgg = await DynamicRecord.aggregate([
    {
      $match: {
        tenantId: tenantObjId,
        objectApiName: 'order',
        isDeleted: false,
        'data.invoice_date': { $gte: fy, $lte: fyEnd },
      },
    },
    {
      $group: {
        _id: {
          $dateToString: {
            format: '%Y-%m',
            date: { $toDate: '$data.invoice_date' },
          },
        },
        total: { $sum: { $toDouble: '$data.order_value' } },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  // Monthly revenue for previous FY
  const prevMonthlyAgg = await DynamicRecord.aggregate([
    {
      $match: {
        tenantId: tenantObjId,
        objectApiName: 'order',
        isDeleted: false,
        'data.invoice_date': { $gte: prevFyStart, $lte: prevFyEnd },
      },
    },
    {
      $group: {
        _id: {
          $dateToString: {
            format: '%Y-%m',
            date: { $toDate: '$data.invoice_date' },
          },
        },
        total: { $sum: { $toDouble: '$data.order_value' } },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  // Calculate current quarter (0-3 where 0 is Q1)
  const currentMonth = now.getMonth();
  const fyStartMonth = tenant?.companyProfile?.financialYearStartMonth || 1;
  const monthsFromFYStart =
    (currentMonth - (fyStartMonth - 1) + 12) % 12;
  const currentQuarter = Math.floor(monthsFromFYStart / 3);

  // Calculate current quarter start and end dates
  const qStart = new Date(fy.getFullYear(), fyStart + currentQuarter * 3, 1);
  const qEnd = new Date(
    fy.getFullYear(),
    fyStart + currentQuarter * 3 + 3,
    0,
    23,
    59,
    59
  );

  // Format monthly data for comparison (current vs previous year by month)
  const currentYearMap = new Map();
  const prevYearMap = new Map();

  monthlyAgg.forEach((r) => {
    const monthPart = r._id.split('-')[1]; // Get MM from YYYY-MM
    currentYearMap.set(monthPart, r.total || 0);
  });

  prevMonthlyAgg.forEach((r) => {
    const monthPart = r._id.split('-')[1]; // Get MM from YYYY-MM
    prevYearMap.set(monthPart, r.total || 0);
  });

  // Create month labels (01-12)
  const monthLabels = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
  const monthlyComparisonData = monthLabels.map((month) => ({
    month,
    'Current Year': Math.round(currentYearMap.get(month) || 0),
    'Previous Year': Math.round(prevYearMap.get(month) || 0),
  }));

  sendSuccess(res, {
    data: {
      quarterTargets: qTargets,
      salesQTargets: sqTargets,
      quarterActuals,
      annualTarget,
      annualActual,
      annualPercent,
      annualToDate,
      annualToDateFrom: atdFrom,
      annualToDateTo: atdTo,
      monthlyRevenue: monthlyAgg,
      monthlyComparisonData,
      currentQuarter,
      currentQuarterStart: qStart,
      currentQuarterEnd: qEnd,
      financialYearStartMonth: tenant?.companyProfile?.financialYearStartMonth || 1,
    },
  });
});

/**
 * GET /api/analytics/salesdam-clients
 */
const getSalesdamClients = asyncHandler(async (req, res) => {
  const tenantId = req.tenantId;
  const tenantObjId = mongoose.Types.ObjectId.createFromHexString(tenantId);

  const Tenant = (await import('../models/Tenant.js')).default;
  const tenant = await Tenant.findById(tenantId).select(
    'companyProfile'
  );

  const fyStartMonth =
    (tenant?.companyProfile?.financialYearStartMonth || 1) - 1; // 0-based
  const now = new Date();
  let fyStart = new Date(now.getFullYear(), fyStartMonth, 1);
  if (fyStart > now) fyStart = new Date(now.getFullYear() - 1, fyStartMonth, 1);
  let fyEnd = new Date(fyStart.getFullYear() + 1, fyStartMonth, 0, 23, 59, 59);

  // Previous year same period
  let prevFyStart = new Date(fyStart.getFullYear() - 1, fyStartMonth, 1);
  let prevFyEnd = new Date(prevFyStart.getFullYear() + 1, fyStartMonth, 0, 23, 59, 59);

  const [projOrders, currentYearMonthly, prevYearMonthly, profitDataByMonth] = await Promise.all([
    // Income Projection: orders grouped by payment month
    DynamicRecord.aggregate([
      {
        $match: {
          tenantId: tenantObjId,
          objectApiName: 'order',
          isDeleted: false,
          'data.invoice_date': { $exists: true, $ne: null },
          'data.payment_terms': { $exists: true, $ne: null },
          'data.order_value': { $exists: true, $ne: null },
        },
      },
      { $project: {
        data: 1,
        paymentMonth: {
          $dateToString: {
            format: '%Y-%m',
            date: {
              $dateAdd: {
                startDate: { $toDate: '$data.invoice_date' },
                unit: 'day',
                amount: { $toInt: '$data.payment_terms' },
              },
            },
          },
        },
      }},
      { $group: {
        _id: '$paymentMonth',
        total: { $sum: { $toDouble: '$data.order_value' } },
      }},
      { $sort: { _id: 1 } },
    ]),
    // Current year monthly revenue
    DynamicRecord.aggregate([
      {
        $match: {
          tenantId: tenantObjId,
          objectApiName: 'order',
          isDeleted: false,
          'data.invoice_date': { $gte: fyStart, $lte: fyEnd },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format: '%Y-%m',
              date: { $toDate: '$data.invoice_date' },
            },
          },
          total: { $sum: { $toDouble: '$data.order_value' } },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    // Previous year monthly revenue
    DynamicRecord.aggregate([
      {
        $match: {
          tenantId: tenantObjId,
          objectApiName: 'order',
          isDeleted: false,
          'data.invoice_date': { $gte: prevFyStart, $lte: prevFyEnd },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format: '%Y-%m',
              date: { $toDate: '$data.invoice_date' },
            },
          },
          total: { $sum: { $toDouble: '$data.order_value' } },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    // Profit margin by month (actual vs planned)
    DynamicRecord.aggregate([
      {
        $match: {
          tenantId: tenantObjId,
          objectApiName: 'order',
          isDeleted: false,
          'data.invoice_date': { $gte: fyStart, $lte: fyEnd },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format: '%Y-%m',
              date: { $toDate: '$data.invoice_date' },
            },
          },
          actualRevenue: { $sum: { $toDouble: '$data.order_value' } },
          actualCost: { $sum: { $toDouble: '$data.actual_purchase_amount' } },
          plannedCost: { $sum: { $toDouble: '$data.budget_purchase_amount' } },
        },
      },
      { $sort: { _id: 1 } },
    ]),
  ]);

  // Format income projection (bar chart by payment month)
  const incomeProjectionData = projOrders.map((r) => ({
    month: r._id,
    income: Math.round(r.total || 0),
  }));

  // Format profit margin (line chart: planned vs actual)
  const profitMarginData = profitDataByMonth.map((r) => {
    const actualProfit = r.actualRevenue - r.actualCost;
    const actualMargin = r.actualRevenue > 0
      ? Math.round((actualProfit / r.actualRevenue) * 100)
      : 0;

    const plannedProfit = r.actualRevenue - r.plannedCost;
    const plannedMargin = r.actualRevenue > 0
      ? Math.round((plannedProfit / r.actualRevenue) * 100)
      : 0;

    return {
      month: r._id,
      'Actual Profit Margin': actualMargin,
      'Planned Profit Margin': plannedMargin,
    };
  });

  // Format revenue comparison (line chart: current year vs previous year)
  const revenueComparisonData = [];
  const allMonths = new Set([
    ...currentYearMonthly.map((r) => r._id),
    ...prevYearMonthly.map((r) => r._id),
  ]);

  // Map to just month (without year) for comparison
  const currentYearMap = new Map();
  const prevYearMap = new Map();

  currentYearMonthly.forEach((r) => {
    const monthPart = r._id.split('-')[1]; // Get MM from YYYY-MM
    currentYearMap.set(monthPart, r.total || 0);
  });

  prevYearMonthly.forEach((r) => {
    const monthPart = r._id.split('-')[1]; // Get MM from YYYY-MM
    prevYearMap.set(monthPart, r.total || 0);
  });

  // Create month labels (01-12)
  const monthLabels = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
  monthLabels.forEach((month) => {
    revenueComparisonData.push({
      month,
      'Current Year': Math.round(currentYearMap.get(month) || 0),
      'Previous Year': Math.round(prevYearMap.get(month) || 0),
    });
  });

  sendSuccess(res, {
    data: {
      incomeProjectionData,
      profitMarginData,
      revenueComparisonData,
      financialYearStartMonth: tenant?.companyProfile?.financialYearStartMonth || 1,
    },
  });
});

/**
 * GET /api/analytics/salesdam-deals
 */
const getSalesdamDeals = asyncHandler(async (req, res) => {
  const tenantId = req.tenantId;
  const tenantObjId = mongoose.Types.ObjectId.createFromHexString(tenantId);

  const [byStage, totalValue, wonValue, lostValue, countByMonth] =
    await Promise.all([
      DynamicRecord.aggregate([
        {
          $match: {
            tenantId: tenantObjId,
            objectApiName: 'opportunity',
            isDeleted: false,
          },
        },
        {
          $group: {
            _id: '$data.stage',
            count: { $sum: 1 },
            value: { $sum: { $toDouble: '$data.amount' } },
          },
        },
      ]),
      DynamicRecord.aggregate([
        {
          $match: {
            tenantId: tenantObjId,
            objectApiName: 'opportunity',
            isDeleted: false,
          },
        },
        {
          $group: { _id: null, total: { $sum: { $toDouble: '$data.amount' } } },
        },
      ]),
      DynamicRecord.aggregate([
        {
          $match: {
            tenantId: tenantObjId,
            objectApiName: 'opportunity',
            isDeleted: false,
            'data.stage': 'closed_won',
          },
        },
        {
          $group: { _id: null, total: { $sum: { $toDouble: '$data.amount' } } },
        },
      ]),
      DynamicRecord.aggregate([
        {
          $match: {
            tenantId: tenantObjId,
            objectApiName: 'opportunity',
            isDeleted: false,
            'data.stage': 'closed_lost',
          },
        },
        {
          $group: { _id: null, total: { $sum: { $toDouble: '$data.amount' } } },
        },
      ]),
      DynamicRecord.aggregate([
        {
          $match: {
            tenantId: tenantObjId,
            objectApiName: 'opportunity',
            isDeleted: false,
            createdAt: {
              $gte: new Date(new Date().setMonth(new Date().getMonth() - 11)),
            },
          },
        },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
    ]);

  sendSuccess(res, {
    data: {
      byStage,
      totalValue: totalValue[0]?.total || 0,
      wonValue: wonValue[0]?.total || 0,
      lostValue: lostValue[0]?.total || 0,
      countByMonth,
    },
  });
});

/**
 * GET /api/analytics/salesdam-leads
 */
const getSalesdamLeads = asyncHandler(async (req, res) => {
  const tenantId = req.tenantId;
  const tenantObjId = mongoose.Types.ObjectId.createFromHexString(tenantId);

  const [byStatus, bySource, byRating, total, newThisMonth] = await Promise.all(
    [
      DynamicRecord.aggregate([
        {
          $match: {
            tenantId: tenantObjId,
            objectApiName: 'lead',
            isDeleted: false,
          },
        },
        { $group: { _id: '$data.status', count: { $sum: 1 } } },
      ]),
      DynamicRecord.aggregate([
        {
          $match: {
            tenantId: tenantObjId,
            objectApiName: 'lead',
            isDeleted: false,
          },
        },
        { $group: { _id: '$data.source', count: { $sum: 1 } } },
      ]),
      DynamicRecord.aggregate([
        {
          $match: {
            tenantId: tenantObjId,
            objectApiName: 'lead',
            isDeleted: false,
          },
        },
        { $group: { _id: '$data.rating', count: { $sum: 1 } } },
      ]),
      DynamicRecord.countDocuments({
        tenantId: tenantObjId,
        objectApiName: 'lead',
        isDeleted: false,
      }),
      DynamicRecord.countDocuments({
        tenantId: tenantObjId,
        objectApiName: 'lead',
        isDeleted: false,
        createdAt: {
          $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
        },
      }),
    ],
  );

  sendSuccess(res, {
    data: { byStatus, bySource, byRating, total, newThisMonth },
  });
});

/**
 * GET /api/analytics/salesdam-revenue
 */
const getSalesdamRevenue = asyncHandler(async (req, res) => {
  const tenantId = req.tenantId;
  const tenantObjId = mongoose.Types.ObjectId.createFromHexString(tenantId);

  const Tenant = (await import('../models/Tenant.js')).default;
  const tenant = await Tenant.findById(tenantId).select(
    'revenueTargets companyProfile',
  );
  const rt = tenant?.revenueTargets || {};
  const annualTarget =
    (rt.q1 || 0) + (rt.q2 || 0) + (rt.q3 || 0) + (rt.q4 || 0);

  const fyStart = (tenant?.companyProfile?.financialYearStartMonth || 1) - 1;
  const now = new Date();
  let fy = new Date(now.getFullYear(), fyStart, 1);
  if (fy > now) fy = new Date(now.getFullYear() - 1, fyStart, 1);

  const [monthly, byProduct] = await Promise.all([
    DynamicRecord.aggregate([
      {
        $match: {
          tenantId: tenantObjId,
          objectApiName: 'opportunity',
          isDeleted: false,
          'data.stage': 'closed_won',
          'data.close_date': { $gte: fy },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format: '%Y-%m',
              date: { $toDate: '$data.close_date' },
            },
          },
          revenue: { $sum: { $toDouble: '$data.amount' } },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    DynamicRecord.aggregate([
      {
        $match: {
          tenantId: tenantObjId,
          objectApiName: 'opportunity',
          isDeleted: false,
          'data.stage': 'closed_won',
        },
      },
      {
        $group: {
          _id: '$data.type',
          revenue: { $sum: { $toDouble: '$data.amount' } },
        },
      },
    ]),
  ]);

  sendSuccess(res, { data: { monthly, byProduct, annualTarget } });
});

/**
 * GET /api/analytics/salesdam-sales
 */
const getSalesdamSales = asyncHandler(async (req, res) => {
  const tenantId = req.tenantId;
  const tenantObjId = mongoose.Types.ObjectId.createFromHexString(tenantId);

  const Tenant = (await import('../models/Tenant.js')).default;
  const tenant = await Tenant.findById(tenantId).select(
    'salesTargets companyProfile',
  );
  const st = tenant?.salesTargets || {};

  const fyStart = (tenant?.companyProfile?.financialYearStartMonth || 1) - 1;
  const now = new Date();
  let fy = new Date(now.getFullYear(), fyStart, 1);
  if (fy > now) fy = new Date(now.getFullYear() - 1, fyStart, 1);

  const quarters = [0, 1, 2, 3].map((i) => ({
    qStart: new Date(fy.getFullYear(), fyStart + i * 3, 1),
    qEnd: new Date(fy.getFullYear(), fyStart + i * 3 + 3, 0, 23, 59, 59),
  }));

  const qActuals = await Promise.all(
    quarters.map(async ({ qStart, qEnd }) => {
      const agg = await DynamicRecord.aggregate([
        {
          $match: {
            tenantId: tenantObjId,
            objectApiName: 'opportunity',
            isDeleted: false,
            'data.stage': 'closed_won',
            'data.close_date': { $gte: qStart, $lte: qEnd },
          },
        },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            value: { $sum: { $toDouble: '$data.amount' } },
          },
        },
      ]);
      return { count: agg[0]?.count || 0, value: agg[0]?.value || 0 };
    }),
  );

  const byRep = await DynamicRecord.aggregate([
    {
      $match: {
        tenantId: tenantObjId,
        objectApiName: 'opportunity',
        isDeleted: false,
        'data.stage': 'closed_won',
        createdAt: { $gte: fy },
      },
    },
    {
      $group: {
        _id: '$ownerId',
        count: { $sum: 1 },
        value: { $sum: { $toDouble: '$data.amount' } },
      },
    },
    { $sort: { value: -1 } },
    { $limit: 10 },
  ]);

  sendSuccess(res, {
    data: {
      quarterTargets: [st.q1 || 0, st.q2 || 0, st.q3 || 0, st.q4 || 0],
      quarterActuals: qActuals,
      byRep,
    },
  });
});

/**
 * GET /api/analytics/salesdam-roi
 */
const getSalesdamROI = asyncHandler(async (req, res) => {
  const tenantId = req.tenantId;
  const tenantObjId = mongoose.Types.ObjectId.createFromHexString(tenantId);

  const [wonAgg, lostAgg, pipelineAgg, convRate] = await Promise.all([
    DynamicRecord.aggregate([
      {
        $match: {
          tenantId: tenantObjId,
          objectApiName: 'opportunity',
          isDeleted: false,
          'data.stage': 'closed_won',
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: { $toDouble: '$data.amount' } },
          count: { $sum: 1 },
        },
      },
    ]),
    DynamicRecord.aggregate([
      {
        $match: {
          tenantId: tenantObjId,
          objectApiName: 'opportunity',
          isDeleted: false,
          'data.stage': 'closed_lost',
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: { $toDouble: '$data.amount' } },
          count: { $sum: 1 },
        },
      },
    ]),
    DynamicRecord.aggregate([
      {
        $match: {
          tenantId: tenantObjId,
          objectApiName: 'opportunity',
          isDeleted: false,
          'data.stage': { $nin: ['closed_won', 'closed_lost'] },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: { $toDouble: '$data.amount' } },
          count: { $sum: 1 },
        },
      },
    ]),
    DynamicRecord.aggregate([
      {
        $match: {
          tenantId: tenantObjId,
          objectApiName: 'lead',
          isDeleted: false,
        },
      },
      { $group: { _id: '$data.status', count: { $sum: 1 } } },
    ]),
  ]);

  const won = wonAgg[0] || { total: 0, count: 0 };
  const lost = lostAgg[0] || { total: 0, count: 0 };
  const pipe = pipelineAgg[0] || { total: 0, count: 0 };
  const totalLeads = convRate.reduce((s, r) => s + r.count, 0);
  const convertedLeads =
    convRate.find((r) => r._id === 'converted')?.count || 0;
  const leadConvRate =
    totalLeads > 0 ? Math.round((convertedLeads / totalLeads) * 100) : 0;
  const winRate =
    won.count + lost.count > 0
      ? Math.round((won.count / (won.count + lost.count)) * 100)
      : 0;

  sendSuccess(res, {
    data: {
      wonRevenue: won.total,
      wonCount: won.count,
      lostRevenue: lost.total,
      lostCount: lost.count,
      pipelineValue: pipe.total,
      pipelineCount: pipe.count,
      winRate,
      leadConversionRate: leadConvRate,
    },
  });
});

/**
 * GET /api/analytics/roi-dashboard
 * Client performance analysis with hit ratios and value ratios
 */
const getRoiDashboard = asyncHandler(async (req, res) => {
  const tenantId = req.tenantId;
  const tenantObjId = mongoose.Types.ObjectId.createFromHexString(tenantId);
  const { period = 'all-time', sortBy = 'volume', leadSource = '', customStart = '', customEnd = '' } = req.query;

  // Determine date range
  let dateRange = {};
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (period === 'custom' && customStart && customEnd) {
    dateRange = {
      $gte: new Date(customStart),
      $lte: new Date(new Date(customEnd).getTime() + 86400000), // Add 1 day
    };
  } else if (period === 'this-month') {
    dateRange = {
      $gte: new Date(now.getFullYear(), now.getMonth(), 1),
      $lte: today,
    };
  } else if (period === 'last-3-months') {
    dateRange = {
      $gte: new Date(now.getFullYear(), now.getMonth() - 3, 1),
      $lte: today,
    };
  } else if (period === 'this-year') {
    dateRange = {
      $gte: new Date(now.getFullYear(), 0, 1),
      $lte: today,
    };
  }

  // Build match filter
  const match = {
    tenantId: tenantObjId,
    objectApiName: 'deal',
    isDeleted: false,
  };

  if (Object.keys(dateRange).length > 0) {
    match['createdAt'] = dateRange;
  }

  if (leadSource) {
    match['data.lead_source'] = leadSource;
  }

  // Fetch all deals matching filters
  const deals = await DynamicRecord.aggregate([
    { $match: match },
    {
      $project: {
        company_name: '$data.company_name',
        order_value: { $toDouble: '$data.order_value' },
        is_converted: '$data.is_converted',
      },
    },
  ]);

  // Group by company and calculate metrics
  const clientMap = {};

  deals.forEach((deal) => {
    const company = deal.company_name || 'Unnamed Client';

    if (!clientMap[company]) {
      clientMap[company] = {
        clientName: company,
        submittedDeals: 0,
        receivedOrders: 0,
        totalDealValue: 0,
        totalOrderValue: 0,
      };
    }

    clientMap[company].submittedDeals += 1;
    const dealValue = deal.order_value || 0;
    clientMap[company].totalDealValue += dealValue;

    if (deal.is_converted) {
      clientMap[company].receivedOrders += 1;
      clientMap[company].totalOrderValue += dealValue;
    }
  });

  // Calculate ratios and sort
  const clients = Object.values(clientMap)
    .map((c) => ({
      ...c,
      hitRatio: c.submittedDeals > 0 ? c.receivedOrders / c.submittedDeals : 0,
      valueRatio: c.totalDealValue > 0 ? c.totalOrderValue / c.totalDealValue : 0,
    }))
    .sort((a, b) => {
      if (sortBy === 'volume') {
        return b.receivedOrders - a.receivedOrders;
      }
      return b.totalOrderValue - a.totalOrderValue;
    });

  sendSuccess(res, { data: clients });
});

/**
 * PUT /api/analytics/salesdam-dashboard-config
 */
const saveSalesdamDashboardConfig = asyncHandler(async (req, res) => {
  const { annualTargetFromDate, annualTargetToDate } = req.body;
  const Tenant = (await import('../models/Tenant.js')).default;
  await Tenant.findByIdAndUpdate(req.tenantId, {
    $set: {
      'salesdamDashboardConfig.annualTargetFromDate':
        annualTargetFromDate || '',
      'salesdamDashboardConfig.annualTargetToDate': annualTargetToDate || '',
    },
  });
  sendSuccess(res, { message: 'Config saved.' });
});

export {
  getOverview,
  runReport,
  recordsOverTime,
  getSalesdamHome,
  getSalesdamOrders,
  getSalesdamClients,
  getSalesdamDeals,
  getSalesdamLeads,
  getSalesdamRevenue,
  getSalesdamSales,
  getSalesdamROI,
  getRoiDashboard,
  saveSalesdamDashboardConfig,
};
