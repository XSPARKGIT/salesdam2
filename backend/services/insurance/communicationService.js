/**
 * Insurance customer communication logging (BRD §16.3).
 *
 * Records every notification sent to a client for policy, payment and claim
 * events. Actual delivery (email/WhatsApp) is handled by the Automation
 * engine; this service owns the durable log of what was sent, when, through
 * which channel, and for which event.
 *
 * Event types: policy_issued, policy_endorsement, policy_approved,
 *              policy_rejected, policy_lapsed, policy_reinstated, policy_cancelled,
 *              payment_due, payment_received, payment_failed, payment_missed_1/2/3,
 *              claim_reported, claim_approved, claim_declined, claim_paid
 */
import { findOne, findMany, createDynamic } from './dynamicRecords.js';
import { dataOf } from './pricingService.js';
import { AppError } from '../../utils/errors.js';
import { audit } from '../../utils/auditLogger.js';

export const COMMUNICATION_EVENTS = [
  'policy_issued',
  'policy_endorsement',
  'policy_approved',
  'policy_rejected',
  'policy_lapsed',
  'policy_reinstated',
  'policy_cancelled',
  'payment_due',
  'payment_received',
  'payment_failed',
  'payment_missed_1',
  'payment_missed_2',
  'payment_missed_3',
  'claim_reported',
  'claim_approved',
  'claim_declined',
  'claim_paid',
];

export const COMMUNICATION_CHANNELS = ['email', 'whatsapp', 'sms', 'post'];

const idOf = (rec) => String(rec._id);

/**
 * Log a communication. `subject`, `body`, `channel` and `event` are required.
 * `client` (recipient) must be a tenant-scoped Client id.
 * `attachments` is optional: array of { fileId, name, mimeType }.
 */
export const logCommunication = async ({
  tenantId,
  userId,
  policyId,
  claimId,
  client,
  event,
  channel,
  subject,
  body,
  // Queued until the dispatcher actually delivers it (it only picks up
  // 'queued' records, then marks them sent or failed). Logging as 'sent'
  // claimed delivery that never happened and kept the dispatcher idle.
  status = 'queued',
  attachments = [],
}) => {
  if (!COMMUNICATION_EVENTS.includes(event)) {
    throw new AppError(`Unknown communication event "${event}".`, 400);
  }
  if (!COMMUNICATION_CHANNELS.includes(channel)) {
    throw new AppError(`Invalid channel "${channel}". Must be one of: ${COMMUNICATION_CHANNELS.join(', ')}`, 400);
  }
  if (!subject || !body) {
    throw new AppError('subject and body are required.', 400);
  }
  if (!client) {
    throw new AppError('client (recipient) is required.', 400);
  }

  const data = {
    name: `${event} — ${subject}`.slice(0, 100),
    event,
    channel,
    subject,
    body,
    status,
    client: String(client),
    logged_at: new Date(),
    // Only a communication that has actually gone out has a sent time; the
    // dispatcher stamps it on delivery.
    sent_at: status === 'sent' ? new Date() : undefined,
    attachments: attachments.length ? attachments : undefined,
  };
  if (policyId) data.policy = String(policyId);
  if (claimId) data.claim = String(claimId);

  const comm = await createDynamic({
    tenantId,
    objectApiName: 'policy_communication',
    userId,
    data,
  });

  await audit({
    tenantId,
    userId,
    action: 'create',
    resource: 'PolicyCommunication',
    resourceId: comm._id,
    objectApiName: 'policy_communication',
    details: { event, channel, policy: policyId, claim: claimId },
  });

  return { id: idOf(comm), ...data };
};

/** List communications, optionally filtered by policy or claim. */
export const listCommunications = async ({ tenantId, policyId, claimId, event, channel }) => {
  const filter = {};
  if (policyId) filter['data.policy'] = String(policyId);
  if (claimId) filter['data.claim'] = String(claimId);
  if (event) filter['data.event'] = event;
  if (channel) filter['data.channel'] = channel;

  const comms = await findMany(tenantId, 'policy_communication', filter, { createdAt: -1 });
  return comms.map((c) => ({ id: idOf(c), ...dataOf(c) }));
};

/** Convenience: log a policy event notification. */
export const notifyPolicyEvent = async ({ tenantId, userId, policyId, event, channel, client, subject, body }) =>
  logCommunication({ tenantId, userId, policyId, event, channel, client, subject, body });

/** Convenience: log a claim event notification. */
export const notifyClaimEvent = async ({ tenantId, userId, claimId, event, channel, client, subject, body }) =>
  logCommunication({ tenantId, userId, claimId, event, channel, client, subject, body });

export default {
  COMMUNICATION_EVENTS,
  COMMUNICATION_CHANNELS,
  logCommunication,
  listCommunications,
  notifyPolicyEvent,
  notifyClaimEvent,
};