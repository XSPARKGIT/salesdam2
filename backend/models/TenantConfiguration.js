import mongoose from 'mongoose';

/**
 * TenantConfiguration — key-value store of overridable platform settings.
 *
 * Resolution order (BRD Core §14): a tenant-specific entry wins; when none
 * exists the system-wide default applies. The system default is either a
 * `tenantId: null` document managed by the platform operator, or a code-level
 * fallback in services/configurationService.js.
 */
const tenantConfigurationSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true },
    // null tenantId = platform-wide (cross-tenant) default
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      default: null,
    },
    value: { type: mongoose.Schema.Types.Mixed, required: true },
    dataType: {
      type: String,
      enum: ['string', 'number', 'boolean', 'json'],
      default: 'string',
    },
    category: { type: String, default: 'general', trim: true },
    label: { type: String, default: '', trim: true },
    description: { type: String, default: '', trim: true },
    // Whether tenant admins are allowed to override this key
    editableByTenant: { type: Boolean, default: true },
    // Whether the value is a secret (encrypted at rest, masked in UI)
    isSecret: { type: Boolean, default: false },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

// One entry per key per scope (tenantId null = the single system default).
tenantConfigurationSchema.index({ key: 1, tenantId: 1 }, { unique: true });

export default mongoose.model('TenantConfiguration', tenantConfigurationSchema);
