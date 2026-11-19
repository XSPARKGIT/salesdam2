import 'dotenv/config';
import app from './app.js';
import connectDB from './config/db.js';
import logger from './utils/logger.js';
import { ensureDefaultActions } from './services/actionService.js';
import { startFlowScheduler } from './services/scheduledFlowService.js';
import approvalProcessService from './services/approvalProcessService.js';

const PORT = process.env.PORT || 5000;

const isProd = process.env.NODE_ENV === 'production';

process.on('unhandledRejection', (err, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', err);
  if (isProd) process.exit(1);
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', err);
  if (isProd) process.exit(1);
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM received. Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received. Shutting down gracefully...');
  process.exit(0);
});

await connectDB();

// Record-page buttons that used to be hardcoded (Convert to Deal, Generate
// Quote, …) are configuration now; give objects any defaults they lack.
ensureDefaultActions().catch((err) =>
  logger.error(`Seeding default action buttons failed: ${err.message}`),
);

// Lead approval runs as an ordinary approval process (BRD §8); give every
// tenant with leads its built-in "Lead Approval" process.
approvalProcessService.ensureLeadApprovalProcesses().catch((err) =>
  logger.error(`Seeding the Lead Approval process failed: ${err.message}`),
);

// Scheduled / time-based flows (BRD 7.1), e.g. "3 days before Due Date".
startFlowScheduler();

// Webhook retry worker (BRD 17.5) — process pending deliveries every 30s.
setInterval(async () => {
  try {
    const { default: webhookRetryService } = await import('./services/webhookRetryService.js');
    await webhookRetryService.processWebhookRetries();
  } catch (err) {
    logger.error(`Webhook retry worker error: ${err.message}`);
  }
}, 30000);

// Recycle bin purge (BRD 3.1.3.3) — drop records that have been in the bin
// longer than the tenant's retention window. Hourly is frequent enough for a
// window measured in days, and the first sweep runs a minute after boot so a
// restart does not skip a day's purge.
const RECYCLE_BIN_SWEEP_MS = 60 * 60 * 1000;
const sweepRecycleBin = async () => {
  try {
    const { default: recycleBinService } = await import('./services/recycleBinService.js');
    await recycleBinService.purgeExpiredRecords();
  } catch (err) {
    logger.error(`Recycle bin purge error: ${err.message}`);
  }
};
setTimeout(sweepRecycleBin, 60000);

// Call-recording retention (BRD 14.2.10) — same cadence; only tenants with a positive window are touched.
const sweepCallRecordings = async () => {
  try {
    const { default: svc } = await import('./services/callRecordingRetentionService.js');
    await svc.purgeExpiredRecordings();
  } catch (err) {
    logger.error(`Call recording purge error: ${err.message}`);
  }
};
setTimeout(sweepCallRecordings, 90000);
setInterval(sweepCallRecordings, RECYCLE_BIN_SWEEP_MS);
setInterval(sweepRecycleBin, RECYCLE_BIN_SWEEP_MS);

app.listen(PORT, () => {
  logger.info(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
});
