/**
 * Integration Log (BRD 17.5): one tenant-scoped, read-only view of integration
 * traffic - outgoing webhook deliveries, incoming webhooks and API-key calls.
 * Rows carry tenant, integration, direction, time, event, endpoint, result,
 * HTTP status, error and retry state. No payload values and no credentials.
 */
import express from 'express';
import WebhookDeliveryLog from '../models/WebhookDeliveryLog.js';
import Webhook from '../models/Webhook.js';
import IncomingWebhookLog from '../models/IncomingWebhookLog.js';
import ApiKeyUsageLog from '../models/ApiKeyUsageLog.js';
import ApiKey from '../models/ApiKey.js';
import { requireAuth } from '../middleware/auth.js';
import { enforceTenant } from '../middleware/tenant.js';
import { checkAppPermission } from '../middleware/permissions.js';
import { asyncHandler, sendSuccess } from '../utils/errors.js';

const router = express.Router();
router.use(requireAuth, enforceTenant, checkAppPermission('canManageIntegrations'));

router.get('/', asyncHandler(async (req, res) => {
  const tenantId = req.tenantId;
  const tenantName = req.tenant?.name || String(tenantId);
  const limit = Math.min(parseInt(req.query.limit) || 100, 300);
  const { direction, result } = req.query;
  const rows = [];

  if (!direction || direction === 'outbound') {
    const logs = await WebhookDeliveryLog.find({ tenantId }).select('-payload').sort({ createdAt: -1 }).limit(limit).lean();
    const hooks = await Webhook.find({ tenantId }).select('name').lean();
    const names = Object.fromEntries(hooks.map((h) => [String(h._id), h.name]));
    for (const l of logs) {
      rows.push({
        id: String(l._id), tenant: tenantName, integration: names[String(l.webhookId)] || '(deleted webhook)',
        direction: 'outbound', time: l.createdAt, event: l.event, endpoint: l.url,
        result: l.status === 'success' ? 'success' : l.status === 'failed' ? 'failed' : 'retrying',
        httpStatus: l.httpStatus ?? null, error: l.error || null,
        retry: l.status === 'success' ? `delivered on attempt ${l.attempt}` : `attempt ${l.attempt} of ${l.maxAttempts}${l.nextRetryAt ? `, next ${new Date(l.nextRetryAt).toISOString()}` : ''}`,
      });
    }
  }
  if (!direction || direction === 'inbound') {
    const logs = await IncomingWebhookLog.find({ tenantId }).select('-payload').sort({ createdAt: -1 }).limit(limit).lean();
    for (const l of logs) {
      rows.push({
        id: String(l._id), tenant: tenantName, integration: l.apiKeyName || l.source || 'external',
        direction: 'inbound', time: l.createdAt, event: l.eventType || 'generic', endpoint: l.endpoint || '/api/v1/webhooks/incoming',
        result: l.status === 'processed' ? 'success' : l.status === 'failed' ? 'failed' : 'received',
        httpStatus: l.httpStatus ?? null, error: l.error || null, retry: 'not applicable',
      });
    }
    const usage = await ApiKeyUsageLog.find({ tenantId }).sort({ timestamp: -1 }).limit(limit).lean();
    const keys = await ApiKey.find({ tenantId }).select('name').lean();
    const kn = Object.fromEntries(keys.map((k) => [String(k._id), k.name]));
    for (const u of usage) {
      rows.push({
        id: String(u._id), tenant: tenantName, integration: `API key: ${kn[String(u.keyId)] || u.keyPrefix}`,
        direction: 'inbound', time: u.timestamp, event: `${u.method} ${u.objectApiName || ''}`.trim(), endpoint: u.path,
        result: u.statusCode < 400 ? 'success' : 'failed', httpStatus: u.statusCode,
        error: u.statusCode >= 400 ? `HTTP ${u.statusCode}` : null, retry: 'not applicable',
      });
    }
  }
  rows.sort((a, b) => new Date(b.time) - new Date(a.time));
  const out = (result ? rows.filter((r) => r.result === result) : rows).slice(0, limit);
  sendSuccess(res, { data: out });
}));

export default router;
