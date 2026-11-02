import mongoose from 'mongoose';

/**
 * ObjectSharingSetting — org-wide default (OWD) record visibility for an object.
 * One row per tenant + object. When no row exists the legacy role `dataAccess`
 * behaviour is used so existing tenants keep working unchanged.
 */
const objectSharingSettingSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
    objectApiName: { type: String, required: true, trim: true },
    orgWideDefault: {
      type: String,
      enum: ['private', 'public_read_only', 'public_read_write'],
      default: 'private',
    },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

objectSharingSettingSchema.index(
  { tenantId: 1, objectApiName: 1 },
  { unique: true },
);

export default mongoose.model('ObjectSharingSetting', objectSharingSettingSchema);
