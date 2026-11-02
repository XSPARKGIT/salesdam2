import mongoose from 'mongoose';

/** Component types a change set (config package) can carry (Core BRD §13). */
export const COMPONENT_TYPES = [
  'object',
  'field',
  'layout',
  'layout_assignment',
  'flow',
  'approver_group',
  'approval_process',
  'duplicate_rule',
  'tenant_config',
];

const componentSchema = new mongoose.Schema(
  {
    componentType: {
      type: String,
      enum: COMPONENT_TYPES,
      required: true,
    },
    // Natural key within the source tenant, e.g. apiName, object.apiName,
    // object:name, or a TenantConfiguration key.
    componentKey: { type: String, required: true, trim: true },
    snapshot: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  { _id: false },
);

const validationSchema = new mongoose.Schema(
  {
    at: { type: Date, default: Date.now },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    targetTenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant' },
    valid: { type: Boolean, default: false },
    missing: { type: [mongoose.Schema.Types.Mixed], default: [] },
  },
  { _id: false },
);

/**
 * ChangeSet — an exported bundle of metadata components (Core BRD §13).
 * Built in one tenant, validated against, and deployed into, another.
 */
const changeSetSchema = new mongoose.Schema(
  {
    // Source tenant the package was assembled from.
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '', trim: true },

    status: {
      type: String,
      enum: ['draft', 'validated', 'deployed', 'failed'],
      default: 'draft',
    },
    components: { type: [componentSchema], default: [] },
    validations: { type: [validationSchema], default: [] },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

changeSetSchema.index({ tenantId: 1, name: 1 }, { unique: true });

export default mongoose.model('ChangeSet', changeSetSchema);
