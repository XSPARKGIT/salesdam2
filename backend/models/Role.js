import mongoose from 'mongoose';

// Object-level permission definition
const objectPermissionSchema = new mongoose.Schema({
  objectApiName: { type: String, required: true },
  canCreate: { type: Boolean, default: false },
  canRead: { type: Boolean, default: false },
  canUpdate: { type: Boolean, default: false },
  canDelete: { type: Boolean, default: false },
  canExport: { type: Boolean, default: false },
  canImport: { type: Boolean, default: false },
  // Field-level permissions
  fieldPermissions: [{
    fieldApiName: { type: String, required: true },
    canView: { type: Boolean, default: true },
    canEdit: { type: Boolean, default: false },
  }],
}, { _id: false });

const roleSchema = new mongoose.Schema({
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true,
    index: true,
  },
  name: { type: String, required: true, trim: true },
  label: { type: String, required: true, trim: true },
  description: { type: String, trim: true },
  isSystem: { type: Boolean, default: false }, // built-in roles can't be deleted
  isEditable: { type: Boolean, default: true }, // superuser role is not editable
  isDefault: { type: Boolean, default: false }, // assigned to new users by default

  // Object-level permissions
  objectPermissions: [objectPermissionSchema],

  // App-level permissions
  appPermissions: {
    canManageUsers: { type: Boolean, default: false },
    canManageRoles: { type: Boolean, default: false },
    canManageObjects: { type: Boolean, default: false },
    canManageAutomations: { type: Boolean, default: false },
    canManageIntegrations: { type: Boolean, default: false },
    canViewAnalytics: { type: Boolean, default: false },
    canManageAnalytics: { type: Boolean, default: false },
    canViewAuditLog: { type: Boolean, default: false },
    canManageTenantSettings: { type: Boolean, default: false },
    canManageApiKeys: { type: Boolean, default: false },
    canManageWebhooks: { type: Boolean, default: false },
  },

  // Apps (Workspaces) this Role sees in its App Switcher (BRD 5.3). Separate
  // from objectPermissions — see services/appAccessService.js.
  appIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Workspace' }],

  // Data visibility
  dataAccess: {
    type: String,
    enum: ['all', 'own_and_subordinates', 'own', 'custom'],
    default: 'own',
  },

  parentRole: { type: mongoose.Schema.Types.ObjectId, ref: 'Role' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, {
  timestamps: true,
});

roleSchema.index({ tenantId: 1, name: 1 }, { unique: true });
roleSchema.index({ tenantId: 1, isSystem: 1 });

// Get permission for a specific object
roleSchema.methods.getObjectPermission = function (objectApiName) {
  return this.objectPermissions.find(p => p.objectApiName === objectApiName);
};

// Check if role has specific object permission
roleSchema.methods.can = function (action, objectApiName) {
  // Superuser check is done at middleware level, not here
  const perm = this.getObjectPermission(objectApiName);
  if (!perm) return false;
  const actionMap = {
    create: 'canCreate',
    read: 'canRead',
    update: 'canUpdate',
    delete: 'canDelete',
    export: 'canExport',
    import: 'canImport',
  };
  return perm[actionMap[action]] === true;
};

export default mongoose.model('Role', roleSchema);
