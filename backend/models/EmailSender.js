import mongoose from 'mongoose';
import { encryptSecret as _enc, decryptSecret, isEncrypted } from '../utils/secretCrypto.js';

// Credentials are AES-256-GCM encrypted at rest; plaintext rows written before this change still read back.
const SALT = 'salesdam-integration-salt';
const encryptSecret = (v, salt) => (isEncrypted(v) ? v : _enc(v, salt));


/**
 * EmailSender — a configured "from" address that automations and users can
 * send mail through.
 *
 * availableTo controls who can pick this sender:
 *   'all'            — every user in the workspace
 *   'specific_users' — only the users listed in allowedUserIds
 */
const emailSenderSchema = new mongoose.Schema({
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true,
    index: true,
  },

  // Display / identity
  name:    { type: String, required: true, trim: true },   // "Support Team"
  email:   { type: String, required: true, trim: true, lowercase: true }, // "support@company.com"
  replyTo: { type: String, trim: true, lowercase: true },

  // SMTP connection
  smtpHost:   { type: String, trim: true },
  smtpPort:   { type: Number, default: 587 },
  smtpSecure: { type: Boolean, default: false }, // true = TLS on port 465
  smtpUser:   { type: String, trim: true, select: false },
  smtpPass:   { type: String, select: false, set: (v) => (v ? encryptSecret(v, SALT) : v), get: (v) => decryptSecret(v, SALT) },

  // Status
  isActive:  { type: Boolean, default: true },
  isDefault: { type: Boolean, default: false }, // workspace-default sender

  // Access control
  availableTo: {
    type: String,
    enum: ['all', 'specific_users'],
    default: 'all',
  },
  allowedUserIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  }],

  // Audit
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  lastModifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

emailSenderSchema.index({ tenantId: 1, isActive: 1 });
emailSenderSchema.index({ tenantId: 1, isDefault: 1 });

export default mongoose.model('EmailSender', emailSenderSchema);
