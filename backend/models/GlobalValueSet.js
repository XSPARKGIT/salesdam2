import mongoose from 'mongoose';

/**
 * GlobalValueSet — a tenant-scoped shared picklist catalogue.
 *
 * Multiple picklist / multipicklist fields across any object can link to one
 * GlobalValueSet. When the set's values are updated the controller fans out
 * the new values to every linked FieldMeta so all dependent fields stay in
 * sync automatically.
 */
const globalValueSetSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    values: [
      {
        label: { type: String, required: true },
        value: { type: String, required: true },
        isDefault: { type: Boolean, default: false },
        isActive: { type: Boolean, default: true },
        color: { type: String },
      },
    ],
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    lastModifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

globalValueSetSchema.index({ tenantId: 1, name: 1 }, { unique: true });

export default mongoose.model('GlobalValueSet', globalValueSetSchema);
