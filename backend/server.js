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

app.listen(PORT, () => {
  logger.info(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
});
