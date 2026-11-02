import mongoose from 'mongoose';
import Workspace from '../models/Workspace.js';
import FieldMeta from '../models/FieldMeta.js';
import Role from '../models/Role.js';
import { AppError } from '../utils/errors.js';
import { accessibleWorkspaceFilter } from './appAccessService.js';

/**
 * Object access for signed-in users — workspace isolation plus role grants.
 *
 *  - Workspace: a user only works with the objects of their active workspace
 *    (Workspace.allowedObjects). An empty list means the workspace has no
 *    objects. This applies to every role, superusers included.
 *  - Role: superusers and admins have full CRUD on the workspace's objects;
 *    every other role only sees objects its objectPermissions grant canRead on
 *    (create/update/delete are checked per route by checkObjectPermission).
 *
 * Requests authenticated by API key have no workspace and are not scoped here;
 * the key's own allowedObjects restriction applies to them instead.
 *
 * Results are memoised on the request, so calling these repeatedly is cheap.
 */

const FULL_ACCESS_ROLES = ['superuser', 'admin'];

// The user directory backs owner and user lookups on every object.
const ALWAYS_REACHABLE = ['user'];

export const hasFullObjectAccess = (user) => FULL_ACCESS_ROLES.includes(user?.role?.name);

const roleDocFor = async (user) => {
  const role = user?.role;
  if (!role) return null;
  return role.objectPermissions ? role : Role.findById(role._id || role);
};

/**
 * Users who configure the org (object manager, roles, workspaces) need the full
 * object catalogue on setup pages. Record data stays workspace-scoped for them.
 */
export const canManageSetup = async (user) => {
  if (hasFullObjectAccess(user)) return true;
  const role = await roleDocFor(user);
  return Boolean(role?.appPermissions?.canManageObjects || role?.appPermissions?.canManageRoles);
};

const isScoped = (req) => Boolean(req.user && !req.apiKey);

/**
 * The workspace the user is working in: the one recorded on their session when
 * they still belong to it, otherwise their default/first workspace (the same
 * fallback the app uses). Null when they belong to none.
 */
export const resolveActiveWorkspace = async (req) => {
  if (req._activeWorkspace !== undefined) return req._activeWorkspace;

  // The user's Apps: Role, Permission Sets, membership or the default (BRD 5.3).
  const membership = await accessibleWorkspaceFilter(req.user, req.tenantId);
  const select = 'name allowedObjects isDefault';

  let ws = null;
  const sessionWsId = req.sessionData?.workspaceId;
  if (sessionWsId && mongoose.isValidObjectId(sessionWsId)) {
    ws = await Workspace.findOne({ ...membership, _id: sessionWsId }).select(select).lean();
  }
  if (!ws) {
    ws = await Workspace.findOne(membership).sort({ isDefault: -1, name: 1 }).select(select).lean();
  }

  req._activeWorkspace = ws;
  return ws;
};

/** apiNames of the active workspace's objects; null when the request isn't workspace-scoped. */
export const getWorkspaceObjects = async (req) => {
  if (!isScoped(req)) return null;
  const ws = await resolveActiveWorkspace(req);
  return new Set(ws?.allowedObjects || []);
};

/**
 * apiNames the user can see in the active workspace: the workspace's objects,
 * narrowed to the role's readable objects for non-admin roles.
 * Null when the request isn't workspace-scoped.
 */
export const getVisibleObjects = async (req) => {
  if (req._visibleObjects !== undefined) return req._visibleObjects;
  const inWorkspace = await getWorkspaceObjects(req);
  if (!inWorkspace) {
    req._visibleObjects = null;
    return null;
  }

  let visible = inWorkspace;
  if (!hasFullObjectAccess(req.user)) {
    const role = await roleDocFor(req.user);
    const readable = new Set(
      (role?.objectPermissions || []).filter((p) => p.canRead).map((p) => p.objectApiName),
    );
    visible = new Set([...inWorkspace].filter((n) => readable.has(n)));
  }

  req._visibleObjects = visible;
  return visible;
};

/**
 * apiNames the user's Role can read, in any workspace — for reports, which
 * follow object permissions rather than the App Switcher (BRD 5.3). Null when
 * the user can read everything (or the request isn't user-scoped).
 */
export const getReadableObjects = async (req) => {
  if (!isScoped(req) || hasFullObjectAccess(req.user)) return null;
  const role = await roleDocFor(req.user);
  return new Set(
    (role?.objectPermissions || []).filter((p) => p.canRead).map((p) => p.objectApiName),
  );
};

/**
 * apiNames whose records may be reached from the active workspace: its own
 * objects, plus the objects directly related to them by a lookup — the parents
 * their lookup fields point at, and the children listed in their related lists.
 * Role permissions are checked separately. Null when not workspace-scoped.
 */
export const getReachableObjects = async (req) => {
  if (req._reachableObjects !== undefined) return req._reachableObjects;
  const inWorkspace = await getWorkspaceObjects(req);
  if (!inWorkspace) {
    req._reachableObjects = null;
    return null;
  }

  const reachable = new Set([...inWorkspace, ...ALWAYS_REACHABLE]);
  if (inWorkspace.size > 0) {
    const names = [...inWorkspace];
    const links = await FieldMeta.find({
      tenantId: req.tenantId,
      type: { $in: ['lookup', 'master_detail'] },
      $or: [{ objectApiName: { $in: names } }, { lookupObjectApiName: { $in: names } }],
    })
      .select('objectApiName lookupObjectApiName')
      .lean();
    for (const l of links) {
      if (l.objectApiName) reachable.add(l.objectApiName);
      if (l.lookupObjectApiName) reachable.add(l.lookupObjectApiName);
    }
  }

  req._reachableObjects = reachable;
  return reachable;
};

/**
 * Express param handler: rejects record access to objects outside the active
 * workspace (and the objects related to it). Use with router.param().
 */
export const requireReachableObject = async (req, res, next, objectApiName) => {
  try {
    const reachable = await getReachableObjects(req);
    if (!reachable || reachable.has(objectApiName)) return next();
    return next(new AppError(`"${objectApiName}" is not available in your current workspace.`, 403));
  } catch (err) {
    return next(err);
  }
};

/**
 * Express param handler for object metadata: setup users may read any object's
 * definition (object manager); everyone else only objects reachable from their
 * workspace. Record data is additionally gated by role permissions.
 */
export const requireObjectMetadataAccess = async (req, res, next, objectApiName) => {
  try {
    if (!isScoped(req) || (await canManageSetup(req.user))) return next();
    return requireReachableObject(req, res, next, objectApiName);
  } catch (err) {
    return next(err);
  }
};
