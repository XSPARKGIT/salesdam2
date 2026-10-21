import mongoose from 'mongoose';

/**
 * ApprovalProcess — a configurable approval definition for any object
 * (Core BRD §8). Generalises the hardcoded Lead-to-Deal manager approval into
 * an ordered, multi-step process with configurable entry criteria, approver
 * determination per step, and field-update actions on submit/approve/reject.
 */

const conditionSchema = new mongoose.Schema(
  {
    field: { type: String, required: true, trim: true },
    operator: {
      type: String,
      enum: [
        'equals',
        'not_equals',
        'greater_than',
        'less_than',
        'greater_or_equal',
        'less_or_equal',
        'contains',
        'is_empty',
        'is_not_empty',
      ],
      default: 'equals',
    },
    value: { type: mongoose.Schema.Types.Mixed },
    // 'tenantConfig' resolves `value` as a TenantConfiguration key at runtime,
    // e.g. field "amount" > tenantConfig "approvals.threshold_amount".
    valueType: {
      type: String,
      enum: ['literal', 'tenantConfig'],
      default: 'literal',
    },
  },
  { _id: false },
);

const stepSchema = new mongoose.Schema(
  {
    order: { type: Number, required: true },
    name: { type: String, default: '', trim: true },
    approverType: {
      type: String,
      enum: ['user', 'manager', 'field', 'queue'],
      required: true,
    },
    // 'user': the named approver
    approverUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    // 'field': a user lookup field on the record
    approverFieldApiName: { type: String, trim: true },
    // 'queue': any active user holding this role may decide
    approverRoleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Role' },
  },
  { _id: false },
);

const fieldUpdateSchema = new mongoose.Schema(
  {
    field: { type: String, required: true, trim: true },
    value: { type: mongoose.Schema.Types.Mixed },
  },
  { _id: false },
);

const actionSchema = new mongoose.Schema(
  {
    fieldUpdates: { type: [fieldUpdateSchema], default: [] },
    lockRecord: { type: Boolean, default: false },
    unlockRecord: { type: Boolean, default: true },
    captureReason: { type: Boolean, default: true },
    // Optional flow launched after this stage (approvalOutcome,
    // approvalComment, approvalProcessName and approvalRequestId are passed
    // as flow variables).
    flowId: { type: mongoose.Schema.Types.ObjectId, ref: 'Automation', default: null },
  },
  { _id: false },
);

const approvalProcessSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '', trim: true },
    objectApiName: { type: String, required: true, trim: true, index: true },

    entryCriteria: {
      logic: { type: String, enum: ['AND', 'OR'], default: 'AND' },
      conditions: { type: [conditionSchema], default: [] },
    },

    steps: {
      type: [stepSchema],
      validate: {
        validator: (v) => Array.isArray(v) && v.length > 0,
        message: 'An approval process needs at least one step.',
      },
    },

    actions: {
      onSubmit: { type: actionSchema, default: () => ({}) },
      onApprove: { type: actionSchema, default: () => ({}) },
      onReject: { type: actionSchema, default: () => ({}) },
    },

    active: { type: Boolean, default: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

approvalProcessSchema.index({ tenantId: 1, objectApiName: 1, active: 1 });

export default mongoose.model('ApprovalProcess', approvalProcessSchema);
