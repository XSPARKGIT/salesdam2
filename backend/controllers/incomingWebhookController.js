import mongoose from 'mongoose';
import DynamicRecord from '../models/DynamicRecord.js';
import ObjectMeta from '../models/ObjectMeta.js';
import FieldMeta from '../models/FieldMeta.js';
import IncomingWebhookLog from '../models/IncomingWebhookLog.js';
import { asyncHandler, sendSuccess, AppError, ValidationError } from '../utils/errors.js';
import { checkRecordRules } from '../services/validationService.js';
import { fireAutomations, runAutomation } from '../services/automationService.js';
import Automation from '../models/Automation.js';
import AuthFailureLog from '../models/AuthFailureLog.js';
import crypto from 'crypto';
import { hasObjectPermission } from '../middleware/permissions.js';
import { maskSecrets } from '../services/outboundWebhookService.js';
import { buildSearchText } from '../services/searchService.js';
import customCodeService from '../services/customCodeService.js';
import logger from '../utils/logger.js';

// BRD 6.2: data arriving by webhook is held to the object's validation rules
// like any other create or update; every failing message is returned.
const assertRulesPass = async (tenantId, objectApiName, data, prev) => {
  const failures = await checkRecordRules({ tenantId, objectApiName, data, prev });
  if (failures.length) {
    throw new ValidationError(failures, 400, {
      message: failures.length === 1 ? failures[0] : `${failures.length} problems need fixing: ${failures.join('; ')}`,
    });
  }
};

const handleIncoming = asyncHandler(async (req, res) => {
  const tenantId = req.tenantId;

  // HMAC signature validation (if a webhook secret is configured for this tenant)
  const webhookSecret = await (async () => {
    try {
      const { default: configurationService } = await import('../services/configurationService.js');
      return await configurationService.resolve('integration.webhook.secret', tenantId);
    } catch { return ''; }
  })();

  if (webhookSecret) {
    const signature = req.headers['x-webhook-signature'] || req.headers['x-hub-signature-256'];
    if (!signature) {
      await AuthFailureLog.create({ tenantId, integration: 'webhook', reason: 'Missing webhook signature', ip: req.ip, path: req.originalUrl.split('?')[0], method: req.method }).catch(() => {});
      throw new AppError('Missing webhook signature.', 401);
    }
    const expected = `sha256=${crypto.createHmac('sha256', webhookSecret).update(JSON.stringify(req.body)).digest('hex')}`;
    const a = Buffer.from(String(signature));
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      await AuthFailureLog.create({ tenantId, integration: 'webhook', reason: 'Invalid webhook signature', ip: req.ip, path: req.originalUrl.split('?')[0], method: req.method }).catch(() => {});
      throw new AppError('Invalid webhook signature.', 401);
    }
  }

  // Idempotency / duplicate event protection
  const idempotencyKey = req.headers['x-idempotency-key'] || req.body?.idempotencyKey;
  if (idempotencyKey) {
    const IdempotencyKey = (await import('../models/IdempotencyKey.js')).default;
    const existing = await IdempotencyKey.findOne({ tenantId, key: idempotencyKey });
    if (existing) {
      return sendSuccess(res, { data: existing.result || { duplicate: true } }, 'Duplicate event — already processed');
    }
  }

  const { objectApiName, action = 'create', data = {}, recordId, triggerFlow = true, flowId, customCode, eventType = 'generic', source = 'external' } = req.body || {};

  const log = await IncomingWebhookLog.create({ tenantId, source, eventType, endpoint: req.originalUrl.split('?')[0], apiKeyName: req.apiKey?.name || (req.integrationToken ? `Token: ${req.integrationToken.name}` : undefined), payload: maskSecrets(req.body), action, objectApiName, status: 'received' });

  try {
    let result = {};

    // Execute custom code if requested
    if (customCode) {
      try {
        const r = await customCodeService.executeCustomCode(tenantId, customCode, data, {});
        result.customCodeOutput = r.output;
      } catch (e) {
        logger.warn(`Custom code in webhook failed: ${e.message}`);
        result.customCodeError = e.message;
      }
    }

    if (objectApiName) {
      const [obj, fields] = await Promise.all([
        ObjectMeta.findOne({ tenantId, apiName: objectApiName }),
        FieldMeta.find({ tenantId, objectApiName }),
      ]);
      if (!obj) throw new AppError(`Object "${objectApiName}" not found.`, 404);
      // The credential's owner and the key's object list limit what a sender may touch.
      if (req.apiKey?.allowedObjects?.length && !req.apiKey.allowedObjects.includes(objectApiName)) {
        throw new AppError(`This API key is not authorised to access '${objectApiName}'.`, 403);
      }
      if (!(await hasObjectPermission(req.user, action === 'update' ? 'update' : 'create', objectApiName))) {
        throw new AppError(`You do not have permission to ${action} ${objectApiName} records.`, 403);
      }

      if (action === 'create') {
        await assertRulesPass(tenantId, objectApiName, data, null);
        const record = new DynamicRecord({ tenantId, objectId: obj._id, objectApiName, ownerId: req.user?._id || null, createdBy: req.user?._id || null, lastModifiedBy: req.user?._id || null });
        Object.entries(data).forEach(([k, v]) => record.setField(k, v));
        record._searchText = await buildSearchText(record, fields);
        await record.save();
        result.recordId = record._id;
        log.recordId = record._id;

        if (triggerFlow) {
          try { await fireAutomations('create', objectApiName, record.toObject(), tenantId); } catch (e) { logger.warn(`Flow trigger failed: ${e.message}`); }
        }
      } else if (action === 'update' && recordId) {
        const record = await DynamicRecord.findOne({ _id: recordId, tenantId, objectApiName, isDeleted: false });
        if (!record) throw new AppError('Record not found.', 404);
        const prev = record.toDataObject();
        await assertRulesPass(tenantId, objectApiName, { ...prev, ...data }, prev);
        Object.entries(data).forEach(([k, v]) => record.setField(k, v));
        record._searchText = await buildSearchText(record, fields);
        record.lastModifiedBy = req.user?._id || record.lastModifiedBy;
        await record.save();
        result.recordId = record._id;
        log.recordId = record._id;

        if (triggerFlow) {
          try { await fireAutomations('update', objectApiName, record.toObject(), tenantId, prev); } catch (e) { logger.warn(`Flow trigger failed: ${e.message}`); }
        }
      }
    }

    // 17.3.4: start a named flow, against the record just created/updated or the given recordId
    if (flowId) {
      const flow = await Automation.findOne({ _id: flowId, tenantId, isActive: true });
      if (!flow) throw new AppError('Flow not found or not active.', 404);
      if (!flow.allowApiTrigger) throw new AppError(`Flow "${flow.name}" is not enabled for API triggering.`, 403);
      const target = result.recordId
        ? await DynamicRecord.findOne({ _id: result.recordId, tenantId, isDeleted: false })
        : recordId ? await DynamicRecord.findOne({ _id: recordId, tenantId, isDeleted: false }) : null;
      const outcome = await runAutomation(flow._id, target, tenantId, data || {});
      result.flow = { id: String(flow._id), name: flow.name, result: outcome };
    }

    log.status = 'processed';
    log.httpStatus = 200;
    log.processedAt = new Date();
    await log.save();

    // Store idempotency key
    if (idempotencyKey) {
      try {
        const IdempotencyKey = (await import('../models/IdempotencyKey.js')).default;
        await IdempotencyKey.create({ tenantId, key: idempotencyKey, source: 'webhook', result: result || {}, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) });
      } catch (e) {
        // Duplicate key — already handled above
      }
    }

    sendSuccess(res, { data: result }, 'Webhook processed');
  } catch (err) {
    log.status = 'failed';
    log.httpStatus = err.statusCode || err.status || 500;
    log.error = err.message;
    await log.save();
    throw err;
  }
});

const listLogs = asyncHandler(async (req, res) => {
  const logs = await IncomingWebhookLog.find({ tenantId: req.tenantId }).select('-payload').sort({ createdAt: -1 }).limit(50);
  sendSuccess(res, { data: logs });
});

export { handleIncoming, listLogs };