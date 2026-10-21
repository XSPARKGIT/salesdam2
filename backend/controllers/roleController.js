import Role from '../models/Role.js';
import User from '../models/User.js';
import { asyncHandler, sendSuccess, AppError } from '../utils/errors.js';
import { audit } from '../utils/auditLogger.js';

const listRoles = asyncHandler(async (req, res) => {
  const roles = await Role.find({ tenantId: req.tenantId }).sort({ isSystem: -1, name: 1 });
  sendSuccess(res, { data: roles });
});

const getRole = asyncHandler(async (req, res) => {
  const role = await Role.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!role) throw new AppError('Role not found.', 404);
  sendSuccess(res, { data: role });
});

const createRole = asyncHandler(async (req, res) => {
  const { name } = req.body;
  const existing = await Role.findOne({ tenantId: req.tenantId, name });
  if (existing) throw new AppError(`Role "${name}" already exists.`, 409);

  const role = await Role.create({
    tenantId: req.tenantId,
    createdBy: req.user._id,
    ...req.body,
    isSystem: false, // user-created roles are never system roles
  });

  await audit({
    tenantId: req.tenantId, userId: req.user._id,
    action: 'create', resource: 'Role', resourceId: role._id, req,
  });

  sendSuccess(res, { data: role }, 'Role created', 201);
});

const updateRole = asyncHandler(async (req, res) => {
  const role = await Role.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!role) throw new AppError('Role not found.', 404);

  // Check if role is editable
  if (role.isEditable === false) {
    throw new AppError(`The ${role.label} role cannot be edited.`, 403);
  }

  if (role.isSystem && !req.user.isSuperuser()) {
    throw new AppError('System roles can only be modified by superusers.', 403);
  }

  const allowed = ['label', 'description', 'objectPermissions', 'appPermissions', 'dataAccess', 'isDefault'];
  allowed.forEach(key => {
    if (req.body[key] !== undefined) role[key] = req.body[key];
  });
  await role.save();

  await audit({
    tenantId: req.tenantId, userId: req.user._id,
    action: 'permission_change', resource: 'Role', resourceId: role._id, req,
  });

  sendSuccess(res, { data: role }, 'Role updated');
});

const deleteRole = asyncHandler(async (req, res) => {
  const role = await Role.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!role) throw new AppError('Role not found.', 404);

  // Check if role is editable (non-editable roles cannot be deleted)
  if (role.isEditable === false) {
    throw new AppError(`The ${role.label} role cannot be deleted.`, 403);
  }

  if (role.isSystem) throw new AppError('System roles cannot be deleted.', 403);

  // Check if any users are using this role. A user holds a single `role` ref,
  // so query that field — a `roles` array query never matches and let
  // in-use roles be deleted.
  const usersWithRole = await User.countDocuments({ tenantId: req.tenantId, role: role._id });
  if (usersWithRole > 0) {
    throw new AppError(`Cannot delete role - ${usersWithRole} user(s) are assigned to it.`, 409);
  }

  await Role.deleteOne({ _id: role._id });

  sendSuccess(res, {}, 'Role deleted');
});

const assignRole = asyncHandler(async (req, res) => {
  const { userId, roleId } = req.body;
  const user = await User.findOne({ _id: userId, tenantId: req.tenantId });
  if (!user) throw new AppError('User not found.', 404);

  const role = await Role.findOne({ _id: roleId, tenantId: req.tenantId });
  if (!role) throw new AppError('Role not found.', 404);

  user.role = roleId;
  await user.save();

  await audit({
    tenantId: req.tenantId, userId: req.user._id,
    action: 'role_assign', resource: 'User', resourceId: userId,
    details: { roleId, roleName: role.name }, req,
  });

  sendSuccess(res, {}, 'Role assigned');
});

const removeRole = asyncHandler(async (req, res) => {
  const { userId, roleId } = req.body;
  const user = await User.findOne({ _id: userId, tenantId: req.tenantId });
  if (!user) throw new AppError('User not found.', 404);

  if (user.role?.toString() === roleId) {
    user.role = undefined;
    await user.save();
  }

  await audit({
    tenantId: req.tenantId, userId: req.user._id,
    action: 'role_remove', resource: 'User', resourceId: userId, req,
  });

  sendSuccess(res, {}, 'Role removed');
});

export { listRoles, getRole, createRole, updateRole, deleteRole, assignRole, removeRole };
