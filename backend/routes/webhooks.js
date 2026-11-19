import express from 'express';
import crypto from 'crypto';
import Webhook from '../models/Webhook.js';
import WebhookDeliveryLog from '../models/WebhookDeliveryLog.js';
import { requireAuth } from '../middleware/auth.js';
import { enforceTenant } from '../middleware/tenant.js';
import { checkAppPermission } from '../middleware/permissions.js';
import { asyncHandler, sendSuccess, AppError } from '../utils/errors.js';
import { WEBHOOK_EVENTS, isKnownEvent, attemptDelivery } from '../services/outboundWebhookService.js';

const FIELDS = ['name', 'description', 'url', 'events', 'isActive', 'objectFilters', 'headers', 'retryCount', 'retryIntervalSeconds', 'retryBackoff', 'failureNotifyThreshold', 'payloadMapping'];
const validate = (b) => {
  if (b.events !== undefined) {
    if (!Array.isArray(b.events)) throw new AppError('events must be a list.', 400);
    const bad = b.events.filter((e) => !isKnownEvent(e));
    if (bad.length) throw new AppError(`Unknown event(s): ${bad.join(', ')}. Use one of ${WEBHOOK_EVENTS.join(', ')} or custom.<name>.`, 400);
  }
  if (b.url !== undefined && !/^https?:\/\/[^\s]+$/i.test(String(b.url))) throw new AppError('url must start with http:// or https://', 400);
  if (b.retryCount !== undefined && !(Number.isInteger(+b.retryCount) && +b.retryCount >= 0 && +b.retryCount <= 10)) throw new AppError('retryCount must be 0 to 10.', 400);
  if (b.retryIntervalSeconds !== undefined && !(+b.retryIntervalSeconds >= 1 && +b.retryIntervalSeconds <= 86400)) throw new AppError('retryIntervalSeconds must be 1 to 86400.', 400);
  if (b.retryBackoff !== undefined && !['fixed', 'exponential'].includes(b.retryBackoff)) throw new AppError('retryBackoff must be fixed or exponential.', 400);
  if (b.payloadMapping !== undefined && b.payloadMapping !== null && (typeof b.payloadMapping !== 'object' || Array.isArray(b.payloadMapping) || Object.values(b.payloadMapping).some((v) => typeof v !== 'string'))) {
    throw new AppError('payloadMapping must be an object of "name sent": "field api name".', 400);
  }
};
const publicRow = (w) => { const o = w.toObject ? w.toObject() : w; delete o.secret; return o; };

const router = express.Router();

router.use(requireAuth, enforceTenant, checkAppPermission('canManageWebhooks'));

router.get('/events', (req, res) => sendSuccess(res, { data: WEBHOOK_EVENTS }));

router.get('/', asyncHandler(async (req, res) => {
  const webhooks = await Webhook.find({ tenantId: req.tenantId }).sort({ createdAt: -1 });
  sendSuccess(res, { data: webhooks.map(publicRow) });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const webhook = await Webhook.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!webhook) throw new AppError('Webhook not found.', 404);
  sendSuccess(res, { data: publicRow(webhook) });
}));

router.post('/', checkAppPermission('canManageWebhooks'), asyncHandler(async (req, res) => {
  const secret = crypto.randomBytes(32).toString('hex');
  // Only the editable fields come from the caller: tenantId, createdBy and the signing secret never do.
  validate(req.body);
  if (!req.body.name || !req.body.url) throw new AppError('name and url are required.', 400);
  const fields = Object.fromEntries(FIELDS
    .filter((k) => req.body[k] !== undefined).map((k) => [k, req.body[k]]));
  const webhook = await Webhook.create({
    ...fields,
    tenantId: req.tenantId,
    createdBy: req.user._id,
    secret,
  });
  // Return webhook with secret only on creation
  sendSuccess(res, { data: { ...webhook.toObject(), secret } }, 'Webhook created. Copy the signing secret now - it will not be shown again.', 201);
}));

router.put('/:id', checkAppPermission('canManageWebhooks'), asyncHandler(async (req, res) => {
  const webhook = await Webhook.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!webhook) throw new AppError('Webhook not found.', 404);
  validate(req.body);
  const allowed = FIELDS;
  allowed.forEach(k => { if (req.body[k] !== undefined) webhook[k] = req.body[k]; });
  await webhook.save();
  sendSuccess(res, { data: publicRow(webhook) }, 'Webhook updated');
}));

router.delete('/:id', checkAppPermission('canManageWebhooks'), asyncHandler(async (req, res) => {
  await Webhook.deleteOne({ _id: req.params.id, tenantId: req.tenantId });
  sendSuccess(res, {}, 'Webhook deleted');
}));

// Rotate the signing secret (BRD 17.6.7): the new secret is shown once; the old one stops signing at once.
router.post('/:id/rotate-secret', checkAppPermission('canManageWebhooks'), asyncHandler(async (req, res) => {
  const webhook = await Webhook.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!webhook) throw new AppError('Webhook not found.', 404);
  const secret = crypto.randomBytes(32).toString('hex');
  webhook.secret = secret;
  await webhook.save();
  sendSuccess(res, { data: { _id: webhook._id, secret } }, 'Signing secret rotated. Copy it now - it will not be shown again.');
}));

// Test webhook: one real signed delivery, recorded in the Integration Log like any other
router.post('/:id/test', checkAppPermission('canManageWebhooks'), asyncHandler(async (req, res) => {
  const webhook = await Webhook.findOne({ _id: req.params.id, tenantId: req.tenantId }).select('+secret');
  if (!webhook) throw new AppError('Webhook not found.', 404);
  const payload = { event: 'test', tenantId: String(req.tenantId), timestamp: new Date().toISOString(), data: {} };
  const log = await WebhookDeliveryLog.create({ tenantId: req.tenantId, webhookId: webhook._id, event: 'test', url: webhook.url, payload, status: 'pending', attempt: 0, maxAttempts: 1 });
  const ok = await attemptDelivery(log, webhook);
  sendSuccess(res, { data: ok ? { status: log.httpStatus, ok: true } : { error: log.error, status: log.httpStatus, ok: false } }, ok ? 'Webhook test successful' : 'Webhook test failed');
}));

// Delivery logs
router.get('/:id/deliveries', checkAppPermission('canManageWebhooks'), asyncHandler(async (req, res) => {
  const logs = await WebhookDeliveryLog.find({ tenantId: req.tenantId, webhookId: req.params.id }).select('-payload').sort({ createdAt: -1 }).limit(50);
  sendSuccess(res, { data: logs });
}));

// Process pending webhook retries (admin only)
router.post('/process-retries', checkAppPermission('canManageWebhooks'), asyncHandler(async (req, res) => {
  const { processWebhookRetries } = await import('../services/webhookRetryService.js');
  const processed = await processWebhookRetries(req.tenantId);
  sendSuccess(res, { data: { processed } }, `Processed ${processed} pending deliveries`);
}));
export default router;
