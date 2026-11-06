import mongoose from 'mongoose';
import ChannelAccount, { CHANNELS } from '../models/ChannelAccount.js';
import Conversation from '../models/Conversation.js';
import Message from '../models/Message.js';
import Activity from '../models/Activity.js';
import DynamicRecord from '../models/DynamicRecord.js';
import { AppError } from '../utils/errors.js';
import { getAdapter, verifyWebhookSignature } from './channelProviders.js';

/**
 * Channel & inbound ingestion service (Core BRD §16.1-16.4, §18.2-18.3).
 *
 * Turns provider webhook payloads into Conversations, Messages and record
 * Activities, matching the contacting identifier to an existing record through
 * the account's configured match rules.
 */

/* ── Channel accounts ───────────────────────────────────────────────────── */

const listAccounts = (tenantId) =>
  ChannelAccount.find({ tenantId }).sort({ channel: 1, name: 1 });

const getAccount = async ({ tenantId, id }) => {
  const account = await ChannelAccount.findOne({ _id: id, tenantId });
  if (!account) throw new AppError('Channel account not found.', 404);
  return account;
};

/** Account including provider secrets — for server-side config validation. */
const getAccountSecrets = async ({ tenantId, id }) => {
  const account = await ChannelAccount.findOne({ _id: id, tenantId }).select(
    '+credentials +webhookSecret',
  );
  if (!account) throw new AppError('Channel account not found.', 404);
  return account;
};

const createAccount = async ({ tenantId, data = {}, user }) => {
  const { channel, name } = data;
  if (!CHANNELS.includes(channel)) {
    throw new AppError(`Unknown channel '${channel}'.`, 400);
  }
  if (!name) throw new AppError('A channel account name is required.', 400);
  return ChannelAccount.create({
    tenantId,
    channel,
    name,
    provider: data.provider,
    isActive: data.isActive,
    credentials: data.credentials,
    webhookSecret: data.webhookSecret,
    matchRules: data.matchRules,
    fieldMappings: data.fieldMappings,
    defaultOwnerId: data.defaultOwnerId,
    createObjectApiName: data.createObjectApiName,
    createdBy: user?._id,
  });
};

const updateAccount = async ({ tenantId, id, updates = {} }) => {
  const allowed = [
    'name',
    'provider',
    'isActive',
    'credentials',
    'webhookSecret',
    'matchRules',
    'fieldMappings',
    'defaultOwnerId',
    'createObjectApiName',
  ];
  const patch = {};
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(updates, key)) patch[key] = updates[key];
  }
  const account = await ChannelAccount.findOneAndUpdate(
    { _id: id, tenantId },
    { $set: patch },
    { new: true, runValidators: true },
  );
  if (!account) throw new AppError('Channel account not found.', 404);
  return account;
};

const deleteAccount = async ({ tenantId, id }) => {
  const account = await ChannelAccount.findOneAndDelete({ _id: id, tenantId });
  if (!account) throw new AppError('Channel account not found.', 404);
  return account;
};

/* ── Identifier matching ────────────────────────────────────────────────── */

const inferKind = (channel) => {
  if (channel === 'email') return 'email';
  if (['facebook', 'instagram', 'webchat'].includes(channel)) return 'identifier';
  return 'phone';
};

const normalizeIdentifier = (kind, value) => {
  const raw = String(value ?? '').trim();
  if (kind === 'email') return raw.toLowerCase();
  if (kind === 'identifier') return raw.toLowerCase();
  return raw.replace(/[^\d]/g, '');
};

/** A small set of equivalent forms so "072…", "+2772…" and "2772…" all match. */
const identifierVariants = (kind, value) => {
  const raw = String(value ?? '').trim();
  if (kind !== 'phone') return [raw, normalizeIdentifier(kind, raw)].filter(Boolean);
  const digits = raw.replace(/[^\d]/g, '');
  const set = new Set([raw, digits, `+${digits}`]);
  if (digits.startsWith('0')) set.add(digits.slice(1));
  if (digits.length >= 9) set.add(digits.slice(-9));
  return [...set].filter(Boolean);
};

const findMatchingRecord = async ({ tenantId, matchRules = [], kind, value }) => {
  if (!value || matchRules.length === 0) return null;
  for (const rule of matchRules) {
    // Only rules whose declared kind matches the incoming identifier can match.
    if (rule.kind !== kind) continue;
    const record = await DynamicRecord.findOne({
      tenantId,
      objectApiName: rule.objectApiName,
      isDeleted: false,
      [`data.${rule.fieldApiName}`]: { $in: identifierVariants(kind, value) },
    })
      .select('_id objectApiName')
      .lean();
    if (record) {
      return { objectApiName: record.objectApiName, recordId: record._id };
    }
  }
  return null;
};

/* ── Conversation plumbing ──────────────────────────────────────────────── */

const _touchConversation = async (conversation, { inbound }) => {
  conversation.lastMessageAt = new Date();
  if (inbound) {
    conversation.lastInboundAt = new Date();
    conversation.isUnread = true;
    conversation.unreadCount = (conversation.unreadCount || 0) + 1;
  }
  await conversation.save();
};

const ingestMessage = async (account, payload) => {
  const kind = inferKind(account.channel);
  const from = payload.from || {};
  const identifier = from.identifier || payload.identifier || '';
  const externalThreadId =
    payload.externalThreadId ||
    `contact:${normalizeIdentifier(kind, identifier)}` ||
    `thread:${new mongoose.Types.ObjectId()}`;

  if (!identifier) {
    throw new AppError('An inbound message requires a sender identifier.', 400);
  }

  let conversation = await Conversation.findOne({
    tenantId: account.tenantId,
    channelAccountId: account._id,
    externalThreadId,
  });
  if (!conversation) {
    const match = await findMatchingRecord({
      tenantId: account.tenantId,
      matchRules: account.matchRules,
      kind,
      value: identifier,
    });
    conversation = await Conversation.create({
      tenantId: account.tenantId,
      channel: account.channel,
      channelAccountId: account._id,
      externalThreadId,
      subject: payload.subject || '',
      contactIdentifier: normalizeIdentifier(kind, identifier),
      contactName: from.name || '',
      linkedRecord: match,
      status: 'open',
    });
  } else if (!conversation.linkedRecord) {
    // A later inbound message may match once the record exists.
    const match = await findMatchingRecord({
      tenantId: account.tenantId,
      matchRules: account.matchRules,
      kind,
      value: identifier,
    });
    if (match) conversation.linkedRecord = match;
  }

  // Idempotency: the same provider message must not be stored twice.
  if (payload.externalMessageId) {
    const existing = await Message.findOne({
      tenantId: account.tenantId,
      externalMessageId: payload.externalMessageId,
    });
    if (existing) return { conversation, message: existing, duplicate: true };
  }

  const message = await Message.create({
    tenantId: account.tenantId,
    conversationId: conversation._id,
    channelAccountId: account._id,
    channel: account.channel,
    direction: 'inbound',
    externalMessageId: payload.externalMessageId,
    senderName: from.name || '',
    senderIdentifier: identifier,
    body: payload.body || '',
    attachments: payload.attachments || [],
    status: 'received',
    occurredAt: payload.occurredAt ? new Date(payload.occurredAt) : new Date(),
  });

  await _touchConversation(conversation, { inbound: true });

  if (conversation.linkedRecord) {
    const type = ['whatsapp', 'facebook', 'instagram', 'email', 'sms'].includes(
      account.channel,
    )
      ? account.channel
      : 'other';
    await Activity.create({
      tenantId: account.tenantId,
      type,
      subject: payload.subject || `${account.channel} message`,
      body: payload.body || '',
      objectApiName: conversation.linkedRecord.objectApiName,
      recordId: conversation.linkedRecord.recordId,
      channel: account.channel,
      direction: 'inbound',
      status: 'completed',
      occurredAt: message.occurredAt,
      externalId: payload.externalMessageId
        ? `msg:${account._id}:${payload.externalMessageId}`
        : undefined,
      metadata: { conversationId: String(conversation._id) },
    }).catch(() => {}); // activity logging must never block ingestion
  }

  return { conversation, message, duplicate: false };
};

const ingestCall = async (account, payload) => {
  const number = payload.number || payload.from || '';
  if (!number) throw new AppError('An inbound call requires a number.', 400);
  const kind = 'phone';
  const externalThreadId = `contact:${normalizeIdentifier(kind, number)}`;

  let conversation = await Conversation.findOne({
    tenantId: account.tenantId,
    channelAccountId: account._id,
    externalThreadId,
  });
  const match = await findMatchingRecord({
    tenantId: account.tenantId,
    matchRules: account.matchRules,
    kind,
    value: number,
  });
  if (!conversation) {
    conversation = await Conversation.create({
      tenantId: account.tenantId,
      channel: account.channel,
      channelAccountId: account._id,
      externalThreadId,
      subject: `Call ${number}`,
      contactIdentifier: normalizeIdentifier(kind, number),
      contactName: payload.contactName || '',
      linkedRecord: match,
      status: 'open',
    });
  } else if (match && !conversation.linkedRecord) {
    conversation.linkedRecord = match;
  }

  if (payload.externalMessageId) {
    const existing = await Message.findOne({
      tenantId: account.tenantId,
      externalMessageId: payload.externalMessageId,
    });
    if (existing) return { conversation, message: existing, duplicate: true };
  }

  const duration = Number(payload.durationSeconds) || 0;
  const call = {
    direction: payload.direction || 'inbound',
    number,
    agentEmail: payload.agentEmail || '',
    startedAt: payload.startedAt ? new Date(payload.startedAt) : null,
    endedAt: payload.endedAt ? new Date(payload.endedAt) : null,
    durationSeconds: duration,
    status: payload.status || 'completed',
    callReference: payload.callReference || payload.externalMessageId || '',
    recordingUrl: payload.recordingUrl || '',
  };

  const message = await Message.create({
    tenantId: account.tenantId,
    conversationId: conversation._id,
    channelAccountId: account._id,
    channel: account.channel,
    direction: call.direction,
    externalMessageId: payload.externalMessageId,
    body: `Call ${call.direction} (${duration}s) - ${call.status}`,
    status: 'received',
    occurredAt: call.startedAt || new Date(),
    metadata: { call },
  });
  await _touchConversation(conversation, { inbound: call.direction === 'inbound' });

  if (conversation.linkedRecord) {
    const activity = await Activity.create({
      tenantId: account.tenantId,
      type: 'call',
      subject: `Call ${call.direction} - ${number}`,
      body: '',
      objectApiName: conversation.linkedRecord.objectApiName,
      recordId: conversation.linkedRecord.recordId,
      channel: 'telephony',
      direction: call.direction,
      status: 'completed',
      occurredAt: call.startedAt || new Date(),
      externalId: payload.externalMessageId
        ? `call:${account._id}:${payload.externalMessageId}`
        : undefined,
      metadata: { ...call, conversationId: String(conversation._id) },
    }).catch(() => null);

    if (activity) {
      try {
        const { fireAutomations } = await import('./automationService.js');
        fireAutomations(call.direction === 'inbound' ? 'incoming_call' : 'outgoing_call', conversation.linkedRecord.objectApiName, activity, account.tenantId).catch(() => {});
      } catch (e) { /* ignore */ }
    }
  }

  return { conversation, message, duplicate: false };
};

const ingestStatus = async (account, payload) => {
  if (!payload.externalMessageId) {
    throw new AppError('A status update requires externalMessageId.', 400);
  }
  const message = await Message.findOneAndUpdate(
    { tenantId: account.tenantId, externalMessageId: payload.externalMessageId },
    { $set: { status: payload.status || 'sent', providerStatus: payload.providerStatus || '' } },
    { new: true },
  );
  if (!message) throw new AppError('Message not found.', 404);
  return { message };
};

const ingest = async ({ account, payload }) => {
  const kind = payload?.kind;
  if (kind === 'message') return ingestMessage(account, payload);
  if (kind === 'call') return ingestCall(account, payload);
  if (kind === 'status') return ingestStatus(account, payload);
  throw new AppError(`Unsupported inbound kind '${kind}'.`, 400);
};

/** Authenticate + resolve the account for an inbound webhook. */
const resolveWebhookAccount = async ({ channel, accountId, req }) => {
  const account = await ChannelAccount.findOne({ _id: accountId, channel }).select(
    '+credentials +webhookSecret',
  );
  if (!account) throw new AppError('Channel account not found.', 404);
  if (!account.isActive) throw new AppError('Channel account is inactive.', 403);
  if (!verifyWebhookSignature(account, req)) {
    throw new AppError('Invalid webhook signature.', 401);
  }
  return account;
};

/**
 * Fire a synthetic test event for a channel account — no HTTP round-trip,
 * no signature required, safe for dev/UAT demos.
 */
const fireTestEvent = async ({ tenantId, id, kind = 'message', from = '+27820000000' }) => {
  const account = await ChannelAccount.findOne({ _id: id, tenantId });
  if (!account) throw new AppError('Channel account not found.', 404);
  const externalMessageId = `test-${kind}-${Date.now()}`;
  const payload =
    kind === 'call'
      ? {
          kind: 'call',
          direction: 'inbound',
          from,
          to: '+27110000000',
          status: 'completed',
          durationSeconds: 60,
          startedAt: new Date().toISOString(),
          externalMessageId,
        }
      : {
          kind: 'message',
          direction: 'inbound',
          from: { identifier: from },
          body: 'This is a test message from the Salesdam channel test tool.',
          externalMessageId,
        };
  return ingest({ account, payload });
};

export { getAdapter };
export default {
  listAccounts,
  getAccount,
  getAccountSecrets,
  createAccount,
  updateAccount,
  deleteAccount,
  inferKind,
  normalizeIdentifier,
  findMatchingRecord,
  ingest,
  resolveWebhookAccount,
  fireTestEvent,
};
