import mongoose from 'mongoose';

/**
 * Workspace — a subdivision inside a Tenant (organisation).
 *
 * One Tenant can have many Workspaces (e.g. Sales, Support, Engineering).
 * Users belong to one Tenant but can be members of multiple Workspaces.
 * Records / Objects continue to be scoped by tenantId; Workspaces are a
 * membership and access-control layer on top.
 */
const workspaceSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },

    name: { type: String, required: true, trim: true },
    apiName: { type: String, required: true, trim: true, lowercase: true },
    description: { type: String, trim: true },
    slug: {
      type: String,
      // required: true,
      trim: true,
      lowercase: true,
    },

    // One workspace per tenant can be the default (created with the tenant)
    isDefault: { type: Boolean, default: false },

    status: {
      type: String,
      enum: ['active', 'suspended', 'deleted'],
      default: 'active',
    },

    // Visual
    color: { type: String, default: '#6366f1' },
    icon: { type: String, default: 'Briefcase' }, // Lucide icon name

    // Members — users who have access to this workspace.
    // Stored here for fast "who is in this workspace?" queries.
    // The inverse (User.workspaceIds) is also maintained for
    // "which workspaces does this user belong to?" queries.
    memberIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],

    // Restrict which CRM objects are visible in this workspace (empty = all)
    allowedObjects: [{ type: String, trim: true }],

    // Default object to land on when switching to this workspace (e.g. 'policy')
    defaultObjectApiName: { type: String, trim: true, default: '' },

    settings: {
      timezone: { type: String, default: 'UTC' },
      currency: { type: String, default: 'USD' },
      dateFormat: { type: String, default: 'MM/DD/YYYY' },
    },

    // Object groups — organize objects in collapsible sidebar groups
    objectGroups: [
      {
        name: { type: String, trim: true },
        objectApiNames: [{ type: String, trim: true }],
      },
    ],

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    lastModifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

// Unique slug per tenant
// workspaceSchema.index({ tenantId: 1, slug: 1 }, { unique: true });
workspaceSchema.index({ tenantId: 1, isDefault: 1 });
workspaceSchema.index({ tenantId: 1, status: 1 });
workspaceSchema.index({ memberIds: 1 });

export default mongoose.model('Workspace', workspaceSchema);
