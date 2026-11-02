import mongoose from 'mongoose';

/**
 * PermissionSet — extra access granted to individual users on top of their
 * Role (Profile). BRD 5.3: Apps; BRD 9.3: System Permissions.
 * A user's effective permissions = their Role's permissions ∪ every assigned
 * Permission Set's systemPermissions.
 */
const permissionSetSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true, lowercase: true },
    label: { type: String, required: true, trim: true },
    description: { type: String, trim: true },

    // Apps (Workspaces) this set adds to its users' App Switcher.
    appIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Workspace' }],

    // System Permissions (BRD 9.3) — additive on top of the Role.
    systemPermissions: {
      canCustomizeApplication: { type: Boolean, default: false },
      canManageUsers: { type: Boolean, default: false },
      canManageRoles: { type: Boolean, default: false },
      canManageObjects: { type: Boolean, default: false },
      canManageLayouts: { type: Boolean, default: false },
      canManageAutomations: { type: Boolean, default: false },
      canManageApprovals: { type: Boolean, default: false },
      canManageCustomCode: { type: Boolean, default: false },
      canDeployCustomCode: { type: Boolean, default: false },
      canManageIntegrations: { type: Boolean, default: false },
      canViewAnalytics: { type: Boolean, default: false },
      canManageAnalytics: { type: Boolean, default: false },
      canViewAuditLog: { type: Boolean, default: false },
      canManageTenantSettings: { type: Boolean, default: false },
      canManageApiKeys: { type: Boolean, default: false },
      canManageWebhooks: { type: Boolean, default: false },
      canExportData: { type: Boolean, default: false },
      canImportData: { type: Boolean, default: false },
      canViewCallRecordings: { type: Boolean, default: false },
      canManageCommunicationTemplates: { type: Boolean, default: false },
      canManageDocumentTemplates: { type: Boolean, default: false },
    },

    // Users this set is assigned to.
    assignedUserIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    lastModifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

permissionSetSchema.index({ tenantId: 1, name: 1 }, { unique: true });
permissionSetSchema.index({ tenantId: 1, assignedUserIds: 1 });

export default mongoose.model('PermissionSet', permissionSetSchema);
