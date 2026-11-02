import ListView from '../models/ListView.js';
import ObjectMeta from '../models/ObjectMeta.js';
import FieldMeta from '../models/FieldMeta.js';
import { asyncHandler, sendSuccess, AppError } from '../utils/errors.js';
import { audit } from '../utils/auditLogger.js';
import { OPERATORS } from '../services/listViewService.js';
import { defaultViewsFor, DEFAULT_COLUMNS } from '../config/listViews.js';

const MAX_VIEWS_PER_OBJECT = 100;
const MAX_FILTERS_PER_VIEW = 20;
const MAX_COLUMNS_PER_VIEW = 30;

/** Loads the object or 404s. */
const getObjectOr404 = async (tenantId, objectApiName) => {
  const obj = await ObjectMeta.findOne({ tenantId, apiName: objectApiName });
  if (!obj) throw new AppError(`Object "${objectApiName}" not found.`, 404);
  return obj;
};

/**
 * Validates a view payload against the object's real fields, so a view can't
 * reference columns or operators that don't exist.
 */
const validatePayload = async ({ tenantId, obj, body }) => {
  const name = (body.name || '').trim();
  if (!name) throw new AppError('View name is required.', 400);
  if (name.length > 80) throw new AppError('View name must be 80 characters or fewer.', 400);

  const filters = Array.isArray(body.filters) ? body.filters : [];
  if (filters.length > MAX_FILTERS_PER_VIEW) {
    throw new AppError(`A view can have at most ${MAX_FILTERS_PER_VIEW} filters.`, 400);
  }

  const columns = Array.isArray(body.columns) ? body.columns : [];
  if (columns.length > MAX_COLUMNS_PER_VIEW) {
    throw new AppError(`A view can have at most ${MAX_COLUMNS_PER_VIEW} columns.`, 400);
  }

  // Root columns are always addressable even though they aren't FieldMeta rows.
  const ROOT = ['createdAt', 'updatedAt', 'ownerId', 'createdBy', 'lastModifiedBy', '_id'];
  const fields = await FieldMeta.find({ tenantId, objectApiName: obj.apiName }).select('apiName type isHelper displayOrder');
  const known = new Set([...fields.map((f) => f.apiName), ...ROOT]);

  const unknownColumns = columns.filter((c) => !known.has(c));
  if (unknownColumns.length > 0) {
    throw new AppError(`Unknown column(s): ${unknownColumns.join(', ')}.`, 400);
  }

  for (const condition of filters) {
    if (!condition?.field || !known.has(condition.field)) {
      throw new AppError(`Unknown filter field: "${condition?.field}".`, 400);
    }
    if (condition.operator && !OPERATORS.includes(condition.operator)) {
      throw new AppError(`Unsupported filter operator: "${condition.operator}".`, 400);
    }
  }

  if (body.sortField && !known.has(body.sortField)) {
    throw new AppError(`Unknown sort field: "${body.sortField}".`, 400);
  }

  return {
    name,
    filters: filters.map((c) => ({
      field: c.field,
      operator: c.operator || 'eq',
      value: c.value,
    })),
    columns: columns.length > 0
      ? columns
      : (defaultViewsFor(obj, fields)[0]?.columns || []),
    sortField: body.sortField || null,
    sortOrder: body.sortOrder === 'asc' ? 'asc' : 'desc',
    isShared: !!body.isShared,
  };
};

/**
 * GET /api/list-views/:objectApiName
 * Returns the config-defined defaults followed by the user's saved views.
 */
const listViews = asyncHandler(async (req, res) => {
  const { objectApiName } = req.params;
  const obj = await getObjectOr404(req.tenantId, objectApiName);

  const saved = await ListView.find({
    tenantId: req.tenantId,
    objectApiName,
    $or: [{ isShared: true }, { createdBy: req.user._id }],
  }).sort({ name: 1 });

  const fields = await FieldMeta.find({ tenantId: req.tenantId, objectApiName }).sort({ displayOrder: 1 });
  const defaults = defaultViewsFor(obj, fields).map((v) => ({
    key: v.key,
    name: v.name,
    filters: v.filters,
    columns: v.columns,
    sortField: v.sortField,
    sortOrder: v.sortOrder,
    isDefault: true,
    isShared: true,
    canEdit: false,
  }));

  const custom = saved.map((v) => ({
    key: String(v._id),
    name: v.name,
    filters: v.filters,
    columns: v.columns,
    sortField: v.sortField,
    sortOrder: v.sortOrder,
    isDefault: false,
    isShared: v.isShared,
    // Shared views can only be edited by whoever made them.
    canEdit: String(v.createdBy) === String(req.user._id),
  }));

  sendSuccess(res, { data: [...defaults, ...custom] });
});

/** POST /api/list-views/:objectApiName */
const createView = asyncHandler(async (req, res) => {
  const { objectApiName } = req.params;
  const obj = await getObjectOr404(req.tenantId, objectApiName);

  const count = await ListView.countDocuments({
    tenantId: req.tenantId,
    objectApiName,
    createdBy: req.user._id,
  });
  if (count >= MAX_VIEWS_PER_OBJECT) {
    throw new AppError(`You can have at most ${MAX_VIEWS_PER_OBJECT} views per object.`, 400);
  }

  const payload = await validatePayload({ tenantId: req.tenantId, obj, body: req.body });

  const view = await ListView.create({
    ...payload,
    tenantId: req.tenantId,
    objectApiName,
    createdBy: req.user._id,
    lastModifiedBy: req.user._id,
  });

  await audit({
    tenantId: req.tenantId,
    userId: req.user._id,
    action: 'create',
    resource: 'ListView',
    resourceId: view._id,
    objectApiName,
    req,
  });

  sendSuccess(res, { data: { ...view.toObject(), key: String(view._id) } }, 'View created', 201);
});

/** PUT /api/list-views/:objectApiName/:id */
const updateView = asyncHandler(async (req, res) => {
  const { objectApiName, id } = req.params;
  const obj = await getObjectOr404(req.tenantId, objectApiName);

  const view = await ListView.findOne({ _id: id, tenantId: req.tenantId, objectApiName });
  if (!view) throw new AppError('View not found.', 404);
  if (String(view.createdBy) !== String(req.user._id)) {
    throw new AppError('You can only edit views you created.', 403);
  }

  const payload = await validatePayload({ tenantId: req.tenantId, obj, body: req.body });
  Object.assign(view, payload, { lastModifiedBy: req.user._id });
  await view.save();

  await audit({
    tenantId: req.tenantId,
    userId: req.user._id,
    action: 'update',
    resource: 'ListView',
    resourceId: view._id,
    objectApiName,
    req,
  });

  sendSuccess(res, { data: { ...view.toObject(), key: String(view._id) } }, 'View updated');
});

/** DELETE /api/list-views/:objectApiName/:id */
const deleteView = asyncHandler(async (req, res) => {
  const { objectApiName, id } = req.params;

  const view = await ListView.findOne({ _id: id, tenantId: req.tenantId, objectApiName });
  if (!view) throw new AppError('View not found.', 404);
  if (String(view.createdBy) !== String(req.user._id)) {
    throw new AppError('You can only delete views you created.', 403);
  }

  await ListView.deleteOne({ _id: view._id });

  await audit({
    tenantId: req.tenantId,
    userId: req.user._id,
    action: 'delete',
    resource: 'ListView',
    resourceId: view._id,
    objectApiName,
    req,
  });

  sendSuccess(res, {}, 'View deleted');
});

export { listViews, createView, updateView, deleteView };
