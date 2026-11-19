import mongoose from 'mongoose';
import { encryptSecret as _enc, decryptSecret, isEncrypted } from '../utils/secretCrypto.js';

// Credentials are AES-256-GCM encrypted at rest; plaintext rows written before this change still read back.
const SALT = 'salesdam-integration-salt';
const encryptSecret = (v, salt) => (isEncrypted(v) ? v : _enc(v, salt));


const webhookSchema = new mongoose.Schema({
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true,
    index: true,
  },
  name: { type: String, required: true, trim: true },
  description: { type: String },
  url: { type: String, required: true },
  secret: { type: String, select: false, set: (v) => (v ? encryptSecret(v, SALT) : v), get: (v) => decryptSecret(v, SALT) }, // HMAC secret for signature verification
  isActive: { type: Boolean, default: true },

  // Which events trigger this webhook
  events: [{
    type: String,
    enum: [
      'record.created', 'record.updated', 'record.deleted',
      'user.created', 'user.updated',
      'automation.run', 'automation.failed',
    ],
  }],

  // Filter: only fire for specific objects
  objectFilters: [{ type: String }], // objectApiNames

  // Retry config
  retryCount: { type: Number, default: 3 },
  retryIntervalSeconds: { type: Number, default: 30 },

  // Stats
  stats: {
    totalFired: { type: Number, default: 0 },
    successCount: { type: Number, default: 0 },
    failureCount: { type: Number, default: 0 },
    lastFiredAt: { type: Date },
    lastStatus: { type: Number }, // HTTP status code
  },

  headers: { type: Map, of: String }, // Custom headers to send
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, {
  timestamps: true,
});

webhookSchema.index({ tenantId: 1, isActive: 1 });
webhookSchema.index({ tenantId: 1, events: 1 });

export default mongoose.model('Webhook', webhookSchema);
