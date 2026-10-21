import mongoose from 'mongoose';

const auditLogSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },
    userEmail: { type: String },
    action: {
      type: String,
      required: true,
      // Format-validated rather than an enum: an allowlist that drifts from
      // the callers silently dropped audit events, because audit() swallows
      // the Mongoose validation error. A missing action in the list must
      // never cost us the audit row.
      validate: {
        validator: (v) => typeof v === 'string' && /^[a-z][a-z0-9_]*$/.test(v),
        message: 'Audit action must be a lowercase snake_case string.',
      },
    },
    resource: { type: String }, // "DynamicRecord", "User", "Role", etc.
    resourceId: { type: String }, // ID of the affected resource
    objectApiName: { type: String }, // For record actions
    details: { type: mongoose.Schema.Types.Mixed }, // Additional context
    ipAddress: { type: String },
    userAgent: { type: String },
    sessionId: { type: String },
    status: { type: String, enum: ['success', 'failure'], default: 'success' },
    errorMessage: { type: String },
    duration: { type: Number }, // ms
  },
  {
    timestamps: true,
  },
);

// TTL index: auto-delete logs older than 90 days
auditLogSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 90 * 24 * 60 * 60 },
);
auditLogSchema.index({ tenantId: 1, createdAt: -1 });
auditLogSchema.index({ tenantId: 1, action: 1 });
auditLogSchema.index({ tenantId: 1, userId: 1 });
auditLogSchema.index({ tenantId: 1, resource: 1, resourceId: 1 });

export default mongoose.model('AuditLog', auditLogSchema);
