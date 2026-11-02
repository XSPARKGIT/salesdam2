import mongoose from 'mongoose';
import DynamicRecord from '../models/DynamicRecord.js';
import ObjectMeta from '../models/ObjectMeta.js';
import FieldMeta from '../models/FieldMeta.js';
import IncomingWebhookLog from '../models/IncomingWebhookLog.js';
import { asyncHandler, sendSuccess, AppError, ValidationError } from '../utils/errors.js';
import { checkRecordRules } from '../services/validationService.js';
import { fireAutomations } from '../services/automationService.js';
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
      throw new AppError('Missing webhook signature.', 401);
    }
    const crypto = (await import('crypto')).default;
    const expected = `sha256=${crypto.createHmac('sha256', webhookSecret).update(JSON.stringify(req.body)).digest('hex')}`;
    if (signature !== expected) {
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

  const { objectApiName, action = 'create', data = {}, recordId, triggerFlow = true, customCode, eventType = 'generic', source = 'external' } = req.body || {};

  const log = await IncomingWebhookLog.create({ tenantId, source, eventType, payload: req.body, action, objectApiName, status: 'received' });

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

    log.status = 'processed';
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
    log.error = err.message;
    await log.save();
    throw err;
  }
});

const listLogs = asyncHandler(async (req, res) => {
  const logs = await IncomingWebhookLog.find({ tenantId: req.tenantId }).sort({ createdAt: -1 }).limit(50);
  sendSuccess(res, { data: logs });
});

export { handleIncoming, listLogs };