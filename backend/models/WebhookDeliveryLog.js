import mongoose from 'mongoose';

const webhookDeliveryLogSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    webhookId: { type: mongoose.Schema.Types.ObjectId, ref: 'Webhook', required: true, index: true },
    event: { type: String, required: true },
    url: { type: String, required: true },
    payload: { type: mongoose.Schema.Types.Mixed }, // only while a retry is pending; cleared when final
    payloadFields: [{ type: String }],
    status: { type: String, enum: ['pending', 'success', 'failed', 'retrying'], default: 'pending' },
    httpStatus: { type: Number },
    response: { type: String },
    error: { type: String },
    note: { type: String }, // e.g. fields left out by field security
    attempt: { type: Number, default: 1 },
    maxAttempts: { type: Number, default: 3 },
    nextRetryAt: { type: Date },
    completedAt: { type: Date },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

webhookDeliveryLogSchema.index({ tenantId: 1, webhookId: 1, createdAt: -1 });

export default mongoose.model('WebhookDeliveryLog', webhookDeliveryLogSchema);
