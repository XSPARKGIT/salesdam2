import Role from '../models/Role.js';
import User from '../models/User.js';
import { AppError } from '../utils/errors.js';

/**
 * hasObjectPermission(user, action, objectApiName)
 * Programmatic form of checkObjectPermission, for callers whose object is only
 * known at runtime (e.g. "create the record this conversation maps to").
 */
const hasObjectPermission = async (user, action, objectApiName) => {
  if (user?.role?.name === 'superuser' || user?.role?.name === 'admin') return true;
  if (!objectApiName) return false;
  const userRole = user?.role;
  if (!userRole) return false;
  const roleDoc = userRole.objectPermissions
    ? userRole
    : await Role.findById(userRole._id || userRole);
  return Boolean(roleDoc && roleDoc.can(action, objectApiName));
};

/**
 * checkObjectPermission(action, objectApiName)
 * Factory middleware - verifies the user has the given action on the object.
 * Actions: 'create' | 'read' | 'update' | 'delete' | 'export'
 */
const checkObjectPermission = (action, objectApiName) => {
  return async (req, res, next) => {
    try {
      // Superuser always has full access
      if (req.user.role?.name === 'superuser') return next();

      // Admin has full access within tenant
      if (req.user.role?.name === 'admin') return next();

      const objName = objectApiName || req.params.objectApiName;
      if (!objName)
        return next(
          new AppError('Object API name required for permission check.', 400),
        );

      if (await hasObjectPermission(req.user, action, objName)) return next();

      return next(
        new AppError(`You do not have permission to ${action} on ${objName}.`, 403),
      );
    } catch (err) {
      next(err);
    }
  };
};

/**
 * checkAppPermission(permissionKey)
 * Checks app-level permissions like canManageUsers, canViewAnalytics, etc.
 */
const checkAppPermission = (permissionKey) => {
  return async (req, res, next) => {
    try {
      if (req.user.role?.name === 'superuser') return next();
      if (req.user.role?.name === 'admin') return next();

      const userRole = req.user.role;
      if (!userRole) {
        return next(new AppError('Permission denied.', 403));
      }

      const roleDoc = userRole.appPermissions
        ? userRole
        : await Role.findById(userRole._id || userRole);

      if (
        !roleDoc ||
        !roleDoc.appPermissions ||
        !roleDoc.appPermissions[permissionKey]
      ) {
        return next(new AppError('Permission denied.', 403));
      }

      next();
    } catch (err) {
      next(err);
    }
  };
};

/**
 * filterFieldsByPermission - Utility to strip fields the user can't view.
 * Returns an object with only the fields the user has permission to see.
 * Name fields are always visible to all users.
 */
const getVisibleFields = async (user, objectApiName, fieldApiNames) => {
  if (user.role?.name === 'superuser' || user.role?.name === 'admin') {
    return fieldApiNames; // All fields
  }

  // Get the object's name field to ensure it's always visible
  const ObjectMeta = (await import('../models/ObjectMeta.js')).default;
  const objectMeta = await ObjectMeta.findOne({
    tenantId: user.tenantId,
    apiName: objectApiName,
  }).select('nameFieldApiName');

  const nameFieldApiName = objectMeta?.nameFieldApiName || 'name';

  const userRole = user.role;
  if (!userRole) return fieldApiNames;

  const roleDoc = userRole.objectPermissions
    ? userRole
    : await Role.findById(userRole._id || userRole);
  if (!roleDoc) return fieldApiNames;

  const objPerm = roleDoc.getObjectPermission(objectApiName);
  // SEC-002/FLD-013: fail closed — if the role has no entry for this object,
  // expose only the name field rather than every field.
  if (!objPerm) return fieldApiNames.filter((f) => f === nameFieldApiName);

  const hiddenFields = new Set(
    (objPerm.fieldPermissions || [])
      .filter((fp) => !fp.canView)
      .map((fp) => fp.fieldApiName),
  );

  // Always include the name field, even if it would normally be hidden
  hiddenFields.delete(nameFieldApiName);

  return fieldApiNames.filter((f) => !hiddenFields.has(f));
};

/**
 * getEditableFields - Returns fields the user can edit.
 * Name fields are read-only for non-admin users (all users can read them).
 */
const getEditableFields = async (user, objectApiName, fieldApiNames) => {
  if (user.role?.name === 'superuser' || user.role?.name === 'admin') {
    return fieldApiNames;
  }

  // Get the object's name field - it should be read-only for non-admin users
  const ObjectMeta = (await import('../models/ObjectMeta.js')).default;
  const objectMeta = await ObjectMeta.findOne({
    tenantId: user.tenantId,
    apiName: objectApiName,
  }).select('nameFieldApiName');

  const nameFieldApiName = objectMeta?.nameFieldApiName || 'name';

  const userRole = user.role;
  if (!userRole) return fieldApiNames.filter((f) => f !== nameFieldApiName);

  const roleDoc = userRole.objectPermissions
    ? userRole
    : await Role.findById(userRole._id || userRole);
  if (!roleDoc) return fieldApiNames.filter((f) => f !== nameFieldApiName);

  const objPerm = roleDoc.getObjectPermission(objectApiName);
  // SEC-002: fail closed — no role entry means no editable fields.
  if (!objPerm) return [];

  const readOnlyFields = new Set(
    (objPerm.fieldPermissions || [])
      .filter((fp) => !fp.canEdit)
      .map((fp) => fp.fieldApiName),
  );

  // Always make the name field read-only for non-admin users
  readOnlyFields.add(nameFieldApiName);

  return fieldApiNames.filter((f) => !readOnlyFields.has(f));
};

/**
 * buildDataAccessFilter(user)
 *
 * Returns a MongoDB query fragment that restricts records to those the user
 * is allowed to see based on their role's dataAccess setting:
 *
 *   'all'                  → {} (no restriction)
 *   'own'                  → { ownerId: user._id }
 *   'own_and_subordinates' → { ownerId: { $in: [user._id, ...subordinateUserIds] } }
 *   'custom'               → treated as 'own' until custom rules are configured
 *
 * Superusers and admins always receive {} (full access).
 */
const buildDataAccessFilter = async (user) => {
  if (user.role?.name === 'superuser' || user.role?.name === 'admin') return {};

  const userRole = user.role;
  if (!userRole) return { ownerId: user._id };

  const roleDoc =
    userRole.dataAccess !== undefined
      ? userRole
      : await Role.findById(userRole._id || userRole);

  if (!roleDoc) return { ownerId: user._id };

  switch (roleDoc.dataAccess) {
    case 'all':
      return {};

    case 'own_and_subordinates': {
      // Find roles that list this role as their parentRole
      const subordinateRoles = await Role.find({
        tenantId: user.tenantId,
        parentRole: roleDoc._id,
      }).select('_id');

      if (subordinateRoles.length === 0) {
        return { ownerId: user._id };
      }

      const subordinateUsers = await User.find({
        tenantId: user.tenantId,
        role: { $in: subordinateRoles.map((r) => r._id) },
        status: 'active',
      }).select('_id');

      return {
        ownerId: { $in: [user._id, ...subordinateUsers.map((u) => u._id)] },
      };
    }

    case 'own':
    case 'custom':
    default:
      return { ownerId: user._id };
  }
};

export {
  checkObjectPermission,
  hasObjectPermission,
  checkAppPermission,
  getVisibleFields,
  getEditableFields,
  buildDataAccessFilter,
};
