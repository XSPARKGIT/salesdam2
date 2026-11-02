import mongoose from 'mongoose';

const authFailureLogSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true },
    integration: { type: String, default: 'api' }, // 'api-key', 'webhook', 'session'
    identifier: { type: String, trim: true }, // key prefix or username (masked)
    reason: { type: String, required: true, trim: true },
    ip: { type: String, trim: true },
    path: { type: String, trim: true },
    method: { type: String, trim: true },
    timestamp: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true },
);

authFailureLogSchema.index({ tenantId: 1, timestamp: -1 });

export default mongoose.model('AuthFailureLog', authFailureLogSchema);
