import mongoose from 'mongoose';

const flowErrorSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true },
    automationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Automation', index: true },
    automationName: { type: String },
    objectApiName: { type: String },
    recordId: { type: String },
    stepId: { type: String },
    stepLabel: { type: String },
    stepType: { type: String },
    errorMessage: { type: String },
    errorStack: { type: String },
  },
  {
    timestamps: true,
    // Auto-expire after 90 days to keep the collection lean
    expireAfterSeconds: 60 * 60 * 24 * 90,
  },
);

flowErrorSchema.index({ tenantId: 1, createdAt: -1 });

export default mongoose.model('FlowError', flowErrorSchema);
