import Role from '../models/Role.js';
import { SALESDAM_OBJECTS } from '../config/objects/index.js';

const generateFieldPermissions = (objectApiName, canEdit) => {
  const obj = SALESDAM_OBJECTS.find(o => o.apiName === objectApiName);
  if (!obj || !obj.fields) return [];

  return obj.fields
    .filter(f => !f.isReadOnly)
    .map(f => ({
      fieldApiName: f.apiName,
      canView: true,
      canEdit: (f.type === 'auto_number' || f.type === 'formula') ? false : canEdit,
    }));
};

/**
 * Seed default roles for a new tenant.
 * Creates: superuser, admin, and standard user roles.
 */
const seedDefaultRoles = async (tenantId, session = null) => {
  const defaultRoles = [
    {
      name: 'superuser',
      label: 'Super User',
      description: 'Full system access - all objects, all tenants',
      isSystem: true,
      isEditable: false,
      appPermissions: {
        canCustomizeApplication: true,
        canManageUsers: true,
        canManageRoles: true,
        canManageObjects: true,
        canManageLayouts: true,
        canManageAutomations: true,
        canManageApprovals: true,
        canManageCustomCode: true,
        canDeployCustomCode: true,
        canManageIntegrations: true,
        canViewAnalytics: true,
        canManageAnalytics: true,
        canViewAuditLog: true,
        canManageTenantSettings: true,
        canManageApiKeys: true,
        canManageWebhooks: true,
        canExportData: true,
        canImportData: true,
        canViewCallRecordings: true,
        canManageCommunicationTemplates: true,
        canManageDocumentTemplates: true,
      },
      dataAccess: 'all',
    },
    {
      name: 'admin',
      label: 'Administrator',
      description:
        'Full access within the workspace, one level below superuser',
      isSystem: true,
      appPermissions: {
        canCustomizeApplication: true,
        canManageUsers: true,
        canManageRoles: true,
        canManageObjects: true,
        canManageLayouts: true,
        canManageAutomations: true,
        canManageApprovals: true,
        canManageCustomCode: true,
        canDeployCustomCode: true,
        canManageIntegrations: true,
        canViewAnalytics: true,
        canManageAnalytics: true,
        canViewAuditLog: true,
        canManageTenantSettings: true,
        canManageApiKeys: true,
        canManageWebhooks: true,
        canExportData: true,
        canImportData: true,
        canViewCallRecordings: true,
        canManageCommunicationTemplates: true,
        canManageDocumentTemplates: true,
      },
      dataAccess: 'all',
    },
    {
      name: 'standard_user',
      label: 'Standard User',
      description: 'Standard access - read/write all records',
      isSystem: true,
      isDefault: true,
      appPermissions: {
        canViewAnalytics: true,
      },
      dataAccess: 'all',
    },
    {
      name: 'read_only',
      label: 'Read Only',
      description: 'Can view records but not create/edit/delete',
      isSystem: true,
      appPermissions: {},
      dataAccess: 'all',
    },
  ];

  for (const roleDef of defaultRoles) {
    const query = { tenantId, name: roleDef.name };
    const existing = session
      ? await Role.findOne(query).session(session)
      : await Role.findOne(query);
    if (!existing) {
      const createOpts = session ? { session } : undefined;
      await Role.create([{ tenantId, ...roleDef }], createOpts);
    }
  }

  // After creating roles, set object permissions for standard objects
  await setStandardObjectPermissions(tenantId, session);
};

const setStandardObjectPermissions = async (tenantId, session = null) => {
  const standardObjects = [
    'client',
    'contact',
    'lead',
    'opportunity',
    'task',
    'case',
    'deal',
    'order',
    'product',
    'quote',
    'invoice',
    'support_document',
    'deal_line_item',
    'order_line_item',
  ];

  const opts = session ? { session } : undefined;

  // Superuser role — unrestricted access to all objects
  const superuserRole = session
    ? await Role.findOne({ tenantId, name: 'superuser' }).session(session)
    : await Role.findOne({ tenantId, name: 'superuser' });

  if (superuserRole) {
    superuserRole.objectPermissions = standardObjects.map((obj) => ({
      objectApiName: obj,
      canCreate: true,
      canRead: true,
      canUpdate: true,
      canDelete: true,
      canExport: true,
      canImport: true,
      fieldPermissions: generateFieldPermissions(obj, true),
    }));
    superuserRole.isEditable = false;
    await superuserRole.save(opts);
  }

  // Administrator role — full access within tenant
  const adminRole = session
    ? await Role.findOne({ tenantId, name: 'admin' }).session(session)
    : await Role.findOne({ tenantId, name: 'admin' });

  if (adminRole) {
    adminRole.objectPermissions = standardObjects.map((obj) => ({
      objectApiName: obj,
      canCreate: true,
      canRead: true,
      canUpdate: true,
      canDelete: true,
      canExport: true,
      canImport: true,
      fieldPermissions: generateFieldPermissions(obj, true),
    }));
    await adminRole.save(opts);
  }

  // Standard User role — full read/write on all objects
  const standardRole = session
    ? await Role.findOne({ tenantId, name: 'standard_user' }).session(session)
    : await Role.findOne({ tenantId, name: 'standard_user' });

  if (standardRole) {
    standardRole.objectPermissions = standardObjects.map((obj) => ({
      objectApiName: obj,
      canCreate: true,
      canRead: true,
      canUpdate: true,
      canDelete: true,
      canExport: true,
      canImport: true,
      fieldPermissions: generateFieldPermissions(obj, true),
    }));
    await standardRole.save(opts);
  }

  // Read Only role — view only access
  const readOnlyRole = session
    ? await Role.findOne({ tenantId, name: 'read_only' }).session(session)
    : await Role.findOne({ tenantId, name: 'read_only' });

  if (readOnlyRole) {
    readOnlyRole.objectPermissions = standardObjects.map((obj) => ({
      objectApiName: obj,
      canCreate: false,
      canRead: true,
      canUpdate: false,
      canDelete: false,
      canExport: false,
      canImport: false,
      fieldPermissions: generateFieldPermissions(obj, false),
    }));
    await readOnlyRole.save(opts);
  }
};

export { seedDefaultRoles };
