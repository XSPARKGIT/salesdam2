import mongoose from 'mongoose';

const schema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    source: { type: String, default: 'external' },
    eventType: { type: String, default: 'generic' },
    payload: { type: mongoose.Schema.Types.Mixed },
    action: { type: String },
    objectApiName: { type: String },
    recordId: { type: mongoose.Schema.Types.ObjectId },
    status: { type: String, enum: ['received', 'processed', 'failed'], default: 'received' },
    error: { type: String },
    processedAt: { type: Date },
  },
  { timestamps: true },
);

export default mongoose.model('IncomingWebhookLog', schema);