/**
 * Outgoing webhooks (BRD 17.4) and their delivery / retry / failure alerts
 * (BRD 17.5).
 *
 *   emit(tenantId, event, { objectApiName, record, data })
 *
 * finds the tenant's active webhooks subscribed to `event`, builds the payload
 * (optionally mapped to the webhook's own field names), signs it with the
 * webhook's secret (HMAC-SHA256) and delivers it. Failures are retried by
 * webhookRetryService using the webhook's own count / interval / backoff.
 *
 * emit() never throws and never blocks the caller: a down receiver must not
 * break a record save. Delivery rows keep only what is needed to retry; the
 * payload is cleared as soon as a delivery reaches a final state, so the
 * Integration Log never retains record values or credentials.
 */
import crypto from 'crypto';
import axios from 'axios';
import Webhook from '../models/Webhook.js';
import WebhookDeliveryLog from '../models/WebhookDeliveryLog.js';
import Notification from '../models/Notification.js';
import User from '../models/User.js';
import FieldMeta from '../models/FieldMeta.js';
import ObjectMeta from '../models/ObjectMeta.js';
import { getVisibleFields, hasObjectPermission } from '../middleware/permissions.js';
import logger from '../utils/logger.js';

export const WEBHOOK_EVENTS = [
  'record.created', 'record.updated', 'record.deleted',
  'approval.completed', 'flow.completed', 'lead.received',
  'communication.received', 'communication.sent', 'call.completed',
  'user.created', 'user.updated', 'automation.run', 'automation.failed',
];
export const isKnownEvent = (e) => WEBHOOK_EVENTS.includes(e) || /^custom\.[a-z0-9_.-]{1,60}$/i.test(e);

const flatten = (record) => {
  if (!record) return null;
  if (typeof record.toDataObject === 'function') return record.toDataObject();
  const d = record.data instanceof Map ? Object.fromEntries(record.data) : record.data;
  return { id: record._id || record.id, ...(d || record) };
};

const CREDENTIAL_KEY = /pass(word)?|secret|token|authorization|api[-_]?key|credential/i;
/** Mask credential-looking keys anywhere in a value (used for anything stored in a log). */
export const maskSecrets = (v, depth = 0) => {
  if (depth > 6 || v == null) return v;
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => maskSecrets(x, depth + 1));
  if (typeof v === 'object') {
    if (typeof v.toObject === 'function') v = v.toObject();
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, CREDENTIAL_KEY.test(k) ? '[hidden]' : maskSecrets(x, depth + 1)]));
  }
  return v;
};

/**
 * Field security (BRD 17.1.2/17.2): a payload carries only fields the webhook
 * creator's role may view. Hidden fields are dropped from full-record AND mapped
 * payloads; the dropped names go in the delivery row's note. No creator = name only.
 */
const applyFieldSecurity = async (webhook, tenantId, objectApiName, body) => {
  if (!objectApiName) return { body, dropped: [] };
  const fieldNames = new Set((await FieldMeta.find({ tenantId, objectApiName }).select('apiName').lean()).map((f) => f.apiName));
  const dataKeys = Object.keys(body).filter((k) => fieldNames.has(k));
  let allowed;
  if (webhook.createdBy) {
    const user = await User.findById(webhook.createdBy).populate('role');
    allowed = user && user.status === 'active' ? new Set(await getVisibleFields(user, objectApiName, dataKeys)) : null;
  }
  if (!allowed) {
    const obj = await ObjectMeta.findOne({ tenantId, apiName: objectApiName }).select('nameFieldApiName').lean();
    allowed = new Set([obj?.nameFieldApiName || 'name']);
  }
  const dropped = dataKeys.filter((k) => !allowed.has(k));
  const out = { ...body };
  dropped.forEach((k) => delete out[k]);
  return { body: out, dropped, fieldNames };
};

const buildPayload = async (webhook, event, tenantId, { objectApiName, record, data }) => {
  const flat = flatten(record);
  let body = flat ? { ...flat } : {};
  const secured = await applyFieldSecurity(webhook, tenantId, objectApiName, body);
  body = secured.body;
  const notes = [];
  if (secured.dropped.length) notes.push(`Not sent (field security): ${secured.dropped.join(', ')}`);
  if (data) body = { ...body, ...data };
  // 17.4.12: payloadMapping = { "name sent": "field api name" } picks standard and custom fields
  const mapping = webhook.payloadMapping && typeof webhook.payloadMapping === 'object' ? webhook.payloadMapping : null;
  if (mapping && Object.keys(mapping).length) {
    const mapped = {};
    const hidden = new Set(secured.dropped);
    for (const [out, field] of Object.entries(mapping)) {
      if (hidden.has(field)) { notes.push(`Mapping "${out}" names hidden field ${field}: left out`); continue; }
      mapped[out] = body[field] ?? null;
    }
    body = mapped;
  }
  return { notes, payload: maskSecrets({
    event,
    tenantId: String(tenantId),
    timestamp: new Date().toISOString(),
    object: objectApiName || undefined,
    recordId: flat?.id ? String(flat.id) : undefined,
    data: body,
  }) };
};

const retryDelayMs = (webhook, attempt) => {
  const base = Math.max(1, webhook.retryIntervalSeconds || 30) * 1000;
  return webhook.retryBackoff === 'exponential' ? base * 2 ** Math.max(0, attempt - 1) : base;
};

const notifyAdmins = async (webhook, reason) => {
  try {
    const users = await User.find({ tenantId: webhook.tenantId, status: 'active' }).populate('role');
    const ids = new Set(users.filter((u) => u.isAdmin?.()).map((u) => String(u._id)));
    if (webhook.createdBy) ids.add(String(webhook.createdBy));
    for (const userId of ids) {
      await Notification.create({
        tenantId: webhook.tenantId,
        userId,
        type: 'system',
        title: `Webhook "${webhook.name}" keeps failing`,
        body: reason,
        message: reason,
      });
    }
  } catch (err) {
    logger.warn(`Webhook failure notification failed: ${err.message}`);
  }
};

/** Track consecutive failed deliveries; alert admins once the threshold is reached. */
const recordOutcome = async (webhook, { ok, status }) => {
  const inc = ok ? { 'stats.successCount': 1, 'stats.totalFired': 1 } : { 'stats.failureCount': 1, 'stats.totalFired': 1 };
  if (ok) {
    await Webhook.updateOne({ _id: webhook._id }, { $inc: inc, $set: { 'stats.lastFiredAt': new Date(), 'stats.lastStatus': status || 200, 'stats.consecutiveFailures': 0 } });
    return;
  }
  const updated = await Webhook.findOneAndUpdate(
    { _id: webhook._id },
    { $inc: { ...inc, 'stats.consecutiveFailures': 1 }, $set: { 'stats.lastFiredAt': new Date(), 'stats.lastStatus': status || 0 } },
    { new: true },
  );
  const threshold = webhook.failureNotifyThreshold ?? 3;
  if (threshold > 0 && updated?.stats?.consecutiveFailures === threshold) {
    await notifyAdmins(webhook, `${threshold} deliveries in a row failed. Last HTTP status: ${status || 'no response'}. Check the Integration Log.`);
  }
};

/**
 * One delivery attempt for a log row. `webhook` must be loaded with +secret.
 * Updates the row and the webhook's stats; returns true on success.
 */
export const attemptDelivery = async (log, webhook) => {
  const attempt = (log.attempt || 0) + 1;
  const body = JSON.stringify(log.payload);
  const signature = crypto.createHmac('sha256', webhook.secret || '').update(body).digest('hex');
  try {
    const response = await axios.post(webhook.url, log.payload, {
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': `sha256=${signature}`,
        'X-Webhook-Event': log.event,
        'X-Webhook-Delivery': String(log._id),
        ...Object.fromEntries(webhook.headers || []),
      },
      timeout: 10000,
      maxRedirects: 0,
      transformRequest: [() => body],
    });
    log.status = 'success';
    log.httpStatus = response.status;
    log.response = String(typeof response.data === 'string' ? response.data : '').slice(0, 200);
    log.error = undefined;
    log.attempt = attempt;
    log.completedAt = new Date();
    log.nextRetryAt = null;
    log.payloadFields = Object.keys(log.payload?.data || {});
    log.payload = null;
    await log.save();
    await recordOutcome(webhook, { ok: true, status: response.status });
    return true;
  } catch (err) {
    const max = log.maxAttempts || 1;
    const final = attempt >= max;
    log.status = final ? 'failed' : 'retrying';
    log.httpStatus = err.response?.status;
    log.error = String(err.message || 'Delivery failed').slice(0, 300);
    log.attempt = attempt;
    log.nextRetryAt = final ? null : new Date(Date.now() + retryDelayMs(webhook, attempt));
    if (final) {
      log.completedAt = new Date();
      log.payloadFields = Object.keys(log.payload?.data || {});
      log.payload = null;
    }
    await log.save();
    if (final) await recordOutcome(webhook, { ok: false, status: err.response?.status });
    return false;
  }
};

const dispatch = async (tenantId, event, ctx) => {
  const hooks = await Webhook.find({ tenantId, isActive: true, events: event }).select('+secret');
  for (const webhook of hooks) {
    if (ctx.objectApiName && webhook.objectFilters?.length && !webhook.objectFilters.includes(ctx.objectApiName)) continue;
    const { payload, notes } = await buildPayload(webhook, event, tenantId, ctx);
    const log = await WebhookDeliveryLog.create({
      note: notes.join('; ') || undefined,
      tenantId,
      webhookId: webhook._id,
      event,
      url: webhook.url,
      payload,
      status: 'pending',
      attempt: 0,
      // retryCount = number of retries after the first try
      maxAttempts: 1 + Math.max(0, webhook.retryCount ?? 3),
    });
    await attemptDelivery(log, webhook);
  }
};

/** Fire-and-forget. Safe to call from any write path. */
export const emit = (tenantId, event, ctx = {}) => {
  if (!tenantId || !event) return;
  dispatch(tenantId, event, ctx).catch((err) => logger.warn(`Outgoing webhook "${event}" failed to dispatch: ${err.message}`));
};

export default { emit, attemptDelivery, maskSecrets, WEBHOOK_EVENTS, isKnownEvent };
