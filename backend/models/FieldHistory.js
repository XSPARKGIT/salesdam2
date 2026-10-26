import mongoose from 'mongoose';

const fieldHistorySchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
    objectApiName: { type: String, required: true, index: true },
    recordId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    fieldApiName: { type: String, required: true },
    oldValue: { type: mongoose.Schema.Types.Mixed, default: null },
    newValue: { type: mongoose.Schema.Types.Mixed, default: null },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    isCreation: { type: Boolean, default: false },
  },
  { timestamps: true },
);

fieldHistorySchema.index({ tenantId: 1, recordId: 1, createdAt: -1 });

export default mongoose.model('FieldHistory', fieldHistorySchema);
