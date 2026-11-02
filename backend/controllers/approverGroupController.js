import mongoose from 'mongoose';
import ApproverGroup from '../models/ApproverGroup.js';
import ApprovalProcess from '../models/ApprovalProcess.js';
import User from '../models/User.js';
import Role from '../models/Role.js';
import { asyncHandler, sendSuccess, AppError } from '../utils/errors.js';
import { audit } from '../utils/auditLogger.js';

/** Public groups of approvers (BRD §8) — an approval step can name one. */

const toApiName = (label) =>
  String(label || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

const cleanIds = async (tenantId, ids, Model, what) => {
  if (ids === undefined) return undefined;
  if (!Array.isArray(ids)) throw new AppError(`${what} must be a list.`, 400);
  const unique = [...new Set(ids.map(String))];
  if (unique.some((id) => !mongoose.isValidObjectId(id))) throw new AppError(`Unknown ${what}.`, 400);
  const found = await Model.countDocuments({ tenantId, _id: { $in: unique } });
  if (found !== unique.length) throw new AppError(`One or more ${what} do not exist.`, 400);
  return unique;
};

const populate = (q) =>
  q.populate('memberIds', 'firstName lastName email status').populate('roleIds', 'name label');

const listGroups = asyncHandler(async (req, res) => {
  sendSuccess(res, { data: await populate(ApproverGroup.find({ tenantId: req.tenantId }).sort({ label: 1 })) });
});

const createGroup = asyncHandler(async (req, res) => {
  const label = String(req.body.label || '').trim();
  if (!label) throw new AppError('Label is required.', 400);
  const name = toApiName(req.body.name || label);
  if (!name) throw new AppError('Name must contain letters or numbers.', 400);
  if (await ApproverGroup.exists({ tenantId: req.tenantId, name })) {
    throw new AppError(`An approver group named "${name}" already exists.`, 409);
  }
  const group = await ApproverGroup.create({
    tenantId: req.tenantId,
    name,
    label,
    description: req.body.description,
    memberIds: (await cleanIds(req.tenantId, req.body.memberIds, User, 'users')) || [],
    roleIds: (await cleanIds(req.tenantId, req.body.roleIds, Role, 'roles')) || [],
    createdBy: req.user._id,
  });
  await audit({ tenantId: req.tenantId, userId: req.user._id, action: 'create', resource: 'ApproverGroup', resourceId: group._id, req });
  sendSuccess(res, { data: group }, 'Approver group created', 201);
});

const updateGroup = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new AppError('Approver group not found.', 404);
  const group = await ApproverGroup.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!group) throw new AppError('Approver group not found.', 404);
  if (req.body.label !== undefined) {
    const label = String(req.body.label).trim();
    if (!label) throw new AppError('Label is required.', 400);
    group.label = label;
  }
  if (req.body.description !== undefined) group.description = req.body.description;
  const memberIds = await cleanIds(req.tenantId, req.body.memberIds, User, 'users');
  if (memberIds !== undefined) group.memberIds = memberIds;
  const roleIds = await cleanIds(req.tenantId, req.body.roleIds, Role, 'roles');
  if (roleIds !== undefined) group.roleIds = roleIds;
  await group.save();
  await audit({ tenantId: req.tenantId, userId: req.user._id, action: 'update', resource: 'ApproverGroup', resourceId: group._id, req });
  sendSuccess(res, { data: group }, 'Approver group updated');
});

const deleteGroup = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new AppError('Approver group not found.', 404);
  const group = await ApproverGroup.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!group) throw new AppError('Approver group not found.', 404);
  // A group used by a process can't go: its approvals would have nobody to decide.
  const using = await ApprovalProcess.find({ tenantId: req.tenantId, 'steps.approverGroupId': group._id }).select('name').lean();
  if (using.length) {
    throw new AppError(`"${group.label}" is used by the approval process${using.length > 1 ? 'es' : ''} ${using.map((p) => `"${p.name}"`).join(', ')}. Change those steps first.`, 409);
  }
  await group.deleteOne();
  await audit({ tenantId: req.tenantId, userId: req.user._id, action: 'delete', resource: 'ApproverGroup', resourceId: group._id, req });
  sendSuccess(res, {}, 'Approver group deleted');
});

export { listGroups, createGroup, updateGroup, deleteGroup };
