import ObjectMeta from '../models/ObjectMeta.js';
import { asyncHandler, sendSuccess, AppError } from '../utils/errors.js';
import { audit } from '../utils/auditLogger.js';
import { v4 as uuidv4 } from 'uuid';
import mongoose from 'mongoose';
import { validateActionInput, runNativeAction } from '../services/actionService.js';

/**
 * GET /api/action-buttons/:objectApiName
 */
export const getActionButtons = asyncHandler(async (req, res) => {
  const { objectApiName } = req.params;

  const obj = await ObjectMeta.findOne({
    tenantId: req.tenantId,
    apiName: objectApiName,
  });

  if (!obj) throw new AppError(`Object "${objectApiName}" not found.`, 404);

  const actions = (obj.actionButtons || []).sort(
    (a, b) => (a.order || 0) - (b.order || 0),
  );

  sendSuccess(res, { data: actions });
});

/**
 * POST /api/action-buttons/:objectApiName
 */
export const createActionButton = asyncHandler(async (req, res) => {
  const { objectApiName } = req.params;

  const obj = await ObjectMeta.findOne({
    tenantId: req.tenantId,
    apiName: objectApiName,
  });

  if (!obj) throw new AppError(`Object "${objectApiName}" not found.`, 404);
  if (!String(req.body.label || '').trim()) throw new AppError('Button label is required.', 400);

  const behaviour = await validateActionInput(req.tenantId, objectApiName, req.body);

  const action = {
    id: uuidv4(),
    label: req.body.label,
    icon: req.body.icon || 'Zap',
    variant: req.body.variant || 'secondary',
    color: req.body.color,
    size: req.body.size || 'sm',
    location: req.body.location || 'record_detail',
    confirmMessage: req.body.confirmMessage,
    resultMode: req.body.resultMode || 'popup',
    order: req.body.order ?? obj.actionButtons.length,
    ...behaviour,
  };

  obj.actionButtons.push(action);
  obj.lastModifiedBy = req.user._id;

  await obj.save();
  // Return the stored button, which carries the _id used to edit or run it.
  const created = obj.actionButtons[obj.actionButtons.length - 1];

  await audit({
    tenantId: req.tenantId,
    userId: req.user._id,
    action: 'create',
    resource: 'ActionButton',
    resourceId: obj._id,
    metadata: { actionId: action.id },
    req,
  });

  sendSuccess(res, { data: created }, 'Action button created', 201);
});

/**
 * PUT /api/action-buttons/:objectApiName/:actionId
 */
export const updateActionButton = asyncHandler(async (req, res) => {
  const { objectApiName, actionId } = req.params;

  const obj = await ObjectMeta.findOne({
    tenantId: req.tenantId,
    apiName: objectApiName,
  });

  if (!obj) {
    throw new AppError(`Object "${objectApiName}" not found.`, 404);
  }

  if (!mongoose.isValidObjectId(actionId)) {
    throw new AppError('Action button not found.', 404);
  }
  const actionObjectId = new mongoose.Types.ObjectId(actionId);

  const action = obj.actionButtons.find((a) => a._id.equals(actionObjectId));
  if (!action) {
    throw new AppError('Action button not found.', 404);
  }

  const allowedUpdates = [
    'label',
    'icon',
    'variant',
    'color',
    'size',
    'location',
    'confirmMessage',
    'resultMode',
    'order',
  ];

  allowedUpdates.forEach((key) => {
    if (req.body[key] !== undefined) {
      action[key] = req.body[key];
    }
  });
  if (!String(action.label || '').trim()) throw new AppError('Button label is required.', 400);

  // What the button runs and when it shows are checked as a whole, against
  // the stored button for anything the request leaves out.
  const behaviour = await validateActionInput(req.tenantId, objectApiName, req.body, {
    actionType: action.actionType,
    automationId: action.automationId ? String(action.automationId) : undefined,
    nativeAction: action.nativeAction,
    conditions: (action.conditions || []).map((c) => ({ field: c.field, operator: c.operator, value: c.value })),
  });
  Object.assign(action, behaviour);

  obj.lastModifiedBy = req.user._id;
  await obj.save();

  await audit({
    tenantId: req.tenantId,
    userId: req.user._id,
    action: 'update',
    resource: 'ActionButton',
    resourceId: obj._id,
    metadata: { actionId },
    req,
  });

  sendSuccess(res, { data: action }, 'Action button updated');
});

/**
 * DELETE /api/action-buttons/:objectApiName/:actionId
 */
export const deleteActionButton = asyncHandler(async (req, res) => {
  const { objectApiName, actionId } = req.params;

  const obj = await ObjectMeta.findOne({
    tenantId: req.tenantId,
    apiName: objectApiName,
  });

  if (!obj) {
    throw new AppError(`Object "${objectApiName}" not found.`, 404);
  }

  if (!mongoose.isValidObjectId(actionId)) {
    throw new AppError('Action button not found.', 404);
  }
  const actionObjectId = new mongoose.Types.ObjectId(actionId);

  const index = obj.actionButtons.findIndex((a) =>
    a._id.equals(actionObjectId),
  );

  if (index === -1) {
    throw new AppError('Action button not found.', 404);
  }

  obj.actionButtons.splice(index, 1);
  obj.lastModifiedBy = req.user._id;

  await obj.save();

  await audit({
    tenantId: req.tenantId,
    userId: req.user._id,
    action: 'delete',
    resource: 'ActionButton',
    resourceId: obj._id,
    metadata: { actionId },
    req,
  });

  sendSuccess(res, {}, 'Action button deleted');
});

/**
 * POST /api/action-buttons/:objectApiName/reorder
 */
export const reorderActionButtons = asyncHandler(async (req, res) => {
  const { objectApiName } = req.params;
  const { order } = req.body; // [{ id, order }]

  const obj = await ObjectMeta.findOne({
    tenantId: req.tenantId,
    apiName: objectApiName,
  });

  if (!obj) throw new AppError(`Object "${objectApiName}" not found.`, 404);

  const map = new Map(order.map((o) => [o.id, o.order]));

  obj.actionButtons.forEach((a) => {
    if (map.has(a.id)) {
      a.order = map.get(a.id);
    }
  });

  obj.lastModifiedBy = req.user._id;
  await obj.save();

  await audit({
    tenantId: req.tenantId,
    userId: req.user._id,
    action: 'reorder',
    resource: 'ActionButton',
    resourceId: obj._id,
    req,
  });

  sendSuccess(res, { data: obj.actionButtons }, 'Action buttons reordered');
});

/**
 * POST /api/action-buttons/:objectApiName/:actionId/run  { recordId }
 * Runs a server-side platform action (e.g. Convert to Order) for one record.
 */
export const runActionButton = asyncHandler(async (req, res) => {
  const { objectApiName, actionId } = req.params;
  const result = await runNativeAction({ req, objectApiName, actionId, recordId: req.body?.recordId });

  await audit({
    tenantId: req.tenantId,
    userId: req.user._id,
    action: 'run',
    resource: 'ActionButton',
    objectApiName,
    metadata: { actionId, recordId: req.body?.recordId },
    req,
  });

  sendSuccess(res, { data: result }, result.message);
});
