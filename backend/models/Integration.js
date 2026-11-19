import mongoose from 'mongoose';
import crypto from 'crypto';

const integrationSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: '',
    },
    externalSystem: {
      type: String,
      enum: ['zapier', 'make', 'custom', 'webhook'],
      default: 'custom',
    },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
    },
    accessToken: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    tokenHash: {
      type: String,
      required: true,
      index: true,
    },
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year default
    },
    lastUsedAt: {
      type: Date,
    },
    lastUsedIp: {
      type: String,
    },
    permissions: [
      {
        type: String,
        enum: ['read', 'write', 'delete', 'admin'],
      },
    ],
    metadata: {
      webhook_url: String,
      documentation_url: String,
      created_by: String,
      notes: String,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  },
);

integrationSchema.index({ tenantId: 1, createdAt: -1 });

integrationSchema.methods.generateToken = function () {
  const token = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  this.tokenHash = hash;
  // Only a hash is stored (the unique accessToken column keeps a non-reversible
  // value); the raw token is returned once to the caller and never again.
  this.accessToken = `sha256:${hash}`;
  return token;
};

integrationSchema.methods.verifyToken = function (token) {
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  return this.tokenHash === hash;
};

integrationSchema.methods.isExpired = function () {
  return this.expiresAt && new Date() > this.expiresAt;
};

integrationSchema.methods.recordUsage = function (ip) {
  this.lastUsedAt = new Date();
  this.lastUsedIp = ip;
};

export default mongoose.model('Integration', integrationSchema);
