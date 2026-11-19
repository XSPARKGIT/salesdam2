import Webhook from '../models/Webhook.js';
import WebhookDeliveryLog from '../models/WebhookDeliveryLog.js';
import { attemptDelivery } from './outboundWebhookService.js';
import logger from '../utils/logger.js';

/**
 * Process pending/failed webhook deliveries that are due for retry (BRD 17.5.12).
 * Count, interval and backoff come from each webhook. `tenantId` limits the
 * sweep (the admin button); the background worker passes none.
 * Returns the number of deliveries processed.
 */
export const processWebhookRetries = async (tenantId = null) => {
  const now = new Date();
  const due = await WebhookDeliveryLog.find({
    ...(tenantId ? { tenantId } : {}),
    // Field-to-field comparison needs $expr.
    $expr: { $lt: ['$attempt', '$maxAttempts'] },
    payload: { $ne: null },
    $or: [
      { status: 'retrying', nextRetryAt: { $lte: now } },
      { status: 'pending', createdAt: { $lte: new Date(now.getTime() - 120000) } }, // orphaned by a restart
    ],
  }).limit(50);

  let processed = 0;
  for (const log of due) {
    try {
      const webhook = await Webhook.findOne({ _id: log.webhookId, tenantId: log.tenantId }).select('+secret');
      if (!webhook || !webhook.isActive) {
        log.status = 'failed';
        log.error = 'Webhook inactive or deleted';
        log.nextRetryAt = null;
        log.payloadFields = Object.keys(log.payload?.data || {});
        log.payload = null;
        await log.save();
        continue;
      }
      await attemptDelivery(log, webhook);
      processed++;
    } catch (err) {
      logger.error(`Retry worker error for log ${log._id}: ${err.message}`);
    }
  }
  return processed;
};

export default { processWebhookRetries };
