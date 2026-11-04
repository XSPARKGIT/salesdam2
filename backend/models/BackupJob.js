import mongoose from 'mongoose';

const backupJobSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['full', 'metadata', 'data'],
      default: 'full',
    },
    status: {
      type: String,
      enum: ['pending', 'running', 'completed', 'failed', 'restored'],
      default: 'pending',
    },
    artifactPath: { type: String, default: '' },
    artifactSizeBytes: { type: Number, default: 0 },
    componentCount: { type: Number, default: 0 },
    error: { type: String, default: '' },
    startedAt: { type: Date },
    completedAt: { type: Date },
    restoredAt: { type: Date },
    restoredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

backupJobSchema.index({ tenantId: 1, createdAt: -1 });

export default mongoose.model('BackupJob', backupJobSchema);
