import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  objectApiName: { type: String, required: true, trim: true, index: true },
  recordId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  email: { type: String, enum: ['unknown', 'opted_in', 'opted_out'], default: 'unknown' },
  whatsapp: { type: String, enum: ['unknown', 'opted_in', 'opted_out'], default: 'unknown' },
  telephone: { type: String, enum: ['unknown', 'allowed', 'do_not_call'], default: 'unknown' },
  marketing: { type: String, enum: ['unknown', 'granted', 'denied', 'withdrawn'], default: 'unknown' },
  preferredChannel: { type: String, enum: ['none', 'email', 'whatsapp', 'telephone'], default: 'none' },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

schema.index({ tenantId: 1, objectApiName: 1, recordId: 1 }, { unique: true });

export default mongoose.model('CommunicationPreference', schema);
