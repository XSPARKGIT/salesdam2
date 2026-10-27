import { createRequire } from 'module';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import mongoSanitize from 'express-mongo-sanitize';
import compression from 'compression';
import rateLimit from 'express-rate-limit';

import sessionMiddleware from './middleware/sessionMiddleware.js';
import errorHandler from './middleware/errorHandler.js';
import logger from './utils/logger.js';

// Route imports
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import roleRoutes from './routes/roles.js';
import objectRoutes from './routes/objects.js';
import fieldRoutes from './routes/fields.js';
import recordRoutes from './routes/records.js';
import listViewRoutes from './routes/listViews.js';
import actionButtonRoutes from './routes/actionButtons.js';
import layoutRoutes from './routes/layouts.js';
import automationRoutes from './routes/automations.js';
import analyticsRoutes from './routes/analytics.js';
import searchRoutes from './routes/search.js';
import webhookRoutes from './routes/webhooks.js';
import adminRoutes from './routes/admin.js';
import aiRoutes from './routes/ai.js';
import notificationRoutes from './routes/notifications.js';
import dashboardRoutes from './routes/dashboards.js';
import dashboardFolderRoutes from './routes/dashboardFolders.js';
import externalObjectRoutes from './routes/externalObjects.js';
import customScreenRoutes from './routes/customScreens.js';
import emailTemplateRoutes from './routes/emailTemplates.js';
import apiKeyRoutes from './routes/apiKeys.js';
import objectConfigRoutes from './routes/objectConfig.js';
import emailSenderRoutes from './routes/emailSenders.js';
import workspaceRoutes from './routes/workspaces.js';
import pdfTemplateRoutes from './routes/pdfTemplates.js';
import fileRoutes from './routes/files.js';
import superAdminRoutes from './routes/superAdmin.js';
import registrationRoutes from './routes/registration.js';
import billingRoutes from './routes/billing.js';
import subscriptionRoutes from './routes/subscription.js';
import paystackWebhookRoutes from './routes/paystackWebhook.js';
import incidentRoutes from './routes/incidents.js';
import integrationRoutes from './routes/integrations.js';
import recurringTaskRoutes from './routes/recurringTasks.js';
import tendersRoutes from './routes/tenders.js';
import leadApprovalRoutes from './routes/leadApproval.js';
import documentRoutes from './routes/documents.js';
import insuranceRoutes from './routes/insurance.js';
import configurationRoutes from './routes/configuration.js';
import approvalProcessRoutes from './routes/approvalProcess.js';
import duplicateRuleRoutes from './routes/duplicateRules.js';
import consentRoutes from './routes/consents.js';
import activityRoutes from './routes/activities.js';
import changeSetRoutes from './routes/changeSets.js';
import customCodeRoutes from './routes/customCode.js';
import facebookLeadRoutes from './routes/facebookLead.js';
import incomingWebhookRoutes from './routes/incomingWebhooks.js';
import globalValueSetRoutes from './routes/globalValueSets.js';
import channelRoutes from './routes/channels.js';
import conversationRoutes from './routes/conversations.js';
import messageTemplateRoutes from './routes/messageTemplates.js';
import telephonyRoutes from './routes/telephony.js';

const require = createRequire(import.meta.url);
const { version } = require('./package.json');

const app = express();

// Trust proxy (for rate limiting behind reverse proxy)
app.set('trust proxy', 1);

// Security headers
app.use(
  helmet({
    contentSecurityPolicy: false, // configure per environment
    crossOriginEmbedderPolicy: false,
  }),
);

// CORS - Get allowed origins from environment variable or use defaults
const getAllowedOrigins = () => {
  // Try CORS_ORIGINS first (comma-separated list)
  if (process.env.CORS_ORIGINS) {
    return process.env.CORS_ORIGINS.split(',').map((origin) => origin.trim());
  }
  // Fallback to APP_URL for backward compatibility
  if (process.env.APP_URL) {
    return process.env.APP_URL.split(',').map((origin) => origin.trim());
  }
  // Development defaults
  return ['http://localhost:3000', 'http://localhost:3001'];
};

app.use(
  cors({
    origin: getAllowedOrigins(),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Tenant-ID',
      'X-API-Key',
    ],
  }),
);

// Compression
app.use(compression());

// Body parsing
// Keep the raw payload so webhook HMAC signatures can be verified over the
// exact bytes Paystack signed (re-serializing JSON can change them).
app.use(
  express.json({
    limit: '10mb',
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Sanitize MongoDB queries (prevent injection)
app.use(mongoSanitize());

// HTTP request logger
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(
    morgan('combined', {
      stream: { write: (msg) => logger.info(msg.trim()) },
    }),
  );
}

// Session middleware (fully manual — no express-session)
app.use(sessionMiddleware);

// Global rate limiter
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10000,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests, please try again later.',
  },
});
app.use('/api', globalLimiter);

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    version,
  });
});

// Paystack webhook (must be before rate limiter - needs to be public and unrestricted)
app.use('/api/paystack-webhook', paystackWebhookRoutes);

// API v1 Routes (versioned routes)
const API_V1_PREFIX = '/api/v1';

app.use(`${API_V1_PREFIX}/auth`, authRoutes);
app.use(`${API_V1_PREFIX}/users`, userRoutes);
app.use(`${API_V1_PREFIX}/roles`, roleRoutes);
app.use(`${API_V1_PREFIX}/objects`, objectRoutes);
app.use(`${API_V1_PREFIX}/fields`, fieldRoutes);
app.use(`${API_V1_PREFIX}/records`, recordRoutes);
app.use(`${API_V1_PREFIX}/list-views`, listViewRoutes);
app.use(`${API_V1_PREFIX}/action-buttons`, actionButtonRoutes);
app.use(`${API_V1_PREFIX}/layouts`, layoutRoutes);
app.use(`${API_V1_PREFIX}/automations`, automationRoutes);
app.use(`${API_V1_PREFIX}/analytics`, analyticsRoutes);
app.use(`${API_V1_PREFIX}/search`, searchRoutes);
app.use(`${API_V1_PREFIX}/webhooks`, webhookRoutes);
app.use(`${API_V1_PREFIX}/admin`, adminRoutes);
app.use(`${API_V1_PREFIX}/ai`, aiRoutes);
app.use(`${API_V1_PREFIX}/notifications`, notificationRoutes);
app.use(`${API_V1_PREFIX}/dashboards`, dashboardRoutes);
app.use(`${API_V1_PREFIX}/dashboard-folders`, dashboardFolderRoutes);
app.use(`${API_V1_PREFIX}/external-objects`, externalObjectRoutes);
app.use(`${API_V1_PREFIX}/custom-screens`, customScreenRoutes);
app.use(`${API_V1_PREFIX}/email-templates`, emailTemplateRoutes);
app.use(`${API_V1_PREFIX}/api-keys`, apiKeyRoutes);
app.use(`${API_V1_PREFIX}/object-config`, objectConfigRoutes);
app.use(`${API_V1_PREFIX}/email-senders`, emailSenderRoutes);
app.use(`${API_V1_PREFIX}/workspaces`, workspaceRoutes);
app.use(`${API_V1_PREFIX}/pdf-templates`, pdfTemplateRoutes);
app.use(`${API_V1_PREFIX}/files`, fileRoutes);
app.use(`${API_V1_PREFIX}/superadmin`, superAdminRoutes);
app.use(`${API_V1_PREFIX}/registration`, registrationRoutes);
app.use(`${API_V1_PREFIX}/billing`, billingRoutes);
app.use(`${API_V1_PREFIX}/subscription`, subscriptionRoutes);
app.use(`${API_V1_PREFIX}/incidents`, incidentRoutes);
app.use(`${API_V1_PREFIX}/integrations`, integrationRoutes);
app.use(`${API_V1_PREFIX}/recurring-tasks`, recurringTaskRoutes);
app.use(`${API_V1_PREFIX}/tenders`, tendersRoutes);
app.use(`${API_V1_PREFIX}/leads`, leadApprovalRoutes);
app.use(`${API_V1_PREFIX}/documents`, documentRoutes);
// Public, versioned Insurance business API. Authenticates via session or API key.
app.use(`${API_V1_PREFIX}/insurance`, insuranceRoutes);
// Platform-wide key/value settings with per-tenant overrides (Core BRD §14).
app.use(`${API_V1_PREFIX}/configuration`, configurationRoutes);
// Configurable multi-step approval processes (Core BRD §8).
app.use(`${API_V1_PREFIX}/approval-processes`, approvalProcessRoutes);
// Configurable duplicate detection rules (Core BRD §3.4).
app.use(`${API_V1_PREFIX}/duplicate-rules`, duplicateRuleRoutes);
// Communication consent & preferences (Core BRD §23).
app.use(`${API_V1_PREFIX}/consents`, consentRoutes);
// Activity & customer interaction framework (Core BRD §24).
app.use(`${API_V1_PREFIX}/activities`, activityRoutes);
// Metadata deployment & change sets (Core BRD §13).
app.use(`${API_V1_PREFIX}/change-sets`, changeSetRoutes);
app.use(`${API_V1_PREFIX}/custom-code`, customCodeRoutes);
app.use(`${API_V1_PREFIX}/integrations/facebook`, facebookLeadRoutes);
app.use(`${API_V1_PREFIX}/webhooks/incoming`, incomingWebhookRoutes);
// Shared picklist catalogue (Core BRD §3.2 — PICK-002).
app.use(`${API_V1_PREFIX}/global-value-sets`, globalValueSetRoutes);
// Omnichannel inbox: channel accounts, conversations & messaging templates
// (Core BRD §16).
app.use(`${API_V1_PREFIX}/channels`, channelRoutes);
app.use(`${API_V1_PREFIX}/conversations`, conversationRoutes);
app.use(`${API_V1_PREFIX}/message-templates`, messageTemplateRoutes);
// Call Centre / telephony: agent presence, dispositions & wrap-up (Core BRD §18).
app.use(`${API_V1_PREFIX}/telephony`, telephonyRoutes);

// 404 handler
app.use((req, res) => {
  res
    .status(404)
    .json({ success: false, message: `Route ${req.originalUrl} not found` });
});

// Global error handler
app.use(errorHandler);

export default app;
