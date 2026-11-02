import mongoose from 'mongoose';

/**
 * ApproverGroup — a public group of eligible approvers (Core BRD §8). An
 * approval step can name a group instead of one person: anyone in it may
 * decide that step. A member is either listed directly or holds one of the
 * group's roles.
 */
const approverGroupSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true, lowercase: true },
    label: { type: String, required: true, trim: true },
    description: { type: String, default: '', trim: true },
    memberIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    roleIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Role' }],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

approverGroupSchema.index({ tenantId: 1, name: 1 }, { unique: true });

export default mongoose.model('ApproverGroup', approverGroupSchema);
