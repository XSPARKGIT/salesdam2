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
      enum: ['user', 'manager', 'field', 'queue', 'group'],
      required: true,
    },
    // 'user': the named approver
    approverUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    // 'field': a user lookup field on the record
    approverFieldApiName: { type: String, trim: true },
    // 'queue': any active user holding this role may decide
    approverRoleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Role' },
    // 'group': any member of this public group of approvers may decide
    approverGroupId: { type: mongoose.Schema.Types.ObjectId, ref: 'ApproverGroup' },
    // 'manager': whose manager decides — the record's owner (default) or the
    // person who submitted it. The manager is the user's assigned manager, or
    // failing that anyone holding the role above theirs in the role hierarchy.
    managerOf: { type: String, enum: ['owner', 'submitter'], default: 'owner' },
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
    // Email the people involved, in addition to the in-app notification:
    // the approver on submit, the submitter on approve / reject.
    notifyByEmail: { type: Boolean, default: true },
    // Platform action run on final approval (alongside the optional flow).
    platformAction: { type: String, enum: ['none', 'convert_lead_to_deal'], default: 'none' },
    // Field that receives the decision comment (e.g. rejection_reason).
    reasonField: { type: String, default: '', trim: true },
    // onSubmit: field that receives the person asked to approve (e.g. assigned_approver).
    approverField: { type: String, default: '', trim: true },
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

    // Entry Criteria (BRD §8): a true/false formula, same builder as validation
    // rules and flow entry conditions — e.g. amount > CONFIG("approvals.threshold_amount").
    // Empty = any record. Older processes keep their list of conditions below
    // until they are saved from the editor.
    entryCondition: { type: String, default: '', trim: true },
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

    // Lead approval's built-in process (seeded per tenant) — see approvalProcessService.
    systemKey: { type: String, default: '' },

    active: { type: Boolean, default: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

approvalProcessSchema.index({ tenantId: 1, objectApiName: 1, active: 1 });

export default mongoose.model('ApprovalProcess', approvalProcessSchema);
