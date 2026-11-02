import mongoose from 'mongoose';

/**
 * PermissionSet — extra access granted to individual users on top of their
 * Role (Profile). BRD 5.3: for now a Permission Set grants Apps (Workspaces in
 * the App Switcher); object permissions still come from the Role.
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
