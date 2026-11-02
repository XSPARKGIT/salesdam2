import mongoose from 'mongoose';
import PermissionSet from '../models/PermissionSet.js';
import User from '../models/User.js';
import { validateAppIds } from '../services/appAccessService.js';
import { asyncHandler, sendSuccess, AppError } from '../utils/errors.js';
import { audit } from '../utils/auditLogger.js';

/**
 * Permission Sets (BRD 5.3) — grant Apps to individual users on top of their
 * Role. See services/appAccessService.js for how access is worked out.
 */

const toApiName = (label) =>
  String(label || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

// Each user id must be an active user in this tenant.
const validateUserIds = async (tenantId, userIds) => {
  if (userIds === undefined) return undefined;
  if (!Array.isArray(userIds)) throw new AppError('assignedUserIds must be an array.', 400);
  const unique = [...new Set(userIds.map(String))];
  if (unique.some((id) => !mongoose.isValidObjectId(id))) throw new AppError('Unknown user.', 400);
  const found = await User.countDocuments({ tenantId, _id: { $in: unique } });
  if (found !== unique.length) throw new AppError('One or more users do not exist.', 400);
  return unique;
};

const populate = (query) =>
  query
    .populate('appIds', 'name color icon status')
    .populate('assignedUserIds', 'firstName lastName email status');

/* ── GET /api/permission-sets ─────────────────────────────────────────────── */
const listPermissionSets = asyncHandler(async (req, res) => {
  const sets = await populate(PermissionSet.find({ tenantId: req.tenantId }).sort({ label: 1 }));
  sendSuccess(res, { data: sets });
});

/* ── GET /api/permission-sets/:id ─────────────────────────────────────────── */
const getPermissionSet = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new AppError('Permission set not found.', 404);
  const set = await populate(PermissionSet.findOne({ _id: req.params.id, tenantId: req.tenantId }));
  if (!set) throw new AppError('Permission set not found.', 404);
  sendSuccess(res, { data: set });
});

/* ── POST /api/permission-sets ────────────────────────────────────────────── */
const createPermissionSet = asyncHandler(async (req, res) => {
  const label = String(req.body.label || '').trim();
  if (!label) throw new AppError('Label is required.', 400);
  const name = toApiName(req.body.name || label);
  if (!name) throw new AppError('Name must contain letters or numbers.', 400);
  if (await PermissionSet.exists({ tenantId: req.tenantId, name })) {
    throw new AppError(`A permission set named "${name}" already exists.`, 409);
  }

  const set = await PermissionSet.create({
    tenantId: req.tenantId,
    name,
    label,
    description: req.body.description,
    appIds: (await validateAppIds(req.tenantId, req.body.appIds)) || [],
    systemPermissions: req.body.systemPermissions || {},
    assignedUserIds: (await validateUserIds(req.tenantId, req.body.assignedUserIds)) || [],
    createdBy: req.user._id,
    lastModifiedBy: req.user._id,
  });

  await audit({
    tenantId: req.tenantId, userId: req.user._id,
    action: 'create', resource: 'PermissionSet', resourceId: set._id, req,
  });

  sendSuccess(res, { data: set }, 'Permission set created', 201);
});

/* ── PUT /api/permission-sets/:id ─────────────────────────────────────────── */
const updatePermissionSet = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new AppError('Permission set not found.', 404);
  const set = await PermissionSet.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!set) throw new AppError('Permission set not found.', 404);

  if (req.body.label !== undefined) {
    const label = String(req.body.label).trim();
    if (!label) throw new AppError('Label is required.', 400);
    set.label = label;
  }
  if (req.body.description !== undefined) set.description = req.body.description;
  const appIds = await validateAppIds(req.tenantId, req.body.appIds);
  if (appIds !== undefined) set.appIds = appIds;
  if (req.body.systemPermissions !== undefined) set.systemPermissions = req.body.systemPermissions;
  const userIds = await validateUserIds(req.tenantId, req.body.assignedUserIds);
  if (userIds !== undefined) set.assignedUserIds = userIds;
  set.lastModifiedBy = req.user._id;
  await set.save();

  await audit({
    tenantId: req.tenantId, userId: req.user._id,
    action: 'permission_change', resource: 'PermissionSet', resourceId: set._id, req,
  });

  sendSuccess(res, { data: set }, 'Permission set updated');
});

/* ── DELETE /api/permission-sets/:id ──────────────────────────────────────── */
const deletePermissionSet = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new AppError('Permission set not found.', 404);
  const set = await PermissionSet.findOneAndDelete({ _id: req.params.id, tenantId: req.tenantId });
  if (!set) throw new AppError('Permission set not found.', 404);

  await audit({
    tenantId: req.tenantId, userId: req.user._id,
    action: 'delete', resource: 'PermissionSet', resourceId: set._id, req,
  });

  sendSuccess(res, {}, 'Permission set deleted');
});

export {
  listPermissionSets,
  getPermissionSet,
  createPermissionSet,
  updatePermissionSet,
  deletePermissionSet,
};
