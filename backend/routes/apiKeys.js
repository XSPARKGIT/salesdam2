/**
 * API Key management routes.
 * The raw key is returned ONLY at creation time.
 * After that, only the prefix and metadata are available.
 *
 * Security model:
 *   - Keys are SHA-256 hashed server-side (ApiKey.generateKey)
 *   - Scopes limit what actions the key can perform
 *   - IP whitelist restricts source addresses (empty = any IP allowed)
 *   - Keys expire after expiresAt if set
 *   - Revocation immediately stops authentication (isActive: false)
 */
import express from 'express';
import ApiKey from '../models/ApiKey.js';
import ApiKeyUsageLog from '../models/ApiKeyUsageLog.js';
import { requireAuth } from '../middleware/auth.js';
import { enforceTenant } from '../middleware/tenant.js';
import { checkAppPermission } from '../middleware/permissions.js';
import { asyncHandler, sendSuccess, AppError } from '../utils/errors.js';

const router = express.Router();
router.use(requireAuth, enforceTenant, checkAppPermission('canManageApiKeys'));

// GET /api/api-keys — list keys (no hashes returned)
router.get('/', asyncHandler(async (req, res) => {
  const keys = await ApiKey.find({ tenantId: req.tenantId })
    .select('-keyHash')
    .sort({ createdAt: -1 });
  sendSuccess(res, { data: keys });
}));

// GET /api/api-keys/:id
router.get('/:id', asyncHandler(async (req, res) => {
  const key = await ApiKey.findOne({ _id: req.params.id, tenantId: req.tenantId })
    .select('-keyHash');
  if (!key) throw new AppError('API key not found.', 404);
  sendSuccess(res, { data: key });
}));

// POST /api/api-keys — create a new key
// Returns the raw key in rawKey — shown ONCE, never retrievable again
router.post('/', asyncHandler(async (req, res) => {
  const { name, description, scopes = ['read'], expiresAt, ipWhitelist = [], allowedObjects = [] } = req.body;
  if (!name) throw new AppError('name is required.', 400);

  // Validate scopes
  const VALID_SCOPES = ['read', 'write', 'delete', 'admin'];
  const invalid = scopes.filter(s => !VALID_SCOPES.includes(s));
  if (invalid.length) throw new AppError(`Invalid scopes: ${invalid.join(', ')}. Allowed: ${VALID_SCOPES.join(', ')}.`, 400);

  // Validate IP whitelist entries if provided
  const ipRegex = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$|^[0-9a-fA-F:]+$/;
  const invalidIPs = (ipWhitelist || []).filter(ip => !ipRegex.test(ip.trim()));
  if (invalidIPs.length) throw new AppError(`Invalid IP addresses: ${invalidIPs.join(', ')}.`, 400);

  const { raw, prefix, hash } = ApiKey.generateKey();

  const key = await ApiKey.create({
    tenantId:   req.tenantId,
    name,
    description,
    keyHash:    hash,
    keyPrefix:  prefix,
    scopes,
    expiresAt:      expiresAt || undefined,
    ipWhitelist:    ipWhitelist.map(ip => ip.trim()).filter(Boolean),
    allowedObjects: allowedObjects.filter(Boolean),
    createdBy:  req.user._id,
    isActive:   true,
  });

  sendSuccess(res, {
    data: {
      ...key.toObject(),
      keyHash: undefined,   // never expose the hash
      rawKey: raw,          // ONLY returned here — store it securely, cannot be retrieved later
    },
  }, 'API key created. Copy the key now — it will not be shown again.', 201);
}));

// PATCH /api/api-keys/:id — update name, description, scopes, ipWhitelist, expiresAt
router.patch('/:id', asyncHandler(async (req, res) => {
  const key = await ApiKey.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!key) throw new AppError('API key not found.', 404);

  const allowed = ['name', 'description', 'scopes', 'ipWhitelist', 'expiresAt', 'allowedObjects'];
  allowed.forEach(k => { if (req.body[k] !== undefined) key[k] = req.body[k]; });
  await key.save();

  sendSuccess(res, { data: { ...key.toObject(), keyHash: undefined } }, 'Key updated');
}));

// DELETE /api/api-keys/:id/revoke — revoke (soft-delete, keeps audit trail)
router.delete('/:id/revoke', asyncHandler(async (req, res) => {
  const key = await ApiKey.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!key) throw new AppError('API key not found.', 404);

  key.isActive   = false;
  key.revokedAt  = new Date();
  key.revokedBy  = req.user._id;
  await key.save();

  sendSuccess(res, {}, 'API key revoked. All requests using this key will now be rejected.');
}));

// DELETE /api/api-keys/:id — permanent delete
router.delete('/:id', asyncHandler(async (req, res) => {
  await ApiKey.deleteOne({ _id: req.params.id, tenantId: req.tenantId });
  // Also clean up usage logs
  ApiKeyUsageLog.deleteMany({ keyId: req.params.id }).catch(() => {});
  sendSuccess(res, {}, 'API key deleted.');
}));

// ─── GET /api/api-keys/:id/usage?period=7d ────────────────────────────────────
// Returns aggregated usage stats for a single key.
// period: 7d (default) | 30d | 90d
router.get('/:id/usage', asyncHandler(async (req, res) => {
  const key = await ApiKey.findOne({ _id: req.params.id, tenantId: req.tenantId }).select('-keyHash');
  if (!key) throw new AppError('API key not found.', 404);

  const days    = parseInt({ '7d': 7, '30d': 30, '90d': 90 }[req.query.period] ?? 7);
  const since   = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const keyObjId = key._id;

  const [summary, byDay, byMethod, byObject, byStatus, recent] = await Promise.all([
    // ── Overall summary ──────────────────────────────────────────────────────
    ApiKeyUsageLog.aggregate([
      { $match: { keyId: keyObjId, timestamp: { $gte: since } } },
      { $group: {
          _id: null,
          total:       { $sum: 1 },
          errors:      { $sum: { $cond: [{ $gte: ['$statusCode', 400] }, 1, 0] } },
          avgResponse: { $avg: '$responseTime' },
      }},
    ]),

    // ── Calls per day ────────────────────────────────────────────────────────
    ApiKeyUsageLog.aggregate([
      { $match: { keyId: keyObjId, timestamp: { $gte: since } } },
      { $group: {
          _id:    { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
          count:  { $sum: 1 },
          errors: { $sum: { $cond: [{ $gte: ['$statusCode', 400] }, 1, 0] } },
      }},
      { $sort: { _id: 1 } },
    ]),

    // ── Calls by HTTP method ─────────────────────────────────────────────────
    ApiKeyUsageLog.aggregate([
      { $match: { keyId: keyObjId, timestamp: { $gte: since } } },
      { $group: { _id: '$method', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),

    // ── Top objects accessed ─────────────────────────────────────────────────
    ApiKeyUsageLog.aggregate([
      { $match: { keyId: keyObjId, timestamp: { $gte: since }, objectApiName: { $exists: true, $ne: null } } },
      { $group: { _id: '$objectApiName', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]),

    // ── Calls by status code group (2xx / 4xx / 5xx) ─────────────────────────
    ApiKeyUsageLog.aggregate([
      { $match: { keyId: keyObjId, timestamp: { $gte: since } } },
      { $group: {
          _id:   { $subtract: ['$statusCode', { $mod: ['$statusCode', 100] }] },
          count: { $sum: 1 },
      }},
      { $sort: { _id: 1 } },
    ]),

    // ── 20 most recent requests ──────────────────────────────────────────────
    ApiKeyUsageLog.find({ keyId: keyObjId })
      .sort({ timestamp: -1 })
      .limit(20)
      .select('timestamp method path objectApiName statusCode responseTime ip')
      .lean(),
  ]);

  const s = summary[0] || { total: 0, errors: 0, avgResponse: 0 };

  sendSuccess(res, {
    data: {
      period:     `${days}d`,
      since:      since.toISOString(),
      total:      s.total,
      errors:     s.errors,
      successes:  s.total - s.errors,
      successRate: s.total > 0 ? +((100 * (s.total - s.errors) / s.total).toFixed(1)) : 100,
      avgResponseMs: s.avgResponse ? Math.round(s.avgResponse) : 0,
      // Lifetime stats from the key document
      lifetimeTotal: key.usageCount,
      lastUsedAt:    key.lastUsedAt,
      // Time series
      byDay:     byDay.map(d => ({ date: d._id, count: d.count, errors: d.errors })),
      byMethod:  byMethod.map(d => ({ method: d._id, count: d.count })),
      byObject:  byObject.map(d => ({ object: d._id, count: d.count })),
      byStatus:  byStatus.map(d => ({ group: `${d._id}xx`, count: d.count })),
      recent,
    },
  });
}));

// POST /api/api-keys/:id/rotate — create replacement key and revoke old one
router.post('/:id/rotate', asyncHandler(async (req, res) => {
  const oldKey = await ApiKey.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!oldKey) throw new AppError('API key not found.', 404);
  if (!oldKey.isActive) throw new AppError('Cannot rotate a revoked key.', 400);

  const { raw, prefix, hash } = ApiKey.generateKey();
  const newKey = await ApiKey.create({
    tenantId: oldKey.tenantId,
    name: `${oldKey.name} (rotated)`,
    description: oldKey.description,
    keyHash: hash,
    keyPrefix: prefix,
    scopes: oldKey.scopes,
    expiresAt: oldKey.expiresAt,
    ipWhitelist: oldKey.ipWhitelist,
    allowedObjects: oldKey.allowedObjects,
    createdBy: req.user._id,
    isActive: true,
  });

  // Revoke old key
  oldKey.isActive = false;
  oldKey.revokedAt = new Date();
  oldKey.revokedBy = req.user._id;
  await oldKey.save();

  sendSuccess(res, {
    data: {
      ...newKey.toObject(),
      keyHash: undefined,
      rawKey: raw,
      rotatedFrom: oldKey._id,
    },
  }, 'API key rotated. Copy the new key now — it will not be shown again.', 201);
}));
export default router;
