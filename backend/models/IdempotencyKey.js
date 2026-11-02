import mongoose from 'mongoose';

const idempotencyKeySchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    key: { type: String, required: true, trim: true },
    source: { type: String, default: 'webhook' },
    result: { type: mongoose.Schema.Types.Mixed },
    expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
  },
  { timestamps: true },
);

idempotencyKeySchema.index({ tenantId: 1, key: 1 }, { unique: true });

export default mongoose.model('IdempotencyKey', idempotencyKeySchema);
