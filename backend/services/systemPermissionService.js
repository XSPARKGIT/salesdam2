import PermissionSet from '../models/PermissionSet.js';

/**
 * All system permission keys recognised by the platform (BRD 9.3).
 * The order here is the canonical display order in the admin UI.
 */
export const SYSTEM_PERMISSION_KEYS = [
  'canCustomizeApplication',
  'canManageObjects',
  'canManageLayouts',
  'canManageAutomations',
  'canManageApprovals',
  'canManageCustomCode',
  'canDeployCustomCode',
  'canManageIntegrations',
  'canManageApiKeys',
  'canManageWebhooks',
  'canManageUsers',
  'canManageRoles',
  'canManageTenantSettings',
  'canExportData',
  'canImportData',
  'canViewAuditLog',
  'canViewAnalytics',
  'canManageAnalytics',
  'canViewCallRecordings',
  'canManageCommunicationTemplates',
  'canManageDocumentTemplates',
];

export const SYSTEM_PERMISSION_LABELS = {
  canCustomizeApplication: 'Customize Application',
  canManageObjects: 'Manage Custom Objects and Fields',
  canManageLayouts: 'Manage Page Layouts',
  canManageAutomations: 'Manage Flows',
  canManageApprovals: 'Manage Approval Processes',
  canManageCustomCode: 'Manage Custom Code',
  canDeployCustomCode: 'Deploy Custom Code',
  canManageIntegrations: 'Manage Integrations',
  canManageApiKeys: 'Manage API Credentials',
  canManageWebhooks: 'Manage Webhooks',
  canManageUsers: 'Manage Users',
  canManageRoles: 'Manage Profiles and Permissions',
  canManageTenantSettings: 'Manage Tenant Configuration',
  canExportData: 'Export Data',
  canImportData: 'Import Data',
  canViewAuditLog: 'View Audit Logs',
  canViewAnalytics: 'View Analytics',
  canManageAnalytics: 'Manage Analytics',
  canViewCallRecordings: 'View Call Recordings',
  canManageCommunicationTemplates: 'Manage Communication Templates',
  canManageDocumentTemplates: 'Manage Document Templates',
};

/**
 * Compute the effective system permissions for a user by merging their Role's
 * appPermissions with every Permission Set assigned to them.  The merge is
 * additive: if *any* source grants a permission, the user has it.
 *
 * Superuser and admin roles are handled by the middleware (they bypass
 * permission checks), so this function returns the raw computed set.
 */
export async function getEffectivePermissions(user) {
  const result = {};
  const rolePerms = user.role?.appPermissions;

  for (const key of SYSTEM_PERMISSION_KEYS) {
    result[key] = !!(rolePerms?.[key]);
  }

  const sets = await PermissionSet.find({
    tenantId: user.tenantId,
    assignedUserIds: user._id,
  }).select('systemPermissions').lean();

  for (const set of sets) {
    if (!set.systemPermissions) continue;
    for (const key of SYSTEM_PERMISSION_KEYS) {
      if (set.systemPermissions[key]) result[key] = true;
    }
  }

  return result;
}

/**
 * Check whether a user has a specific system permission, considering their
 * Role *and* all assigned Permission Sets.
 */
export async function hasSystemPermission(user, permissionKey) {
  if (user.role?.name === 'superuser' || user.role?.name === 'admin') return true;
  if (user.role?.appPermissions?.[permissionKey]) return true;

  const count = await PermissionSet.countDocuments({
    tenantId: user.tenantId,
    assignedUserIds: user._id,
    [`systemPermissions.${permissionKey}`]: true,
  });
  return count > 0;
}
