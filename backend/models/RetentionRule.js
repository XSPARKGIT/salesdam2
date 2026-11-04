import mongoose from 'mongoose';

const retentionRuleSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      default: null, // null = system-wide default
    },
    category: {
      type: String,
      required: true,
      trim: true,
      enum: ['business_records', 'communication_history', 'call_recordings', 'audit_logs', 'generated_documents', 'uploaded_files', 'integration_logs'],
    },
    retentionDays: { type: Number, required: true, min: 1 },
    enabled: { type: Boolean, default: true },
    description: { type: String, default: '', trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

retentionRuleSchema.index({ tenantId: 1, category: 1 }, { unique: true });

export default mongoose.model('RetentionRule', retentionRuleSchema);
