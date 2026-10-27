import mongoose from 'mongoose';

/**
 * CustomCode — tenant-specific code snippets that can be invoked from Flows.
 * Supports versioning, status (draft/active/archived), execution logging.
 */
const versionSchema = new mongoose.Schema(
  {
    version: { type: Number, required: true },
    code: { type: String, required: true },
    inputs: { type: mongoose.Schema.Types.Mixed, default: {} },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdAt: { type: Date, default: Date.now },
    status: { type: String, enum: ['draft', 'active', 'archived'], default: 'draft' },
    changeNote: { type: String, default: '' },
  },
  { _id: false },
);

const customCodeSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    // Currently active version number
    activeVersion: { type: Number, default: null },
    versions: { type: [versionSchema], default: [] },
    // Execution log (last N)
    executions: {
      type: [
        {
          version: Number,
          startedAt: Date,
          finishedAt: Date,
          durationMs: Number,
          success: Boolean,
          error: String,
          inputs: mongoose.Schema.Types.Mixed,
          output: mongoose.Schema.Types.Mixed,
        },
      ],
      default: [],
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    lastModifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

customCodeSchema.index({ tenantId: 1, name: 1 }, { unique: true });

export default mongoose.model('CustomCode', customCodeSchema);