import Tenant from '../models/Tenant.js';
import User from '../models/User.js';
import AuditLog from '../models/AuditLog.js';
import DynamicRecord from '../models/DynamicRecord.js';
import ObjectMeta from '../models/ObjectMeta.js';
import paystackService from '../services/paystackService.js';
import logger from '../utils/logger.js';
import {
  asyncHandler,
  sendSuccess,
  paginate,
  AppError,
} from '../utils/errors.js';

/**
 * GET /api/admin/stats
 */
const getSystemStats = asyncHandler(async (req, res) => {
  const [totalUsers, activeUsers, totalRecords] = await Promise.all([
    User.countDocuments({ tenantId: req.user.tenantId }),
    User.countDocuments({ tenantId: req.user.tenantId, status: 'active' }),
    DynamicRecord.countDocuments({
      tenantId: req.user.tenantId,
      isDeleted: false,
    }),
  ]);

  sendSuccess(res, {
    data: {
      users: { total: totalUsers, active: activeUsers },
      records: { total: totalRecords },
    },
  });
});

/**
 * GET /api/admin/logs
 */
const getAuditLogs = asyncHandler(async (req, res) => {
  const { page = 1, limit = 100, userId, action } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const query = { tenantId: req.tenantId };
  // Non-admins may only see their own audit events.
  const isAdmin = req.user?.role?.name === 'admin' || req.user?.role?.name === 'superuser';
  if (!isAdmin) {
    query.userId = req.user._id;
  } else if (userId) {
    query.userId = userId;
  }
  if (action) query.action = action;

  const [logs, total] = await Promise.all([
    AuditLog.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate('userId', 'firstName lastName email'),
    AuditLog.countDocuments(query),
  ]);

  sendSuccess(res, paginate(logs, total, page, limit));
});

/**
 * GET /api/admin/settings
 */
const getAdminSettings = asyncHandler(async (req, res) => {
  const tenant = await Tenant.findById(req.user.tenantId)
    .select(
      'name phone features companyProfile revenueTargets salesTargets invoiceQuoteSettings operatingCurrency leadApprovalSettings',
    )
    .populate({
      path: 'leadApprovalSettings.approvers',
      select: 'firstName lastName email',
    });

  if (!tenant) {
    throw new AppError('Tenant not found', 404);
  }

  sendSuccess(res, { data: tenant });
});

/**
 * GET /api/admin/settings/lead-approval-settings
 * Public endpoint for reading lead approval settings (all authenticated users)
 */
const getLeadApprovalSettings = asyncHandler(async (req, res) => {
  const tenant = await Tenant.findById(req.user.tenantId)
    .select('leadApprovalSettings')
    .populate({
      path: 'leadApprovalSettings.approvers',
      select: 'firstName lastName email',
    });

  if (!tenant) {
    throw new AppError('Tenant not found', 404);
  }

  sendSuccess(res, { data: tenant.leadApprovalSettings });
});

/**
 * GET /api/admin/subscription
 */
const getSubscription = asyncHandler(async (req, res) => {
  const tenant = await Tenant.findById(req.user.tenantId).select(
    'plan billing',
  );
  if (!tenant) throw new AppError('Tenant not found', 404);

  let subscriptionId = tenant.billing.subscriptionId;

  // If subscriptionId is missing, try to fetch it from Paystack
  if (!subscriptionId && tenant.billing.customerId) {
    try {
      const customerResult = await paystackService.getCustomer(
        tenant.billing.customerId,
      );
      if (
        customerResult.success &&
        customerResult.data.subscriptions &&
        customerResult.data.subscriptions.length > 0
      ) {
        subscriptionId = customerResult.data.subscriptions[0].subscription_code;
        // Update local record
        await Tenant.findByIdAndUpdate(tenant._id, {
          'billing.subscriptionId': subscriptionId,
        });
      }
    } catch (err) {
      logger.warn(
        'Could not fetch subscription ID from Paystack:',
        err.message,
      );
    }
  }

  sendSuccess(res, {
    data: {
      plan: tenant.plan,
      billing: {
        ...tenant.billing.toObject?.(),
        subscriptionId,
      },
    },
  });
});

/**
 * PUT /api/admin/subscription/plan
 */
const updateSubscriptionPlan = asyncHandler(async (req, res) => {
  const { newPlan, planCode } = req.body;

  if (!newPlan || !planCode) {
    throw new AppError('Plan and plan code are required', 400);
  }

  const tenant = await Tenant.findById(req.user.tenantId);
  if (!tenant) throw new AppError('Tenant not found', 404);

  let subscriptionId = tenant.billing.subscriptionId;

  // If subscriptionId is missing, try to fetch it from Paystack
  if (!subscriptionId && tenant.billing.customerId) {
    try {
      const customerResult = await paystackService.getCustomer(
        tenant.billing.customerId,
      );
      if (
        customerResult.success &&
        customerResult.data.subscriptions &&
        customerResult.data.subscriptions.length > 0
      ) {
        subscriptionId = customerResult.data.subscriptions[0].subscription_code;
        // Update local record with the subscription ID
        await Tenant.findByIdAndUpdate(req.user.tenantId, {
          'billing.subscriptionId': subscriptionId,
        });
      }
    } catch (err) {
      logger.warn(
        'Could not fetch subscription ID from Paystack:',
        err.message,
      );
    }
  }

  if (!subscriptionId) {
    throw new AppError('No active subscription found', 400);
  }

  try {
    // Update plan on Paystack
    const result = await paystackService.updateSubscriptionPlan(
      subscriptionId,
      planCode,
    );

    if (!result.success) {
      throw new AppError(
        result.message || 'Failed to update subscription plan on Paystack',
        400,
      );
    }

    // Update local tenant record
    const updated = await Tenant.findByIdAndUpdate(
      req.user.tenantId,
      {
        plan: newPlan,
        'billing.planActivatedDate': new Date(),
      },
      { new: true, runValidators: true },
    ).select('plan billing');

    sendSuccess(res, {
      data: updated,
      message: `Plan updated to ${newPlan}.`,
    });
  } catch (error) {
    logger.error('Error updating subscription plan:', error);
    throw new AppError(
      error.message || 'Failed to update subscription plan',
      400,
    );
  }
});

/**
 * PUT /api/admin/subscription/payment-method
 */
const updatePaymentMethod = asyncHandler(async (req, res) => {
  const { authorizationCode, token } = req.body;

  if (!authorizationCode || !token) {
    throw new AppError('Authorization code and token are required', 400);
  }

  const tenant = await Tenant.findById(req.user.tenantId);
  if (!tenant) throw new AppError('Tenant not found', 404);

  if (!tenant.billing.customerId) {
    throw new AppError('No customer record found', 400);
  }

  try {
    // Update authorization on Paystack
    const result = await paystackService.updateCustomerAuthorization(
      tenant.billing.customerId,
      authorizationCode,
      token,
    );

    if (!result.success) {
      throw new AppError(
        result.message || 'Failed to update payment method on Paystack',
        400,
      );
    }

    // Fetch updated customer details
    const customerResult = await paystackService.getCustomer(
      tenant.billing.customerId,
    );
    const customer = customerResult.data;
    const authorizations = customer.authorizations || [];
    const defaultAuth =
      authorizations.find((a) => a.is_default) || authorizations[0];

    const paymentMethod = defaultAuth
      ? {
          type: 'card',
          cardBrand: defaultAuth.brand,
          cardLast4: defaultAuth.last4,
          cardExp: `${defaultAuth.exp_month}/${defaultAuth.exp_year}`,
        }
      : null;

    // Update local record
    await Tenant.findByIdAndUpdate(
      req.user.tenantId,
      {
        'billing.paymentMethod': paymentMethod,
      },
      { new: true, runValidators: true },
    );

    sendSuccess(res, {
      data: paymentMethod,
      message: 'Payment method updated successfully.',
    });
  } catch (error) {
    logger.error('Error updating payment method:', error);
    throw new AppError(error.message || 'Failed to update payment method', 400);
  }
});

/**
 * POST /api/admin/subscription/cancel
 */
const cancelSubscription = asyncHandler(async (req, res) => {
  const { cancellationReason } = req.body;

  const tenant = await Tenant.findById(req.user.tenantId);
  if (!tenant) throw new AppError('Tenant not found', 404);

  let subscriptionId = tenant.billing.subscriptionId;

  // If subscriptionId is missing, try to fetch it from Paystack
  if (!subscriptionId && tenant.billing.customerId) {
    try {
      const customerResult = await paystackService.getCustomer(
        tenant.billing.customerId,
      );
      if (
        customerResult.success &&
        customerResult.data.subscriptions &&
        customerResult.data.subscriptions.length > 0
      ) {
        subscriptionId = customerResult.data.subscriptions[0].subscription_code;
      }
    } catch (err) {
      logger.warn(
        'Could not fetch subscription ID from Paystack:',
        err.message,
      );
    }
  }

  if (!subscriptionId) {
    throw new AppError('No active subscription found', 400);
  }

  try {
    // Disable subscription on Paystack
    const result = await paystackService.disableSubscription(subscriptionId);

    if (!result.success) {
      throw new AppError(
        result.message || 'Failed to cancel subscription on Paystack',
        400,
      );
    }

    // Update local record
    const updated = await Tenant.findByIdAndUpdate(
      req.user.tenantId,
      {
        'billing.status': 'cancelled',
        'billing.cancelledAt': new Date(),
        'billing.cancellationReason': cancellationReason || '',
        status: 'suspended',
      },
      { new: true, runValidators: true },
    ).select('plan billing status');

    sendSuccess(res, {
      data: updated,
      message: 'Subscription cancelled successfully.',
    });
  } catch (error) {
    logger.error('Error cancelling subscription:', error);
    throw new AppError(error.message || 'Failed to cancel subscription', 400);
  }
});

/**
 * PUT /api/admin/settings
 */
const updateAdminSettings = asyncHandler(async (req, res) => {
  let {
    features,
    companyProfile,
    revenueTargets,
    salesTargets,
    invoiceQuoteSettings,
    operatingCurrency,
    leadApprovalSettings,
  } = req.body;

  // Parse invoiceQuoteSettings if it's a string
  if (typeof invoiceQuoteSettings === 'string') {
    invoiceQuoteSettings = JSON.parse(invoiceQuoteSettings);
  }

  // Validate base64 logo if present
  if (
    invoiceQuoteSettings?.companyLogo &&
    typeof invoiceQuoteSettings.companyLogo === 'string'
  ) {
    // Check if it's a data URL (base64)
    if (invoiceQuoteSettings.companyLogo.startsWith('data:')) {
      // Extract mime type from data URL
      const mimeMatch = invoiceQuoteSettings.companyLogo.match(
        /data:([a-zA-Z0-9/+-]+);base64/,
      );
      const mimeType = mimeMatch ? mimeMatch[1] : null;

      if (
        !mimeType ||
        !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(
          mimeType,
        )
      ) {
        throw new AppError(
          'Invalid image format. Only PNG, JPG, GIF, and WebP are allowed.',
          400,
        );
      }

      // Validate base64 string size (rough estimate: base64 is ~33% larger than binary)
      // 5MB binary ≈ 6.7MB base64
      const base64Str = invoiceQuoteSettings.companyLogo.split(',')[1];
      if (
        base64Str &&
        Buffer.byteLength(base64Str, 'base64') > 5 * 1024 * 1024
      ) {
        throw new AppError('File size must be less than 5MB.', 400);
      }
    }
  }

  // Handle file upload if present (legacy support)
  if (req.files?.logoFile) {
    const logoFile = req.files.logoFile;
    const allowedMimeTypes = [
      'image/png',
      'image/jpeg',
      'image/gif',
      'image/webp',
    ];

    if (!allowedMimeTypes.includes(logoFile.mimetype)) {
      throw new AppError(
        'Invalid file type. Only PNG, JPG, GIF, and WebP are allowed.',
        400,
      );
    }

    if (logoFile.size > 5 * 1024 * 1024) {
      throw new AppError('File size must be less than 5MB.', 400);
    }

    // Convert image to base64 data URL
    const base64Data = logoFile.data.toString('base64');
    const dataUrl = `data:${logoFile.mimetype};base64,${base64Data}`;

    // Set the logo URL (file upload takes precedence)
    invoiceQuoteSettings = {
      ...invoiceQuoteSettings,
      companyLogo: dataUrl,
    };
  }

  // Validate company profile if provided
  if (companyProfile) {
    const requiredFields = [
      'companyName',
      'namePrefix',
      'email',
      'phone',
      'description',
      'website',
      'financialYearStartMonth',
    ];
    const requiredAddressFields = [
      'street',
      'city',
      'province',
      'zipCode',
      'country',
    ];

    // Check required top-level fields
    for (const field of requiredFields) {
      if (
        !companyProfile[field] ||
        (typeof companyProfile[field] === 'string' &&
          !companyProfile[field].trim())
      ) {
        throw new AppError(
          `Company Information: ${field.charAt(0).toUpperCase() + field.slice(1)} is required.`,
          400,
        );
      }
    }

    // Check required address fields
    if (companyProfile.address) {
      for (const field of requiredAddressFields) {
        if (
          !companyProfile.address[field] ||
          !companyProfile.address[field].trim()
        ) {
          throw new AppError(
            `Company Information: ${field === 'zipCode' ? 'Zip Code' : field.charAt(0).toUpperCase() + field.slice(1)} is required.`,
            400,
          );
        }
      }
    } else {
      throw new AppError(
        'Company Information: Address details are required.',
        400,
      );
    }
  }

  const update = {};
  if (features) {
    // Merge individual feature flags instead of replacing the whole subdocument
    Object.entries(features).forEach(([k, v]) => {
      update[`features.${k}`] = v;
    });
  }
  if (companyProfile) update.companyProfile = companyProfile;
  if (revenueTargets) update.revenueTargets = revenueTargets;
  if (salesTargets) update.salesTargets = salesTargets;
  if (invoiceQuoteSettings) update.invoiceQuoteSettings = invoiceQuoteSettings;
  if (operatingCurrency) update.operatingCurrency = operatingCurrency;
  if (leadApprovalSettings) {
    Object.entries(leadApprovalSettings).forEach(([k, v]) => {
      update[`leadApprovalSettings.${k}`] = v;
    });
  }

  const tenant = await Tenant.findByIdAndUpdate(
    req.user.tenantId,
    { $set: update },
    { new: true, runValidators: true },
  ).select(
    'name phone features companyProfile revenueTargets salesTargets invoiceQuoteSettings operatingCurrency',
  );

  sendSuccess(res, { data: tenant, message: 'Settings saved.' });
});

/**
 * GET /api/admin/settings/tenders-config
 */
const getTendersConfig = asyncHandler(async (req, res) => {
  const tenant = await Tenant.findById(req.user.tenantId).select(
    'tendersConfig',
  );
  if (!tenant) throw new AppError('Tenant not found', 404);

  const config = tenant.tendersConfig || {
    fromDate: '',
    toDate: '',
    departments: [],
    provinces: [],
    categories: [],
  };

  sendSuccess(res, { data: config });
});

/**
 * PUT /api/admin/settings/tenders-config
 */
const updateTendersConfig = asyncHandler(async (req, res) => {
  const { fromDate, toDate, departments, provinces, categories } = req.body;

  const update = {
    tendersConfig: {
      fromDate: fromDate || '',
      toDate: toDate || '',
      departments: Array.isArray(departments) ? departments : [],
      provinces: Array.isArray(provinces) ? provinces : [],
      categories: Array.isArray(categories) ? categories : [],
    },
  };

  const tenant = await Tenant.findByIdAndUpdate(
    req.user.tenantId,
    { $set: update },
    { new: true, runValidators: true },
  ).select('tendersConfig');

  sendSuccess(res, {
    data: tenant.tendersConfig,
    message: 'Tenders configuration saved.',
  });
});

/**
 * GET /api/admin/storage-usage
 */
const getStorageUsage = asyncHandler(async (req, res) => {
  const tenant = await Tenant.findById(req.user.tenantId);
  if (!tenant) throw new AppError('Tenant not found', 404);

  // Get all objects enabled for this tenant
  const allObjects = await ObjectMeta.find({
    tenantId: req.user.tenantId,
  }).select('apiName name');
  const objectMap = {};
  allObjects.forEach((obj) => {
    objectMap[obj.apiName] = obj.name || obj.apiName;
  });

  // Get storage breakdown by object (include deleted records for storage accounting)
  const objectUsage = await DynamicRecord.aggregate([
    {
      $match: {
        tenantId: req.user.tenantId,
      },
    },
    {
      $group: {
        _id: '$objectApiName',
        total_record_count: { $sum: 1 },
        active_record_count: {
          $sum: {
            $cond: [{ $eq: ['$isDeleted', false] }, 1, 0],
          },
        },
        deleted_record_count: {
          $sum: {
            $cond: [{ $eq: ['$isDeleted', true] }, 1, 0],
          },
        },
        total_size: {
          $sum: {
            $bsonSize: '$$ROOT',
          },
        },
      },
    },
    {
      $project: {
        object_api_name: '$_id',
        total_record_count: 1,
        active_record_count: 1,
        deleted_record_count: 1,
        bytes: '$total_size',
        _id: 0,
      },
    },
  ]);

  // Create a map of object usage for quick lookup
  const usageMap = {};
  objectUsage.forEach((obj) => {
    usageMap[obj.object_api_name] = {
      total_record_count: obj.total_record_count,
      active_record_count: obj.active_record_count,
      deleted_record_count: obj.deleted_record_count,
      bytes: obj.bytes,
    };
  });

  // Build complete object list with storage (including objects with 0 records)
  const completeObjectUsage = allObjects.map((obj) => ({
    object_name: objectMap[obj.apiName],
    object_api_name: obj.apiName,
    total_record_count: usageMap[obj.apiName]?.total_record_count || 0,
    active_record_count: usageMap[obj.apiName]?.active_record_count || 0,
    deleted_record_count: usageMap[obj.apiName]?.deleted_record_count || 0,
    bytes: usageMap[obj.apiName]?.bytes || 0,
  }));

  // Sort by bytes descending
  completeObjectUsage.sort((a, b) => b.bytes - a.bytes);

  // Calculate total used storage
  const totalUsed = completeObjectUsage.reduce(
    (sum, obj) => sum + obj.bytes,
    0,
  );

  // Storage limit: 20MB for all tenants
  const STORAGE_LIMIT = 20 * 1024 * 1024; // 20MB

  sendSuccess(res, {
    data: {
      used: totalUsed,
      plan_limit: STORAGE_LIMIT,
      objects: completeObjectUsage,
    },
  });
});

export {
  getSystemStats,
  getAuditLogs,
  getAdminSettings,
  getLeadApprovalSettings,
  updateAdminSettings,
  getTendersConfig,
  updateTendersConfig,
  getSubscription,
  updateSubscriptionPlan,
  updatePaymentMethod,
  cancelSubscription,
  getStorageUsage,
};
