import express from 'express';
import crypto from 'crypto';
import axios from 'axios';
import Webhook from '../models/Webhook.js';
import WebhookDeliveryLog from '../models/WebhookDeliveryLog.js';
import { requireAuth } from '../middleware/auth.js';
import { enforceTenant } from '../middleware/tenant.js';
import { checkAppPermission } from '../middleware/permissions.js';
import { asyncHandler, sendSuccess, AppError } from '../utils/errors.js';

const router = express.Router();

router.use(requireAuth, enforceTenant, checkAppPermission('canManageWebhooks'));

router.get('/', asyncHandler(async (req, res) => {
  const webhooks = await Webhook.find({ tenantId: req.tenantId }).sort({ createdAt: -1 });
  sendSuccess(res, { data: webhooks });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const webhook = await Webhook.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!webhook) throw new AppError('Webhook not found.', 404);
  sendSuccess(res, { data: webhook });
}));

router.post('/', checkAppPermission('canManageWebhooks'), asyncHandler(async (req, res) => {
  const secret = crypto.randomBytes(32).toString('hex');
  const webhook = await Webhook.create({
    tenantId: req.tenantId,
    createdBy: req.user._id,
    secret,
    ...req.body,
  });
  // Return webhook with secret only on creation
  sendSuccess(res, { data: { ...webhook.toObject(), secret } }, 'Webhook created', 201);
}));

router.put('/:id', checkAppPermission('canManageWebhooks'), asyncHandler(async (req, res) => {
  const webhook = await Webhook.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!webhook) throw new AppError('Webhook not found.', 404);
  const allowed = ['name', 'description', 'url', 'events', 'isActive', 'objectFilters', 'headers', 'retryCount'];
  allowed.forEach(k => { if (req.body[k] !== undefined) webhook[k] = req.body[k]; });
  await webhook.save();
  sendSuccess(res, { data: webhook }, 'Webhook updated');
}));

router.delete('/:id', checkAppPermission('canManageWebhooks'), asyncHandler(async (req, res) => {
  await Webhook.deleteOne({ _id: req.params.id, tenantId: req.tenantId });
  sendSuccess(res, {}, 'Webhook deleted');
}));

// Test webhook
router.post('/:id/test', checkAppPermission('canManageWebhooks'), asyncHandler(async (req, res) => {
  const webhook = await Webhook.findOne({ _id: req.params.id, tenantId: req.tenantId }).select('+secret');
  if (!webhook) throw new AppError('Webhook not found.', 404);

  const payload = { event: 'test', tenantId: req.tenantId, timestamp: new Date().toISOString() };
  const signature = crypto.createHmac('sha256', webhook.secret).update(JSON.stringify(payload)).digest('hex');

  try {
    const response = await axios.post(webhook.url, payload, {
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': `sha256=${signature}`,
        ...Object.fromEntries(webhook.headers || []),
      },
      timeout: 10000,
    });

    // Log delivery
    await WebhookDeliveryLog.create({
      tenantId: req.tenantId,
      webhookId: webhook._id,
      event: 'test',
      url: webhook.url,
      payload,
      status: 'success',
      httpStatus: response.status,
      attempt: 1,
      maxAttempts: webhook.retryCount || 3,
      completedAt: new Date(),
    });

    sendSuccess(res, { data: { status: response.status, ok: true } }, 'Webhook test successful');
  } catch (err) {
    // Log failed delivery
    await WebhookDeliveryLog.create({
      tenantId: req.tenantId,
      webhookId: webhook._id,
      event: 'test',
      url: webhook.url,
      payload,
      status: 'failed',
      error: err.message,
      attempt: 1,
      maxAttempts: webhook.retryCount || 3,
    });

    sendSuccess(res, { data: { error: err.message, ok: false } }, 'Webhook test failed');
  }
}));

// Delivery logs
router.get('/:id/deliveries', checkAppPermission('canManageWebhooks'), asyncHandler(async (req, res) => {
  const logs = await WebhookDeliveryLog.find({ tenantId: req.tenantId, webhookId: req.params.id }).sort({ createdAt: -1 }).limit(50);
  sendSuccess(res, { data: logs });
}));

export default router;
