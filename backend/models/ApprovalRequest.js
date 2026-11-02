import mongoose from 'mongoose';

/**
 * ApprovalRequest — a running instance of an ApprovalProcess against one
 * record (Core BRD §8). Holds per-step state, decision history and a snapshot
 * of the values changed on submit so a recall can restore the record.
 */

const stepStateSchema = new mongoose.Schema(
  {
    order: { type: Number, required: true },
    name: { type: String, default: '' },
    approverType: {
      type: String,
      enum: ['user', 'manager', 'field', 'queue', 'group'],
      required: true,
    },
    // Set only on the active step; waiting steps are resolved when reached so
    // "my pending approvals" queries cannot match a future step.
    approverUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    approverRoleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Role' },
    approverGroupId: { type: mongoose.Schema.Types.ObjectId, ref: 'ApproverGroup' },
    status: {
      type: String,
      enum: ['waiting', 'pending', 'approved', 'rejected'],
      default: 'waiting',
    },
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    decidedAt: { type: Date },
    comment: { type: String, default: '' },
  },
  { _id: false },
);

const historySchema = new mongoose.Schema(
  {
    action: {
      type: String,
      enum: [
        'submitted',
        'approved_step',
        'rejected',
        'approved',
        'recalled',
      ],
      required: true,
    },
    step: { type: Number },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    at: { type: Date, default: Date.now },
    comment: { type: String, default: '' },
  },
  { _id: false },
);

const approvalRequestSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
    processId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ApprovalProcess',
      required: true,
    },
    processName: { type: String, default: '' },
    objectApiName: { type: String, required: true, index: true },
    recordId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'DynamicRecord',
      required: true,
      index: true,
    },

    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'recalled'],
      default: 'pending',
      index: true,
    },
    currentStep: { type: Number, default: 0 },
    locked: { type: Boolean, default: false },

    submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    submittedAt: { type: Date, default: Date.now },
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    decidedAt: { type: Date },

    steps: { type: [stepStateSchema], default: [] },
    history: { type: [historySchema], default: [] },

    // Field values as they were before the submit-time updates, for recall.
    snapshot: { type: mongoose.Schema.Types.Mixed, default: {} },
    // Field names captured in the snapshot (Mixed may be empty otherwise).
    snapshotFields: { type: [String], default: [] },
  },
  { timestamps: true },
);

approvalRequestSchema.index({
  tenantId: 1,
  objectApiName: 1,
  recordId: 1,
  status: 1,
});
approvalRequestSchema.index({ tenantId: 1, status: 1, 'steps.approverUserId': 1 });

export default mongoose.model('ApprovalRequest', approvalRequestSchema);
