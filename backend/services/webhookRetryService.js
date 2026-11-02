import Webhook from '../models/Webhook.js';
import WebhookDeliveryLog from '../models/WebhookDeliveryLog.js';
import axios from 'axios';
import crypto from 'crypto';
import logger from '../utils/logger.js';

/**
 * Process pending/failed webhook deliveries that are due for retry.
 * Returns the number of deliveries processed.
 */
export const processWebhookRetries = async () => {
  const now = new Date();
  const due = await WebhookDeliveryLog.find({
    status: { $in: ['failed', 'retrying'] },
    attempt: { $lt: '$maxAttempts' },
    $or: [{ nextRetryAt: { $lte: now } }, { nextRetryAt: null }],
  }).limit(50);

  let processed = 0;
  for (const log of due) {
    try {
      const webhook = await Webhook.findOne({ _id: log.webhookId, tenantId: log.tenantId });
      if (!webhook || !webhook.isActive) {
        log.status = 'failed';
        log.error = 'Webhook inactive or deleted';
        await log.save();
        continue;
      }

      const signature = crypto.createHmac('sha256', webhook.secret || '').update(JSON.stringify(log.payload)).digest('hex');
      const attempt = log.attempt + 1;

      try {
        const response = await axios.post(webhook.url, log.payload, {
          headers: {
            'Content-Type': 'application/json',
            'X-Webhook-Signature': `sha256=${signature}`,
            ...Object.fromEntries(webhook.headers || []),
          },
          timeout: 10000,
        });

        log.status = 'success';
        log.httpStatus = response.status;
        log.response = String(response.data || '').slice(0, 500);
        log.attempt = attempt;
        log.completedAt = new Date();
        log.nextRetryAt = null;
        await log.save();

        // Update webhook stats
        await Webhook.updateOne({ _id: webhook._id }, { $inc: { 'stats.successCount': 1, 'stats.totalFired': 1 }, 'stats.lastFiredAt': new Date(), 'stats.lastStatus': response.status });
      } catch (err) {
        log.status = attempt >= log.maxAttempts ? 'failed' : 'retrying';
        log.httpStatus = err.response?.status;
        log.error = err.message;
        log.attempt = attempt;
        if (attempt < log.maxAttempts) {
          const interval = (webhook.retryIntervalSeconds || 30) * 1000;
          log.nextRetryAt = new Date(Date.now() + interval);
        } else {
          log.nextRetryAt = null;
        }
        await log.save();

        await Webhook.updateOne({ _id: webhook._id }, { $inc: { 'stats.failureCount': 1, 'stats.totalFired': 1 }, 'stats.lastFiredAt': new Date(), 'stats.lastStatus': err.response?.status || 0 });
      }
      processed++;
    } catch (err) {
      logger.error(`Retry worker error for log ${log._id}: ${err.message}`);
    }
  }
  return processed;
};

export default { processWebhookRetries };
EOF
echo "created"