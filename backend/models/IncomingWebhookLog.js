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
    // Provider-assigned event id (e.g. Meta's leadgen_id) for idempotency —
    // a redelivered event must not be processed twice (§16.1).
    externalEventId: { type: String },
  },
  { timestamps: true },
);

// Sparse + unique: only events that set externalEventId are deduplicated,
// scoped per tenant+source so two providers' ids never collide.
schema.index(
  { tenantId: 1, source: 1, externalEventId: 1 },
  { unique: true, partialFilterExpression: { externalEventId: { $type: 'string' } } },
);

export default mongoose.model('IncomingWebhookLog', schema);