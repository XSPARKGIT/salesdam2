import AuditLog from '../models/AuditLog.js';
import logger from './logger.js';

/**
 * Redact sensitive values from audit details.
 */
const REDACT_KEYS = /password|secret|token|apiKey|api_key|keyHash|authorization/i;
const redact = (obj) => {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(redact);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (REDACT_KEYS.test(k)) {
      out[k] = '[REDACTED]';
    } else {
      out[k] = redact(v);
    }
  }
  return out;
};
const audit = async (params) => {
  try {
    const {
      tenantId,
      userId,
      userEmail,
      action,
      resource,
      resourceId,
      objectApiName,
      details,
      metadata, // some callers pass `metadata`; the model field is `details`
      req,
      status = 'success',
      errorMessage,
      duration,
    } = params;

    await AuditLog.create({
      tenantId,
      userId,
      userEmail,
      action,
      resource,
      resourceId: resourceId ? resourceId.toString() : undefined,
      objectApiName,
      details: redact(details ?? metadata),
      ipAddress: req?.ip,
      userAgent: req?.headers?.['user-agent'],
      sessionId: req?.session?.id,
      status,
      errorMessage,
      duration,
    });
  } catch (err) {
    // Audit log failure should NOT crash the app
    logger.error('Audit log write failed:', err);
  }
};

/**
 * Middleware factory to auto-log actions on routes.
 * Usage: router.post('/records', auditMiddleware('create', 'DynamicRecord'), ...)
 */
const auditMiddleware = (action, resource) => {
  return (req, res, next) => {
    const start = Date.now();
    const originalJson = res.json.bind(res);

    res.json = (body) => {
      const duration = Date.now() - start;
      const status = res.statusCode < 400 ? 'success' : 'failure';

      audit({
        tenantId: req.tenantId,
        userId: req.user?._id,
        userEmail: req.user?.email,
        action,
        resource,
        resourceId: body?.data?._id || body?.data?.id || req.params?.id,
        objectApiName: req.params?.objectApiName,
        req,
        status,
        errorMessage: status === 'failure' ? body?.message : undefined,
        duration,
      });

      return originalJson(body);
    };

    next();
  };
};

export { audit, auditMiddleware };
