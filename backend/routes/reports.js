import express from 'express';
import mongoose from 'mongoose';
import SavedReport from '../models/SavedReport.js';
import DynamicRecord from '../models/DynamicRecord.js';
import ObjectMeta from '../models/ObjectMeta.js';
import FieldMeta from '../models/FieldMeta.js';
import { requireAuth } from '../middleware/auth.js';
import { enforceTenant } from '../middleware/tenant.js';
import { hasObjectPermission, buildDataAccessFilter } from '../middleware/permissions.js';
import { asyncHandler, sendSuccess, AppError } from '../utils/errors.js';

const router = express.Router();
router.use(requireAuth, enforceTenant);

function roleIdsOf(user) {
  const role = user.role;
  if (!role) return [];
  return [role._id || role];
}

function visibilityQuery(req) {
  const userId = req.user._id;
  const roleIds = roleIdsOf(req.user);
  if (req.user.isAdmin()) return { tenantId: req.tenantId };
  return {
    tenantId: req.tenantId,
    $or: [
      { createdBy: userId },
      { 'sharing.access': 'workspace' },
      { 'sharing.access': 'roles', 'sharing.sharedWithRoles': { $in: roleIds } },
      { 'sharing.access': 'users', 'sharing.sharedWithUsers': userId },
    ],
  };
}

// ── Type-aware filter builder ────────────────────────────────────────────────
function applyTypedFilters(match, filters, fieldMap) {
  if (!Array.isArray(filters) || filters.length === 0) return;

  for (const { field, operator, value, value2 } of filters) {
    if (!field) continue;

    const isSystemField = ['createdAt', 'updatedAt'].includes(field);
    const path = isSystemField ? field : `data.${field}`;
    const meta = fieldMap.get(field);
    const isNumeric = meta && ['number', 'currency', 'percent'].includes(meta.type);
    const isDate = meta && ['date', 'datetime'].includes(meta.type) || isSystemField;

    const cast = (v) => {
      if (v === null || v === undefined) return v;
      if (isNumeric) { const n = parseFloat(v); return isNaN(n) ? v : n; }
      if (isDate) return new Date(v);
      return v;
    };

    switch (operator) {
      case 'eq':
        match[path] = cast(value);
        break;
      case 'neq':
        match[path] = { $ne: cast(value) };
        break;
      case 'gt':
        match[path] = { ...(match[path] || {}), $gt: cast(value) };
        break;
      case 'gte':
        match[path] = { ...(match[path] || {}), $gte: cast(value) };
        break;
      case 'lt':
        match[path] = { ...(match[path] || {}), $lt: cast(value) };
        break;
      case 'lte':
        match[path] = { ...(match[path] || {}), $lte: cast(value) };
        break;
      case 'contains':
        match[path] = { $regex: String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
        break;
      case 'not_contains':
        match[path] = { $not: { $regex: String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } };
        break;
      case 'starts_with':
        match[path] = { $regex: `^${String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, $options: 'i' };
        break;
      case 'ends_with':
        match[path] = { $regex: `${String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' };
        break;
      case 'in':
        match[path] = { $in: Array.isArray(value) ? value.map(cast) : [cast(value)] };
        break;
      case 'not_in':
        match[path] = { $nin: Array.isArray(value) ? value.map(cast) : [cast(value)] };
        break;
      case 'is_null':
        match[path] = { $in: [null, '', undefined] };
        break;
      case 'is_not_null':
        match[path] = { $nin: [null, '', undefined], $exists: true };
        break;
      case 'between':
        match[path] = { $gte: cast(value), $lte: cast(value2) };
        break;
      default:
        match[path] = cast(value);
    }
  }
}

// ── Run a report (from body config, not necessarily saved) ───────────────────
router.post(
  '/run',
  asyncHandler(async (req, res) => {
    const {
      objectApiName,
      groupBy,
      aggregations = [],
      filters = [],
      dateRange,
      limit = 100,
      sortField,
      sortOrder = 'desc',
      crossObject,
      columns = [],
    } = req.body;

    if (!objectApiName) throw new AppError('objectApiName is required.', 400);

    const obj = await ObjectMeta.findOne({ tenantId: req.tenantId, apiName: objectApiName });
    if (!obj) throw new AppError(`Object "${objectApiName}" not found.`, 404);

    if (!(await hasObjectPermission(req.user, 'read', objectApiName))) {
      throw new AppError(`You do not have permission to read ${objectApiName}.`, 403);
    }
    if (crossObject?.relatedObject && !(await hasObjectPermission(req.user, 'read', crossObject.relatedObject))) {
      throw new AppError(`You do not have permission to read ${crossObject.relatedObject}.`, 403);
    }

    const dataFilter = await buildDataAccessFilter(req.user, objectApiName);
    const tenantObjId = mongoose.Types.ObjectId.createFromHexString(req.tenantId);

    const fields = await FieldMeta.find({ tenantId: req.tenantId, objectApiName }).lean();
    const fieldMap = new Map(fields.map((f) => [f.apiName, f]));

    const match = {
      tenantId: tenantObjId,
      objectApiName,
      isDeleted: false,
      ...dataFilter,
    };

    applyTypedFilters(match, filters, fieldMap);

    if (dateRange?.field) {
      const dPath = `data.${dateRange.field}`;
      if (!match[dPath]) match[dPath] = {};
      if (dateRange.from) match[dPath].$gte = new Date(dateRange.from);
      if (dateRange.to) match[dPath].$lte = new Date(dateRange.to);
    }

    const pipeline = [{ $match: match }];

    // Cross-object join — lookup values may be stored as string or ObjectId
    if (crossObject?.lookupField && crossObject?.relatedObject) {
      const lookupFieldPath = `data.${crossObject.lookupField}`;
      pipeline.push({
        $addFields: {
          _lookupStr: { $ifNull: [{ $toString: `$${lookupFieldPath}` }, ''] },
        },
      });
      pipeline.push({
        $lookup: {
          from: 'dynamicrecords',
          let: { relIdStr: '$_lookupStr' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $ne: ['$$relIdStr', ''] },
                    { $eq: [{ $toString: '$_id' }, '$$relIdStr'] },
                  ],
                },
                tenantId: tenantObjId,
                objectApiName: crossObject.relatedObject,
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

    const groupPath =
      crossObject?.lookupField && crossObject?.relatedGroupBy
        ? `$_related.data.${crossObject.relatedGroupBy}`
        : groupBy
          ? `$data.${groupBy}`
          : null;

    if (groupPath) {
      const groupStage = { _id: groupPath };
      if (aggregations.length === 0) {
        groupStage.count = { $sum: 1 };
      }
      for (const { field, func, alias } of aggregations) {
        const key = alias || `${func}_${field || 'all'}`;
        if (func === 'count') groupStage[key] = { $sum: 1 };
        else if (field) groupStage[key] = { [`$${func}`]: `$data.${field}` };
      }
      pipeline.push({ $group: groupStage });

      const sortKey = sortField || (aggregations[0]?.alias || 'count');
      pipeline.push({ $sort: { [sortKey]: sortOrder === 'asc' ? 1 : -1 } });
    } else if (aggregations.length > 0) {
      const groupStage = { _id: null };
      for (const { field, func, alias } of aggregations) {
        const key = alias || `${func}_${field || 'all'}`;
        if (func === 'count') groupStage[key] = { $sum: 1 };
        else if (field) groupStage[key] = { [`$${func}`]: `$data.${field}` };
      }
      pipeline.push({ $group: groupStage });
    } else {
      // No grouping, no aggregation — return raw records (table mode)
      if (sortField) {
        const sPath = ['createdAt', 'updatedAt'].includes(sortField) ? sortField : `data.${sortField}`;
        pipeline.push({ $sort: { [sPath]: sortOrder === 'asc' ? 1 : -1 } });
      } else {
        pipeline.push({ $sort: { createdAt: -1 } });
      }
    }

    pipeline.push({ $limit: Math.min(parseInt(limit) || 100, 1000) });

    let results = await DynamicRecord.aggregate(pipeline);

    // If grouping by a lookup/master-detail field, resolve ObjectId _id values
    // to the display name of the referenced record so charts show names, not IDs.
    if (groupBy && results.length > 0) {
      const groupByField = fieldMap.get(groupBy);
      if (groupByField && (groupByField.type === 'lookup' || groupByField.type === 'master_detail')) {
        const relatedObject = groupByField.lookupObjectApiName;
        const rawIds = results.map((r) => r._id).filter(Boolean);
        const objectIds = rawIds.map((id) => {
          try { return mongoose.Types.ObjectId.createFromHexString(String(id)); } catch { return null; }
        }).filter(Boolean);

        if (objectIds.length > 0 && relatedObject) {
          const relatedRecords = await DynamicRecord.find(
            { _id: { $in: objectIds }, tenantId: tenantObjId, objectApiName: relatedObject, isDeleted: false },
            { 'data.name': 1, 'data.firstName': 1, 'data.lastName': 1, 'data.title': 1 },
          ).lean();

          const nameMap = new Map();
          for (const rec of relatedRecords) {
            const d = rec.data || {};
            const displayName =
              d.name ||
              (d.firstName || d.lastName ? `${d.firstName || ''} ${d.lastName || ''}`.trim() : null) ||
              d.title ||
              String(rec._id);
            nameMap.set(String(rec._id), displayName);
          }

          results = results.map((r) => ({
            ...r,
            _id: nameMap.get(String(r._id)) ?? r._id,
          }));
        }
      }
    }

    sendSuccess(res, {
      data: {
        results,
        objectApiName,
        groupBy: groupBy || crossObject?.relatedGroupBy,
        total: results.length,
        fields: fields.map((f) => ({ apiName: f.apiName, label: f.label, type: f.type })),
      },
    });
  }),
);

// ── List saved reports ───────────────────────────────────────────────────────
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const reports = await SavedReport.find(visibilityQuery(req))
      .select('-filters -aggregations -crossObject')
      .populate('createdBy', 'firstName lastName')
      .sort({ updatedAt: -1 });
    sendSuccess(res, { data: reports });
  }),
);

// ── Get single report ────────────────────────────────────────────────────────
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const report = await SavedReport.findOne({
      ...visibilityQuery(req),
      _id: req.params.id,
    })
      .populate('createdBy', 'firstName lastName')
      .populate('sharing.sharedWithRoles', 'name label')
      .populate('sharing.sharedWithUsers', 'firstName lastName email');

    if (!report) throw new AppError('Report not found or access denied.', 404);
    sendSuccess(res, { data: report });
  }),
);

// ── Create ───────────────────────────────────────────────────────────────────
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const {
      name, description, objectApiName, groupBy, aggregations,
      filters, dateRange, chartType, columns, sortField, sortOrder,
      limit, crossObject, sharing, folderId,
    } = req.body;

    if (!name) throw new AppError('Report name is required.', 400);
    if (!objectApiName) throw new AppError('objectApiName is required.', 400);

    const obj = await ObjectMeta.findOne({ tenantId: req.tenantId, apiName: objectApiName });
    if (!obj) throw new AppError(`Object "${objectApiName}" not found.`, 404);

    const report = await SavedReport.create({
      tenantId: req.tenantId,
      name, description, objectApiName, groupBy,
      aggregations: aggregations || [],
      filters: filters || [],
      dateRange, chartType, columns, sortField, sortOrder,
      limit, crossObject,
      sharing: sharing || { access: 'private' },
      folderId: folderId || null,
      createdBy: req.user._id,
    });

    sendSuccess(res, { data: report }, 'Report created', 201);
  }),
);

// ── Update ───────────────────────────────────────────────────────────────────
router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const report = await SavedReport.findOne({
      ...visibilityQuery(req),
      _id: req.params.id,
    });
    if (!report) throw new AppError('Report not found.', 404);
    if (report.createdBy.toString() !== req.user._id.toString() && !req.user.isAdmin()) {
      throw new AppError('Only the owner can edit this report.', 403);
    }

    const allowed = [
      'name', 'description', 'objectApiName', 'groupBy', 'aggregations',
      'filters', 'dateRange', 'chartType', 'columns', 'sortField', 'sortOrder',
      'limit', 'crossObject', 'sharing', 'folderId',
    ];
    allowed.forEach((k) => {
      if (req.body[k] !== undefined) report[k] = req.body[k];
    });
    report.lastModifiedBy = req.user._id;
    await report.save();

    sendSuccess(res, { data: report }, 'Report updated');
  }),
);

// ── Delete ───────────────────────────────────────────────────────────────────
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const report = await SavedReport.findOne({
      tenantId: req.tenantId,
      _id: req.params.id,
    });
    if (!report) throw new AppError('Report not found.', 404);
    if (report.createdBy.toString() !== req.user._id.toString() && !req.user.isAdmin()) {
      throw new AppError('Only the owner can delete this report.', 403);
    }
    await SavedReport.deleteOne({ _id: report._id });
    sendSuccess(res, {}, 'Report deleted');
  }),
);

export default router;
