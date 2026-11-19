import mongoose from 'mongoose';
import crypto from 'crypto';

const apiKeySchema = new mongoose.Schema({
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true,
    index: true,
  },
  name: { type: String, required: true, trim: true },
  description: { type: String, trim: true },
  keyHash: { type: String, required: true, select: false }, // SHA-256 hash of the key
  keyPrefix: { type: String, required: true },               // First 8 chars for identification
  scopes: [{
    type: String,
    enum: ['read', 'write', 'delete', 'admin'],
  }],
  isActive: { type: Boolean, default: true },
  rateLimitPerMinute: { type: Number, default: 300, min: 1, max: 100000 }, // BRD 17.6.1, per key
  deactivatedAt: { type: Date }, // temporary switch-off (BRD 17.6.6); revoke is permanent
  expiresAt: { type: Date },
  lastUsedAt: { type: Date },
  usageCount: { type: Number, default: 0 },
  ipWhitelist:     [{ type: String }],  // allowed IPs (empty = all IPs)
  allowedObjects:  [{ type: String }],  // allowed object API names (empty = all objects)
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  revokedAt: { type: Date },
  revokedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, {
  timestamps: true,
});

apiKeySchema.index({ tenantId: 1, keyPrefix: 1 });
apiKeySchema.index({ tenantId: 1, isActive: 1 });
apiKeySchema.index({ keyPrefix: 1 });

// Generate a new API key (returns raw key, only shown once)
apiKeySchema.statics.generateKey = function () {
  const raw = `smk_${crypto.randomBytes(32).toString('hex')}`;
  const prefix = raw.substring(0, 12);
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  return { raw, prefix, hash };
};

// Verify a raw API key against the stored hash using timing-safe comparison
apiKeySchema.methods.verifyKey = function (rawKey) {
  const hash = crypto.createHash('sha256').update(rawKey).digest('hex');
  const storedHash = this.keyHash;
  
  // Use timing-safe comparison to prevent length/oracle attacks
  const hashBuffer = Buffer.from(hash, 'hex');
  const storedBuffer = Buffer.from(storedHash, 'hex');
  
  if (hashBuffer.length !== storedBuffer.length) {
    return false;
  }
  
  return crypto.timingSafeEqual(hashBuffer, storedBuffer);
};

export default mongoose.model('ApiKey', apiKeySchema);
