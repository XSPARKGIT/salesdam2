import express from 'express';
import mongoose from 'mongoose';
import Dashboard from '../models/Dashboard.js';
import DashboardFolder from '../models/DashboardFolder.js';
import DynamicRecord from '../models/DynamicRecord.js';
import ObjectMeta from '../models/ObjectMeta.js';
import User from '../models/User.js';
import { requireAuth } from '../middleware/auth.js';
import { enforceTenant } from '../middleware/tenant.js';
import { asyncHandler, sendSuccess, AppError } from '../utils/errors.js';
import { hasObjectPermission, buildDataAccessFilter } from '../middleware/permissions.js';
import { assertReportFunctions, assertReportFieldsVisible } from '../utils/reportGuards.js';

const router = express.Router();
router.use(requireAuth, enforceTenant);

// The user model has a single populated `role`; normalise it to an id list so
// role-based sharing works (and never throws on a missing collection).
function roleIdsOf(user) {
  const role = user.role;
  if (!role) return [];
  return [role._id || role];
}

// ─── Visibility filter ────────────────────────────────────────────────────────
// Returns a MongoDB query that finds dashboards the current user can see.
function visibilityQuery(req) {
  const userId = req.user._id;
  const roleIds = roleIdsOf(req.user);
  const isAdmin = req.user.isAdmin();

  if (isAdmin) return { tenantId: req.tenantId }; // admins see everything

  return {
    tenantId: req.tenantId,
    $or: [
      { createdBy: userId },
      { 'sharing.access': 'workspace' },
      {
        'sharing.access': 'roles',
        'sharing.sharedWithRoles': { $in: roleIds },
      },
      { 'sharing.access': 'users', 'sharing.sharedWithUsers': userId },
    ],
  };
}

// Returns true if user can edit this dashboard
function canEdit(dashboard, req) {
  const userId = req.user._id.toString();
  const roleIds = roleIdsOf(req.user).map((r) => r.toString());
  if (req.user.isAdmin()) return true;
  if (dashboard.createdBy.toString() === userId) return true;
  if (!dashboard.sharing.allowEdit) return false;
  if (dashboard.sharing.editableByUsers.some((u) => u.toString() === userId))
    return true;
  if (
    dashboard.sharing.editableByRoles.some((r) =>
      roleIds.includes(r.toString()),
    )
  )
    return true;
  return false;
}

// ─── List ─────────────────────────────────────────────────────────────────────
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { folderId } = req.query;
    const filter = visibilityQuery(req);
    if (folderId === 'none') filter.folderId = null;
    else if (folderId) filter.folderId = folderId;

    const dashboards = await Dashboard.find(filter)
      .select('-widgets') // widgets are heavy — omit from list
      .populate('folderId', 'name color icon')
      .populate('createdBy', 'firstName lastName')
      .sort({ updatedAt: -1 });

    sendSuccess(res, { data: dashboards });
  }),
);

// ─── Workspace members (lightweight, for owner filter picker) ─────────────────
router.get(
  '/members',
  asyncHandler(async (req, res) => {
    const users = await User.find({ tenantId: req.tenantId, status: 'active' })
      .select('_id firstName lastName email')
      .sort({ firstName: 1 })
      .lean();
    sendSuccess(res, { data: users });
  }),
);

// ─── Get single ───────────────────────────────────────────────────────────────
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const dash = await Dashboard.findOne({
      ...visibilityQuery(req),
      _id: req.params.id,
    })
      .populate('folderId', 'name color icon')
      .populate('createdBy', 'firstName lastName')
      .populate('sharing.sharedWithRoles', 'name label')
      .populate('sharing.sharedWithUsers', 'firstName lastName email');

    if (!dash) throw new AppError('Dashboard not found or access denied.', 404);

    // Track last viewed
    Dashboard.updateOne({ _id: dash._id }, { lastViewedAt: new Date() }).catch(
      () => {},
    );

    sendSuccess(res, {
      data: dash,
      canEdit: canEdit(dash, req),
    });
  }),
);

// ─── Create ───────────────────────────────────────────────────────────────────
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { name, description, icon, color, folderId } = req.body;
    if (!name) throw new AppError('Dashboard name is required.', 400);

    if (folderId) {
      const folder = await DashboardFolder.findOne({
        _id: folderId,
        tenantId: req.tenantId,
      });
      if (!folder) throw new AppError('Folder not found.', 404);
    }

    const dash = await Dashboard.create({
      tenantId: req.tenantId,
      folderId: folderId || null,
      name,
      description,
      icon,
      color,
      widgets: [],
      sharing: { access: 'private' },
      createdBy: req.user._id,
    });

    sendSuccess(res, { data: dash }, 'Dashboard created', 201);
  }),
);

// ─── Update (metadata + widgets) ─────────────────────────────────────────────
router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const dash = await Dashboard.findOne({
      ...visibilityQuery(req),
      _id: req.params.id,
    });
    if (!dash) throw new AppError('Dashboard not found.', 404);
    if (!canEdit(dash, req))
      throw new AppError('You do not have edit access to this dashboard.', 403);

    const allowed = [
      'name',
      'description',
      'icon',
      'color',
      'folderId',
      'widgets',
      'isDefault',
      'savedFilters',
    ];
    allowed.forEach((k) => {
      if (req.body[k] !== undefined) dash[k] = req.body[k];
    });
    dash.lastModifiedBy = req.user._id;
    await dash.save();
    sendSuccess(res, { data: dash }, 'Dashboard updated');
  }),
);

// ─── Update sharing ───────────────────────────────────────────────────────────
router.put(
  '/:id/sharing',
  asyncHandler(async (req, res) => {
    const dash = await Dashboard.findOne({
      tenantId: req.tenantId,
      _id: req.params.id,
    });
    if (!dash) throw new AppError('Dashboard not found.', 404);
    if (
      dash.createdBy.toString() !== req.user._id.toString() &&
      !req.user.isAdmin()
    ) {
      throw new AppError('Only the owner can change sharing settings.', 403);
    }

    const {
      access,
      sharedWithRoles,
      sharedWithUsers,
      allowEdit,
      editableByRoles,
      editableByUsers,
    } = req.body;
    dash.sharing = {
      access: access ?? dash.sharing.access,
      sharedWithRoles: sharedWithRoles ?? dash.sharing.sharedWithRoles,
      sharedWithUsers: sharedWithUsers ?? dash.sharing.sharedWithUsers,
      allowEdit: allowEdit ?? dash.sharing.allowEdit,
      editableByRoles: editableByRoles ?? dash.sharing.editableByRoles,
      editableByUsers: editableByUsers ?? dash.sharing.editableByUsers,
    };
    await dash.save();
    sendSuccess(res, { data: dash.sharing }, 'Sharing updated');
  }),
);

// ─── Delete ───────────────────────────────────────────────────────────────────
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const dash = await Dashboard.findOne({
      tenantId: req.tenantId,
      _id: req.params.id,
    });
    if (!dash) throw new AppError('Dashboard not found.', 404);
    if (
      dash.createdBy.toString() !== req.user._id.toString() &&
      !req.user.isAdmin()
    ) {
      throw new AppError('Only the owner can delete this dashboard.', 403);
    }
    await Dashboard.deleteOne({ _id: dash._id });
    sendSuccess(res, {}, 'Dashboard deleted');
  }),
);

// ─── Widget data endpoint ─────────────────────────────────────────────────────
// POST /api/dashboards/widget-data
// Accepts a widget config and returns data for rendering.
router.post(
  '/widget-data',
  asyncHandler(async (req, res) => {
    const { type, config } = req.body;
    if (!type || !config)
      throw new AppError('type and config are required.', 400);

    const tenantObjId = mongoose.Types.ObjectId.createFromHexString(
      req.tenantId,
    );
    let data = null;

    function resolveFilterValue(v) {
      if (v === '$currentUser') return req.user._id.toString();
      return v;
    }

    // Resolve a date formula string to a MongoDB $gte/$lte range object.
    function resolveDateFormula(formula) {
      const now = new Date();
      const sod = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
      const eod = (d) =>
        new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
      switch (formula) {
        case '$today':
          return { $gte: sod(now), $lte: eod(now) };
        case '$yesterday': {
          const y = new Date(now);
          y.setDate(y.getDate() - 1);
          return { $gte: sod(y), $lte: eod(y) };
        }
        case '$thisWeek': {
          const s = new Date(now);
          s.setDate(now.getDate() - now.getDay());
          return { $gte: sod(s), $lte: eod(now) };
        }
        case '$last7days': {
          const s = new Date(now);
          s.setDate(s.getDate() - 6);
          return { $gte: sod(s), $lte: eod(now) };
        }
        case '$thisMonth':
          return {
            $gte: new Date(now.getFullYear(), now.getMonth(), 1),
            $lte: eod(now),
          };
        case '$last30days': {
          const s = new Date(now);
          s.setDate(s.getDate() - 29);
          return { $gte: sod(s), $lte: eod(now) };
        }
        case '$lastMonth':
          return {
            $gte: new Date(now.getFullYear(), now.getMonth() - 1, 1),
            $lte: new Date(
              now.getFullYear(),
              now.getMonth(),
              0,
              23,
              59,
              59,
              999,
            ),
          };
        case '$thisQuarter': {
          const q = Math.floor(now.getMonth() / 3);
          return {
            $gte: new Date(now.getFullYear(), q * 3, 1),
            $lte: eod(now),
          };
        }
        case '$lastQuarter': {
          const q = Math.floor(now.getMonth() / 3);
          return {
            $gte: new Date(now.getFullYear(), (q - 1) * 3, 1),
            $lte: new Date(now.getFullYear(), q * 3, 0, 23, 59, 59, 999),
          };
        }
        case '$thisYear':
          return { $gte: new Date(now.getFullYear(), 0, 1), $lte: eod(now) };
        case '$lastYear':
          return {
            $gte: new Date(now.getFullYear() - 1, 0, 1),
            $lte: new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59, 999),
          };
        default:
          return null;
      }
    }

    // Accepts either legacy object format { field: value } or new array format
    // [{ field, operator, value, value2 }]. All chips are ANDed together; multiple
    // owner chips are ORed within the owner condition.
    function applyFilters(match, filters = {}) {
      // Normalise to array
      const chips = Array.isArray(filters)
        ? filters
        : Object.entries(filters).map(([field, value]) => ({
            field,
            operator: 'is',
            value,
          }));

      // Collect owner chips separately so we can OR them together
      const ownerConditions = [];

      chips.forEach(({ field, operator = 'is', value, value2 }) => {
        const resolved = resolveFilterValue(value);
        if (resolved == null || resolved === '') return;

        if (field === 'owner') {
          const ownerObjId = mongoose.Types.ObjectId.isValid(resolved)
            ? new mongoose.Types.ObjectId(resolved)
            : null;
          const conds = [];
          if (ownerObjId) conds.push({ ownerId: ownerObjId });
          conds.push({ 'data.assigned_to': resolved });
          ownerConditions.push({ $or: conds });
        } else if (field === 'createdAt' || field === 'updatedAt') {
          let dateCondition = null;
          if (operator === 'is') {
            dateCondition = resolveDateFormula(resolved);
          } else if (operator === 'before') {
            const range = resolveDateFormula(resolved);
            dateCondition = range ? { $lt: range.$gte } : null;
          } else if (operator === 'after') {
            const range = resolveDateFormula(resolved);
            dateCondition = range ? { $gt: range.$lte } : null;
          } else if (operator === 'between') {
            const rangeA = resolveDateFormula(resolved);
            const rangeB = resolveDateFormula(resolveFilterValue(value2));
            if (rangeA && rangeB) {
              dateCondition = { $gte: rangeA.$gte, $lte: rangeB.$lte };
            }
          }
          if (dateCondition) match[field] = dateCondition;
        } else {
          match[`data.${field}`] = resolved;
        }
      });

      if (ownerConditions.length === 1) {
        match.$and = [...(match.$and || []), ownerConditions[0]];
      } else if (ownerConditions.length > 1) {
        // Multiple owners: match any of them (OR), still ANDed with other chips
        match.$and = [...(match.$and || []), { $or: ownerConditions }];
      }
    }

    // Widgets follow the same rules as reports: Allow Reports, Read on the object,
    // the user's record visibility, field security, and the five shared functions.
    let dataFilter = {};
    if (config.objectApiName) {
      const wObj = await ObjectMeta.findOne({ tenantId: req.tenantId, apiName: config.objectApiName }).select('label allowReports').lean();
      if (!wObj) throw new AppError(`Object "${config.objectApiName}" not found.`, 404);
      if (wObj.allowReports === false) throw new AppError(`Reporting is turned off for ${wObj.label}.`, 403);
      if (!(await hasObjectPermission(req.user, 'read', config.objectApiName))) {
        throw new AppError(`You do not have permission to read ${config.objectApiName}.`, 403);
      }
      dataFilter = await buildDataAccessFilter(req.user, config.objectApiName);
      const fn = type === 'metric' ? config.aggregation : config.aggregation?.func;
      assertReportFunctions(fn ? [{ func: fn }] : []);
      await assertReportFieldsVisible(req.user, config.objectApiName, [
        config.field, config.aggregation?.field, config.groupBy, ...(config.columns || []), ...(Array.isArray(config.filters) ? config.filters.map((c) => c?.field) : Object.keys(config.filters || {})),
      ]);
    }

    switch (type) {
      case 'metric': {
        const {
          objectApiName,
          aggregation = 'count',
          field,
          filters = {},
        } = config;
        if (!objectApiName) break;

        const match = {
          tenantId: tenantObjId,
          objectApiName,
          isDeleted: false,
          ...dataFilter,
        };
        applyFilters(match, filters);

        if (aggregation === 'count') {
          const count = await DynamicRecord.countDocuments(match);
          data = { value: count };
        } else {
          const fieldPath = `$data.${field}`;
          const aggFunc = {
            sum: { $sum: fieldPath },
            avg: { $avg: fieldPath },
            min: { $min: fieldPath },
            max: { $max: fieldPath },
          }[aggregation];
          if (aggFunc && field) {
            const [result] = await DynamicRecord.aggregate([
              { $match: match },
              { $group: { _id: null, value: aggFunc } },
            ]);
            data = { value: result?.value ?? 0 };
          }
        }
        break;
      }

      case 'bar_chart':
      case 'line_chart':
      case 'pie_chart': {
        const {
          objectApiName,
          groupBy,
          aggregation = {},
          filters = {},
          limit = 10,
        } = config;
        if (!objectApiName || !groupBy) break;

        const match = {
          tenantId: tenantObjId,
          objectApiName,
          isDeleted: false,
          ...dataFilter,
        };
        applyFilters(match, filters);

        const { func = 'count', field } = aggregation;
        const aggVal =
          func === 'count' ? { $sum: 1 } : { [`$${func}`]: `$data.${field}` };

        const results = await DynamicRecord.aggregate([
          { $match: match },
          { $group: { _id: `$data.${groupBy}`, value: aggVal } },
          { $sort: { value: -1 } },
          { $limit: parseInt(limit) },
          {
            $project: {
              _id: 0,
              label: { $ifNull: ['$_id', 'Unknown'] },
              value: 1,
            },
          },
        ]);
        data = { results };
        break;
      }

      case 'table': {
        const {
          objectApiName,
          columns = [],
          sort = '-createdAt',
          limit = 10,
          filters = {},
        } = config;
        if (!objectApiName) break;

        const query = {
          tenantId: req.tenantId,
          objectApiName,
          isDeleted: false,
          ...dataFilter,
        };
        applyFilters(query, filters);

        const sortField = sort.startsWith('-') ? sort.slice(1) : sort;
        const sortDir = sort.startsWith('-') ? -1 : 1;
        const sortObj = ['createdAt', 'updatedAt'].includes(sortField)
          ? { [sortField]: sortDir }
          : { [`data.${sortField}`]: sortDir };

        const records = await DynamicRecord.find(query)
          .sort(sortObj)
          .limit(parseInt(limit))
          .lean();

        const rows = records.map((r) => {
          const row = { _id: r._id, createdAt: r.createdAt };
          const dataMap =
            r.data instanceof Map ? Object.fromEntries(r.data) : r.data || {};
          columns.forEach((col) => {
            row[col] = dataMap[col];
          });
          return row;
        });

        const objMeta = await ObjectMeta.findOne({
          tenantId: req.tenantId,
          apiName: objectApiName,
        })
          .select('fields')
          .lean();

        data = { rows, columns, objectMeta: objMeta };
        break;
      }

      case 'text': {
        data = { content: config.content || '' };
        break;
      }

      default:
        throw new AppError(`Unknown widget type: ${type}`, 400);
    }

    sendSuccess(res, { data });
  }),
);

export default router;
