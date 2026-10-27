import mongoose from 'mongoose';
import DynamicRecord from '../models/DynamicRecord.js';
import ObjectMeta from '../models/ObjectMeta.js';
import FieldMeta from '../models/FieldMeta.js';
import IncomingWebhookLog from '../models/IncomingWebhookLog.js';
import { asyncHandler, sendSuccess, AppError } from '../utils/errors.js';
import { fireAutomations } from '../services/automationService.js';
import { buildSearchText } from '../services/searchService.js';
import customCodeService from '../services/customCodeService.js';
import logger from '../utils/logger.js';

const handleIncoming = asyncHandler(async (req, res) => {
  const tenantId = req.tenantId;
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
        Object.entries(data).forEach(([k, v]) => record.setField(k, v));
        record._searchText = await buildSearchText(record, fields);
        record.lastModifiedBy = req.user?._id || record.lastModifiedBy;
        await record.save();
        result.recordId = record._id;
        log.recordId = record._id;

        if (triggerFlow) {
          try { await fireAutomations('update', objectApiName, record.toObject(), tenantId); } catch (e) { logger.warn(`Flow trigger failed: ${e.message}`); }
        }
      }
    }

    log.status = 'processed';
    log.processedAt = new Date();
    await log.save();

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