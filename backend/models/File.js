import mongoose from 'mongoose';

const fileSchema = new mongoose.Schema({
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true,
    index: true,
  },

  name:        { type: String, required: true, trim: true },
  description: { type: String, trim: true },

  // MIME type — e.g. application/pdf, image/png
  mimeType: { type: String, required: true, default: 'application/octet-stream' },

  // Storage — base64 data URI or a URL (S3, etc.)
  data:     { type: String },        // base64 encoded content (for small files)
  url:      { type: String },        // external URL if stored remotely

  sizeBytes: { type: Number, default: 0 },

  // Polymorphic "related to" — attach a file to any record
  relatedTo: {
    objectApiName: { type: String },
    recordId:      { type: mongoose.Schema.Types.ObjectId, ref: 'DynamicRecord' },
  },

  // Which PDF template generated this file (if any)
  pdfTemplateId: { type: mongoose.Schema.Types.ObjectId, ref: 'PdfTemplate' },

  // Versioning
  version: { type: Number, default: 1 },
  supersedes: { type: mongoose.Schema.Types.ObjectId, ref: 'File' }, // previous version
  supersededBy: { type: mongoose.Schema.Types.ObjectId, ref: 'File' }, // next version

  // Malware scanning
  scanStatus: { type: String, enum: ['pending', 'clean', 'infected', 'error', 'skipped'], default: 'pending' },
  scanResult: { type: String, default: '' },
  scannedAt: { type: Date },

  // Availability — files are not accessible until scan completes successfully
  // Default true for backward compat (files created before scanning existed)
  isAvailable: { type: Boolean, default: true },

  tags:      [{ type: String }],
  isActive:  { type: Boolean, default: true },
  lastModifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

fileSchema.index({ tenantId: 1, 'relatedTo.objectApiName': 1, 'relatedTo.recordId': 1 });
fileSchema.index({ tenantId: 1, pdfTemplateId: 1 });
fileSchema.index({ tenantId: 1, createdAt: -1 });

export default mongoose.model('File', fileSchema);
