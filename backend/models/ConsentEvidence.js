import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  objectApiName: { type: String, required: true, trim: true, index: true },
  recordId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  status: { type: String, enum: ['unknown', 'pending', 'granted', 'denied', 'withdrawn'], required: true },
  purpose: { type: String, required: true, trim: true },
  source: { type: String, required: true, trim: true },
  eventAt: { type: Date, required: true },
  capturedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  withdrawalAt: { type: Date },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

schema.index({ tenantId: 1, objectApiName: 1, recordId: 1, createdAt: -1 });

export default mongoose.model('ConsentEvidence', schema);
