/**
 * Communication dispatcher (BRD §16.3).
 *
 * Delivers queued `policy_communication` records via their configured channel.
 * Currently implements **email** via the Automation engine's EmailSender;
 * WhatsApp/SMS/Post are stubbed (awaiting provider credentials).
 *
 * Runs as a scheduled job (e.g., every 5 minutes via cron):
 *   node scripts/dispatch-communications.js
 *
 * Or invoked programmatically from the scheduler.
 */

import DynamicRecord from '../../models/DynamicRecord.js';
import EmailSender from '../../models/EmailSender.js';
import * as commTemplates from './communicationTemplates.js';
import * as commService from './communicationService.js';
import logger from '../../utils/logger.js';

const COMMUNICATION_CHANNELS = ['email', 'whatsapp', 'sms', 'post'];
const COMMUNICATION_STATUSES = {
  QUEUED: 'queued',
  SENT: 'sent',
  DELIVERED: 'delivered',
  FAILED: 'failed',
};

/**
 * Domains reserved for documentation and testing (RFC 2606, RFC 6761). Mail
 * to them can never be delivered, and the test suites use them — so they are
 * never handed to a real SMTP server, which would otherwise send (and bounce)
 * mail from a developer's configured account on every test run.
 */
const RESERVED_DOMAIN = /(^|\.)(example\.(com|net|org)|[^.]+\.(test|example|invalid|localhost))$/i;
export const isReservedEmailDomain = (email) => {
  const domain = String(email || '').split('@')[1] || '';
  return RESERVED_DOMAIN.test(domain) || /^(test|example|invalid|localhost)$/i.test(domain);
};

/**
 * Resolve the SMTP transporter for a tenant.
 * Prefers a configured EmailSender; falls back to env vars.
 */
const getTransporter = async (tenantId, emailSenderId) => {
  const nodemailer = (await import('nodemailer')).default;

  // Try explicit EmailSender first
  if (emailSenderId) {
    const sender = await EmailSender.findOne({
      _id: emailSenderId,
      tenantId,
      isActive: true,
    }).select('+smtpUser +smtpPass');
    if (sender?.smtpHost) {
      const transporter = (await import('nodemailer')).default.createTransport({
        host: sender.smtpHost,
        port: sender.smtpPort || 587,
        secure: sender.smtpSecure,
        auth: sender.smtpUser
          ? { user: sender.smtpUser, pass: sender.smtpPass || '' }
          : undefined,
      });
      return { transporter, from: sender.replyTo
        ? `"${sender.name}" <${sender.email}>`
        : `"${sender.name}" <${sender.email}>` };
    }
  }

  // Fallback to tenant's default EmailSender
  const defaultSender = await EmailSender.findOne({
    tenantId,
    isDefault: true,
    isActive: true,
  }).select('+smtpUser +smtpPass');
  if (defaultSender?.smtpHost) {
    const transporter = (await import('nodemailer')).default.createTransport({
      host: defaultSender.smtpHost,
      port: defaultSender.smtpPort || 587,
      secure: defaultSender.smtpSecure,
      auth: defaultSender.smtpUser
        ? { user: defaultSender.smtpUser, pass: defaultSender.smtpPass || '' }
        : undefined,
    });
    return {
      transporter,
      from: defaultSender.replyTo
        ? `"${defaultSender.name}" <${defaultSender.email}>`
        : `"${defaultSender.name}" <${defaultSender.email}>`,
    };
  }

  // Fallback to environment variables
  if (process.env.SMTP_HOST) {
    const transporter = (await import('nodemailer')).default.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    });
    return { transporter, from: process.env.SMTP_FROM || 'noreply@crm.local' };
  }

  return null;
};

/**
 * Deliver a single communication record.
 * Returns { success: boolean, error?: string }.
 */
export const deliverCommunication = async (tenantId, communication) => {
  const cData = communication.data instanceof Map
    ? Object.fromEntries(communication.data)
    : communication.data;

  const { channel, subject, body, client } = cData;
  // Logged communications store the policy as `policy`.
  const policyId = cData.policy || cData.policyId;

  // Build the recipient context
  const context = {
    client: { name: 'Client' },
    policy: { policy_number: 'UNKNOWN' },
    transaction: { amount: 0, due_date: '' },
    now: new Date().toISOString().slice(0, 10),
  };

  if (client) {
    const clientRec = await DynamicRecord.findOne({
      tenantId,
      objectApiName: 'client',
      _id: client,
      isDeleted: false,
    });
    if (clientRec) {
      const c = clientRec.data instanceof Map ? Object.fromEntries(clientRec.data) : clientRec.data;
      context.client = { name: c.name || c.email || 'Client', email: c.email };
    }
  }

  if (policyId) {
    const policy = await DynamicRecord.findOne({
      tenantId,
      objectApiName: 'policy',
      _id: policyId,
      isDeleted: false,
    });
    if (policy) {
      const p = policy.data instanceof Map ? Object.fromEntries(policy.data) : policy.data;
      context.policy = { policy_number: p.policy_number };
      if (p.current_premium) context.transaction = { amount: p.current_premium };
    }
  }

  if (channel === 'email') {
    return deliverEmail(tenantId, communication, context);
  } else if (channel === 'whatsapp') {
    return deliverWhatsApp(tenantId, communication, context);
  } else if (channel === 'sms') {
    return deliverSMS(tenantId, communication, context);
  } else if (channel === 'post') {
    return deliverPost(tenantId, communication, context);
  }

  return { success: false, error: `Unsupported channel: ${channel}` };
};

/** Send via email using SMTP. */
const deliverEmail = async (tenantId, communication, context) => {
  const cData = communication.data instanceof Map
    ? Object.fromEntries(communication.data)
    : communication.data;

  const { subject, body, client, emailSenderId } = cData;

  // Resolve recipient email
  let to = null;
  if (client) {
    const clientRec = await DynamicRecord.findOne({
      tenantId: communication.tenantId,
      objectApiName: 'client',
      _id: client,
      isDeleted: false,
    });
    if (clientRec) {
      const c = clientRec.data instanceof Map ? Object.fromEntries(clientRec.data) : clientRec.data;
      if (c.email) to = c.email;
    }
  }
  if (!to) return { success: false, error: 'No recipient email address' };
  // Left queued (not failed): nothing was attempted.
  if (isReservedEmailDomain(to)) {
    return { success: false, error: `Not sent: ${to} is a reserved test domain` };
  }

  const renderedSubject = commTemplates.renderTemplate(subject, context);
  const renderedBody = commTemplates.renderTemplate(body, context);

  const transport = await getTransporter(communication.tenantId, cData.emailSenderId);
  if (!transport) {
    return { success: false, error: 'No SMTP configuration available' };
  }

  try {
    await transport.transporter.sendMail({
      from: transport.from,
      to,
      subject: commTemplates.renderTemplate(subject, context),
      text: commTemplates.renderTemplate(cData.body, context),
      html: cData.htmlBody ? commTemplates.renderTemplate(cData.htmlBody, context) : undefined,
    });

    // Update communication status
    await DynamicRecord.updateOne(
      { _id: communication._id, tenantId },
      { $set: { 'data.status': COMMUNICATION_STATUSES.SENT, 'data.sent_at': new Date() } },
    );

    return { success: true };
  } catch (err) {
    logger.error('Communication email delivery failed:', err.message);
    await DynamicRecord.updateOne(
      { _id: communication._id, tenantId },
      { $set: { 'data.status': COMMUNICATION_STATUSES.FAILED, 'data.failed_reason': err.message } },
    );
    return { success: false, error: err.message };
  }
};

/** WhatsApp delivery — stub (awaiting provider). */
const deliverWhatsApp = async () => ({ success: false, error: 'WhatsApp provider not configured' });

/** SMS delivery — stub (awaiting provider). */
const deliverSMS = async () => ({ success: false, error: 'SMS provider not configured' });

/** Physical post — stub. */
const deliverPost = async () => ({ success: false, error: 'Post delivery not implemented' });

/**
 * Process all queued communications for a tenant.
 * Returns { processed, sent, failed }.
 */
export const dispatchCommunications = async (tenantId) => {
  const queued = await DynamicRecord.find({
    tenantId,
    objectApiName: 'policy_communication',
    'data.status': COMMUNICATION_STATUSES.QUEUED,
    isDeleted: false,
  }).sort({ createdAt: 1 }).limit(100); // batch limit

  if (!queued.length) return { processed: 0, sent: 0, failed: 0 };

  let sent = 0;
  let failed = 0;

  for (const comm of queued) {
    const result = await deliverCommunication(tenantId, comm);
    if (result.success) sent++;
    else failed++;
  }

  return { processed: queued.length, sent, failed };
};

/**
 * Process all queued communications across all insurance tenants.
 */
export const dispatchCommunicationsAllTenants = async () => {
  const tenants = await DynamicRecord.db.db
    .collection('tenants')
    .find({ status: 'active', hub: 'insurance' })
    .toArray();

  const allResults = {};
  for (const tenant of tenants) {
    try {
      allResults[String(tenant._id)] = await dispatchCommunications(String(tenant._id));
    } catch (err) {
      logger.error(`Communication dispatch failed for tenant ${tenant.name}:`, err.message);
      allResults[String(tenant._id)] = { error: err.message };
    }
  }
  return allResults;
};

export default {
  deliverCommunication,
  dispatchCommunications,
  dispatchCommunicationsAllTenants,
  COMMUNICATION_STATUSES,
};