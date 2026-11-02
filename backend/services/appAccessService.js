import mongoose from 'mongoose';
import Role from '../models/Role.js';
import PermissionSet from '../models/PermissionSet.js';
import Workspace from '../models/Workspace.js';
import { AppError } from '../utils/errors.js';

/**
 * App access (BRD 5.3) — which Apps (Workspaces) appear in a user's App
 * Switcher. An App is available when any of these grants it:
 *  - the user's Role (Profile):          Role.appIds
 *  - a Permission Set assigned to them:  PermissionSet.appIds
 *  - direct membership:                  Workspace.memberIds
 *  - it is the tenant's default App
 *
 * This is separate from object permissions: a Role can read Policy records
 * (e.g. for reports) without the Insurance App in its switcher, and an App in
 * the switcher still only shows the objects the Role can read.
 */

const ids = (list = []) => list.filter(Boolean).map((id) => String(id._id || id));

/** Workspace ids granted to the user by their Role and Permission Sets. */
export const getGrantedAppIds = async (user, tenantId) => {
  const roleId = user?.role?._id || user?.role;
  const [role, sets] = await Promise.all([
    roleId ? Role.findOne({ _id: roleId, tenantId }).select('appIds').lean() : null,
    PermissionSet.find({ tenantId, assignedUserIds: user._id }).select('appIds').lean(),
  ]);
  return [...new Set([...ids(role?.appIds), ...sets.flatMap((s) => ids(s.appIds))])];
};

/** Mongo filter for the active Workspaces this user can open. */
export const accessibleWorkspaceFilter = async (user, tenantId) => {
  const granted = await getGrantedAppIds(user, tenantId);
  return {
    tenantId,
    status: 'active',
    $or: [
      { memberIds: user._id },
      { isDefault: true }, // the default App is available to everyone
      ...(granted.length ? [{ _id: { $in: granted } }] : []),
    ],
  };
};

/**
 * Check a list of App ids from the admin UI: each must be a live Workspace in
 * this tenant. Returns the de-duplicated ids.
 */
export const validateAppIds = async (tenantId, appIds) => {
  if (appIds === undefined) return undefined;
  if (!Array.isArray(appIds)) throw new AppError('appIds must be an array.', 400);
  const unique = [...new Set(appIds.map(String))];
  if (unique.some((id) => !mongoose.isValidObjectId(id))) throw new AppError('Unknown app.', 400);
  const found = await Workspace.countDocuments({
    tenantId,
    _id: { $in: unique },
    status: { $ne: 'deleted' },
  });
  if (found !== unique.length) throw new AppError('One or more apps do not exist.', 400);
  return unique;
};
