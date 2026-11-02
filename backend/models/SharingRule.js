import mongoose from 'mongoose';

/**
 * SharingRule — grants access to records matching `criteria` to a Team (Role),
 * Public Group (ApproverGroup) or an individual user. Access can be read-only
 * or read-write. Multiple rules per object are supported; each is evaluated
 * independently and their filters are unioned.
 */
const conditionSchema = new mongoose.Schema(
  {
    field: { type: String, required: true, trim: true },
    operator: {
      type: String,
      enum: ['eq', 'ne', 'in', 'contains', 'startsWith', 'gt', 'lt', 'gte', 'lte'],
      default: 'eq',
    },
    value: { type: mongoose.Schema.Types.Mixed },
  },
  { _id: false },
);

const sharingRuleSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
    objectApiName: { type: String, required: true, trim: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '', trim: true },
    // 'all' (no criteria) or 'criteria'
    ruleType: {
      type: String,
      enum: ['all', 'criteria'],
      default: 'criteria',
    },
    criteria: { type: [conditionSchema], default: [] },
    sharedWith: {
      type: {
        type: String,
        enum: ['role', 'group', 'user'],
        required: true,
      },
      id: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
      },
    },
    accessLevel: {
      type: String,
      enum: ['read', 'readWrite'],
      default: 'read',
    },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

sharingRuleSchema.index({ tenantId: 1, objectApiName: 1, isActive: 1 });

export default mongoose.model('SharingRule', sharingRuleSchema);
