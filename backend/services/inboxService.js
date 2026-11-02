import Conversation from '../models/Conversation.js';
import Message from '../models/Message.js';
import ChannelAccount from '../models/ChannelAccount.js';
import Activity from '../models/Activity.js';
import DynamicRecord from '../models/DynamicRecord.js';
import ObjectMeta from '../models/ObjectMeta.js';
import FieldMeta from '../models/FieldMeta.js';
import consentService from './consentService.js';
import channelProviders from './channelProviders.js';
import duplicateDetectionService from './duplicateDetectionService.js';
import { validateRecordData, evaluateValidationRules, buildValidationFailure } from './validationService.js';
import { buildSearchText } from './searchService.js';
import { computeFormulaValues, computeAndSetFormulaValues } from './formulaService.js';
import { applyAutoNumbers } from './autoNumberService.js';
import { setRollupValuesOnRecord } from './rollupService.js';
import { fireAutomations } from './automationService.js';
import { getEditableFields, hasObjectPermission } from '../middleware/permissions.js';
import { AppError } from '../utils/errors.js';

/**
 * Omnichannel inbox service (Core BRD §16.2, §16.3, §16.4).
 * Agents view, own, transfer and reply to conversations; outbound replies pass
 * through the shared consent check (§16.6) and the channel provider adapter.
 */

// Only channels with a defined consent dimension are enforced; others are
// surfaced without a consent gate rather than invented as one.
const CONSENT_CHANNEL = {
  email: 'email',
  whatsapp: 'whatsapp',
  sms: 'sms',
  telephony: 'telephone',
};

const listConversations = async ({
  tenantId,
  userId,
  assignedToMe,
  assigned,
  status,
  channel,
  isUnread,
  limit,
  skip,
}) => {
  const filter = { tenantId };
  if (status) filter.status = status;
  if (channel) filter.channel = channel;
  if (isUnread === 'true' || isUnread === true) filter.isUnread = true;
  if (assignedToMe === 'true' || assignedToMe === true) filter.assignedTo = userId;
  if (assigned === 'unassigned') filter.assignedTo = null;
  if (assigned === 'assigned') filter.assignedTo = { $ne: null };

  const size = Math.min(Number(limit) || 25, 100);
  const offset = Number(skip) || 0;
  const [items, total] = await Promise.all([
    Conversation.find(filter)
      .sort({ lastMessageAt: -1, createdAt: -1 })
      .skip(offset)
      .limit(size)
      .populate('assignedTo', 'firstName lastName')
      .lean(),
    Conversation.countDocuments(filter),
  ]);
  return { items, total, limit: size, skip: offset };
};

const getConversation = async ({ tenantId, id }) => {
  const conversation = await Conversation.findOne({ _id: id, tenantId }).populate(
    'assignedTo',
    'firstName lastName',
  );
  if (!conversation) throw new AppError('Conversation not found.', 404);
  return conversation;
};

const listMessages = async ({ tenantId, conversationId, limit, skip }) => {
  await getConversation({ tenantId, id: conversationId });
  const size = Math.min(Number(limit) || 50, 200);
  const offset = Number(skip) || 0;
  const [items, total] = await Promise.all([
    Message.find({ tenantId, conversationId })
      .sort({ occurredAt: 1 })
      .skip(offset)
      .limit(size)
      .populate('authorId', 'firstName lastName')
      .lean(),
    Message.countDocuments({ tenantId, conversationId }),
  ]);
  return { items, total, limit: size, skip: offset };
};

const assignConversation = async ({ tenantId, id, userId }) => {
  const conversation = await getConversation({ tenantId, id });
  conversation.assignedTo = userId || null;
  await conversation.save();
  return conversation;
};

const setStatus = async ({ tenantId, id, status }) => {
  const conversation = await getConversation({ tenantId, id });
  conversation.status = status;
  conversation.closedAt = status === 'closed' ? new Date() : null;
  await conversation.save();
  return conversation;
};

const linkRecord = async ({ tenantId, id, objectApiName, recordId }) => {
  const conversation = await getConversation({ tenantId, id });
  if (!objectApiName || !recordId) {
    conversation.linkedRecord = null;
  } else {
    conversation.linkedRecord = { objectApiName, recordId };
  }
  await conversation.save();
  return conversation;
};

/** Consent check for an outbound reply, using the shared consent service. */
const _assertCanContact = async ({ tenantId, channel, linkedRecord }) => {
  const consentChannel = CONSENT_CHANNEL[channel];
  if (!consentChannel || !linkedRecord) return { enforced: false };
  const result = await consentService.canContact(
    tenantId,
    linkedRecord.objectApiName,
    linkedRecord.recordId,
    consentChannel,
  );
  if (result.enforced && !result.allowed) {
    throw new AppError(`Contact blocked: ${result.reason}.`, 403);
  }
  return result;
};

const reply = async ({ tenantId, id, body, attachments = [], user }) => {
  if (!body) throw new AppError('A reply body is required.', 400);
  const conversation = await getConversation({ tenantId, id });
  if (conversation.status === 'closed') {
    throw new AppError('Reopen the conversation before replying.', 409);
  }

  await _assertCanContact({
    tenantId,
    channel: conversation.channel,
    linkedRecord: conversation.linkedRecord,
  });

  // Send through the channel abstraction: adapter availability and provider
  // credentials decide the resulting status.
  const account = await ChannelAccount.findOne({
    _id: conversation.channelAccountId,
    tenantId,
  }).select('+credentials');
  const adapter = channelProviders.getAdapter(conversation.channel);
  const outcome = await adapter.send(account, { body, attachments });

  const message = await Message.create({
    tenantId,
    conversationId: conversation._id,
    channelAccountId: conversation.channelAccountId,
    channel: conversation.channel,
    direction: 'outbound',
    authorId: user?._id,
    senderName: `${user?.firstName || ''} ${user?.lastName || ''}`.trim(),
    body,
    attachments,
    status: outcome.status,
    providerStatus: outcome.providerStatus,
    providerNote: outcome.note,
  });

  if (conversation.linkedRecord) {
    const type = ['whatsapp', 'facebook', 'instagram', 'email', 'sms'].includes(
      conversation.channel,
    )
      ? conversation.channel
      : 'other';
    await Activity.create({
      tenantId,
      type,
      subject: `${conversation.channel} reply`,
      body,
      objectApiName: conversation.linkedRecord.objectApiName,
      recordId: conversation.linkedRecord.recordId,
      channel: conversation.channel,
      direction: 'outbound',
      status: 'completed',
      occurredAt: message.createdAt,
      metadata: { conversationId: String(conversation._id) },
    }).catch(() => {});
  }

  conversation.lastMessageAt = new Date();
  await conversation.save();
  return message;
};

const addNote = async ({ tenantId, id, body, user }) => {
  if (!body) throw new AppError('A note body is required.', 400);
  const conversation = await getConversation({ tenantId, id });
  return Message.create({
    tenantId,
    conversationId: conversation._id,
    channelAccountId: conversation.channelAccountId,
    channel: conversation.channel,
    direction: 'outbound',
    isInternalNote: true, // visible to agents, never sent to the customer
    authorId: user?._id,
    senderName: `${user?.firstName || ''} ${user?.lastName || ''}`.trim(),
    body,
    status: 'sent',
  });
};

/**
 * Create a record from a conversation (Core BRD §16.4) — an agent turns a
 * thread into a Lead/Contact/etc. The target object is the requested object,
 * else the channel account's `createObjectApiName`, else its first match rule.
 * Duplicate rules and field validation apply exactly as on manual capture.
 */
const createRecordFromConversation = async ({
  tenantId,
  id,
  objectApiName,
  data = {},
  user,
}) => {
  const conversation = await getConversation({ tenantId, id });
  if (conversation.linkedRecord) {
    throw new AppError('This conversation is already linked to a record.', 409);
  }
  if (!data || typeof data !== 'object') {
    throw new AppError('data must be an object.', 400);
  }

  const account = await ChannelAccount.findOne({
    _id: conversation.channelAccountId,
    tenantId,
  });
  const targetObject =
    objectApiName ||
    account?.createObjectApiName ||
    account?.matchRules?.[0]?.objectApiName;
  if (!targetObject) {
    throw new AppError('No target object could be determined for this conversation.', 400);
  }
  if (!(await hasObjectPermission(user, 'create', targetObject))) {
    throw new AppError(`You do not have permission to create ${targetObject}.`, 403);
  }

  const obj = await ObjectMeta.findOne({ tenantId, apiName: targetObject });
  if (!obj) throw new AppError(`Object "${targetObject}" not found.`, 404);
  const fields = await FieldMeta.find({ tenantId, objectApiName: targetObject });

  // Prefill the matched identifier and the contact's display name; explicit
  // caller data wins.
  const payload = {};
  const rule = (account?.matchRules || []).find(
    (r) => r.objectApiName === targetObject,
  );
  if (rule?.fieldApiName && conversation.contactIdentifier) {
    payload[rule.fieldApiName] = conversation.contactIdentifier;
  }
  const nameField = obj.nameFieldApiName || 'name';
  if (conversation.contactName) payload[nameField] = conversation.contactName;
  Object.assign(payload, data);

  const duplicateCheck = await duplicateDetectionService.check(
    tenantId,
    targetObject,
    payload,
    {},
  );
  if (duplicateCheck.action === 'block') {
    const err = new AppError('A potential duplicate record was found.', 409);
    err.duplicates = duplicateCheck.matches;
    throw err;
  }

  const editable = await getEditableFields(
    user,
    targetObject,
    fields.map((f) => f.apiName),
  );
  const editableBody = Object.fromEntries(
    Object.entries(payload).filter(([k]) => editable.includes(k)),
  );

  const { data: validated, errors, fieldErrors } = await validateRecordData(
    editableBody,
    fields,
    tenantId,
    null,
  );
  const ruleErrors = await evaluateValidationRules({
    tenantId,
    rules: obj.validationRules || [],
    data: { ...validated, ...computeFormulaValues(validated, fields) },
  });
  // BRD 6.2: every failing check and rule together.
  const failure = buildValidationFailure({ errors, fieldErrors }, ruleErrors);
  if (failure) throw failure;

  const record = new DynamicRecord({
    tenantId,
    objectId: obj._id,
    objectApiName: targetObject,
    ownerId: conversation.assignedTo || account?.defaultOwnerId || user?._id,
    createdBy: user?._id,
    lastModifiedBy: user?._id,
  });
  Object.entries(validated).forEach(([key, value]) => record.setField(key, value));

  await applyAutoNumbers(record, fields, tenantId, targetObject);
  await setRollupValuesOnRecord(tenantId, record, fields);
  await computeAndSetFormulaValues(record, fields);
  record._searchText = await buildSearchText(record, fields);
  await record.save();

  conversation.linkedRecord = {
    objectApiName: targetObject,
    recordId: record._id,
  };
  await conversation.save();

  fireAutomations('create', targetObject, record, tenantId).catch(() => {});

  return {
    record: record.toDataObject(),
    objectApiName: targetObject,
    duplicateMatches:
      duplicateCheck.action === 'warn' ? duplicateCheck.matches : [],
    conversationId: String(conversation._id),
  };
};

export default {
  listConversations,
  getConversation,
  listMessages,
  assignConversation,
  setStatus,
  linkRecord,
  reply,
  addNote,
  createRecordFromConversation,
};
