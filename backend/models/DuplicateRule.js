import mongoose from 'mongoose';

/**
 * DuplicateRule — configurable record-matching rule for an object
 * (Core BRD §3.4). A rule is one or more field conditions combined with AND
 * or OR, plus the behaviour to take when a match is found.
 */
const matchConditionSchema = new mongoose.Schema(
  {
    field: { type: String, required: true, trim: true },
    // 'exact' compares the trimmed value; 'normalized' also case-insensitive
    // and collapses internal whitespace.
    matchType: {
      type: String,
      enum: ['exact', 'normalized'],
      default: 'normalized',
    },
  },
  { _id: false },
);

const duplicateRuleSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    objectApiName: { type: String, required: true, trim: true, index: true },
    active: { type: Boolean, default: true, index: true },

    logic: { type: String, enum: ['AND', 'OR'], default: 'AND' },
    conditions: {
      type: [matchConditionSchema],
      validate: {
        validator: (v) => Array.isArray(v) && v.length > 0,
        message: 'A duplicate rule needs at least one field condition.',
      },
    },

    // 'block' rejects the write; 'warn' allows it but returns the matches;
    // 'allow' does nothing. 'present_matches' behaves like 'warn' (matches are
    // returned for user selection). 'use_existing' and 'trigger_flow' are
    // accepted for BRD fidelity but currently behave as 'warn' — the merge and
    // flow-trigger actions are not yet implemented.
    onMatch: {
      type: String,
      enum: [
        'allow',
        'warn',
        'block',
        'present_matches',
        'use_existing',
        'trigger_flow',
      ],
      default: 'warn',
    },

    // Only used when onMatch === 'trigger_flow'
    flowId: { type: mongoose.Schema.Types.ObjectId, ref: 'Automation', default: null },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

duplicateRuleSchema.index({ tenantId: 1, objectApiName: 1, active: 1 });

export default mongoose.model('DuplicateRule', duplicateRuleSchema);
