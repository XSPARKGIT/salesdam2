import Conversation from '../models/Conversation.js';
import Message from '../models/Message.js';
import ChannelAccount from '../models/ChannelAccount.js';
import Activity from '../models/Activity.js';
import DynamicRecord from '../models/DynamicRecord.js';
import ObjectMeta from '../models/ObjectMeta.js';
import FieldMeta from '../models/FieldMeta.js';
import consentService from './consentService.js';
import channelProviders from './channelProviders.js';
import messageTemplateService from './messageTemplateService.js';
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

/** Resolve the recipient address/number/PSID the adapter must send to. */
const _recipientFor = (conversation) => conversation.contactIdentifier;

/**
 * Shared outbound-send core used by both a free-text reply and a template
 * send: consent check, channel adapter dispatch, Message + Activity record.
 * `extra` carries subject/template so each caller's concerns stay separate.
 */
const _sendAndRecord = async ({ tenantId, conversation, body, attachments = [], user, subject, template }) => {
  await _assertCanContact({
    tenantId,
    channel: conversation.channel,
    linkedRecord: conversation.linkedRecord,
  });

  const account = await ChannelAccount.findOne({
    _id: conversation.channelAccountId,
    tenantId,
  }).select('+credentials');
  const adapter = channelProviders.getAdapter(conversation.channel);
  const outcome = await adapter.send(account, {
    body,
    attachments,
    subject,
    template,
    recipientIdentifier: _recipientFor(conversation),
  });

  const message = await Message.create({
    tenantId,
    conversationId: conversation._id,
    channelAccountId: conversation.channelAccountId,
    channel: conversation.channel,
    direction: 'outbound',
    authorId: user?._id,
    senderName: user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() : 'Automation',
    body,
    attachments,
    externalMessageId: outcome.externalMessageId,
    status: outcome.status,
    providerStatus: outcome.providerStatus,
    providerNote: outcome.note,
    metadata: template ? { templateId: String(template.id || ''), templateName: template.name } : {},
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
      subject: subject || `${conversation.channel} reply`,
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

const reply = async ({ tenantId, id, body, attachments = [], user }) => {
  if (!body) throw new AppError('A reply body is required.', 400);
  const conversation = await getConversation({ tenantId, id });
  if (conversation.status === 'closed') {
    throw new AppError('Reopen the conversation before replying.', 409);
  }
  return _sendAndRecord({ tenantId, conversation, body, attachments, user });
};

/**
 * Send a reusable MessageTemplate into a conversation (§16.5). Merge fields
 * resolve from the conversation's linked record. A WhatsApp template may only
 * be sent once its provider has approved it — unlike free text, WhatsApp's
 * Business Platform rejects unapproved templates, so this is enforced before
 * any provider call is attempted, not left to the provider to reject.
 */
/**
 * Shared template-send core (§16.5): channel match, WhatsApp provider-approval
 * gate, merge-field resolution, dispatch. Used by both a reply to an existing
 * conversation and a fresh send-to-record (e.g. from a Flow action) so the
 * approval rule can never be bypassed by taking a different entry point.
 */
const _sendTemplateCore = async ({ tenantId, conversation, templateId, extraValues = {}, user }) => {
  const template = await messageTemplateService.getTemplate({ tenantId, id: templateId });
  if (!template.isActive) throw new AppError('This template is inactive.', 400);
  if (template.channel !== conversation.channel) {
    throw new AppError(
      `This template is for ${template.channel}, not ${conversation.channel}.`,
      400,
    );
  }
  if (conversation.channel === 'whatsapp' && template.providerStatus !== 'approved') {
    throw new AppError(
      `WhatsApp template "${template.name}" has not been approved by the provider (status: ${template.providerStatus || 'none'}).`,
      409,
    );
  }

  const values = await _recordMergeValues({
    tenantId,
    linkedRecord: conversation.linkedRecord,
    extraValues,
  });
  const body = messageTemplateService.render(template.body, values);
  const subject = messageTemplateService.render(template.subject, values);

  return _sendAndRecord({
    tenantId,
    conversation,
    body,
    user,
    subject,
    template: {
      id: template._id,
      name: template.name,
      providerTemplateId: template.providerTemplateId,
      language: template.language,
    },
  });
};

const replyWithTemplate = async ({ tenantId, id, templateId, extraValues = {}, user }) => {
  const conversation = await getConversation({ tenantId, id });
  if (conversation.status === 'closed') {
    throw new AppError('Reopen the conversation before replying.', 409);
  }
  return _sendTemplateCore({ tenantId, conversation, templateId, extraValues, user });
};

/** Build a flat merge-field values object from a linked record's data map. */
const _recordMergeValues = async ({ tenantId, linkedRecord, extraValues = {} }) => {
  if (!linkedRecord) return { ...extraValues };
  const record = await DynamicRecord.findOne({
    tenantId,
    _id: linkedRecord.recordId,
    objectApiName: linkedRecord.objectApiName,
    isDeleted: false,
  }).lean();
  if (!record) return { ...extraValues };
  const fieldData =
    record.data instanceof Map ? Object.fromEntries(record.data) : record.data || {};
  return { ...fieldData, ...extraValues };
};

// EmailTemplate uses single-brace {field} tokens (distinct from MessageTemplate's
// {{field}}) — matches the existing /email-templates/:id/preview route's own
// renderer so merge behaviour is identical whether previewed or actually sent.
const _renderEmailTemplate = (str, values) =>
  String(str || '').replace(/\{(\w+)\}/g, (_, k) => (values?.[k] ?? `{${k}}`));

/**
 * Send a real email from a Lead/Contact/Account/other record (§16.7), reusing
 * the same consent check, channel adapter dispatch and Activity logging as
 * every other channel — no second messaging path. Finds or creates an email
 * Conversation for the recipient and links it to the record, so the sent
 * email (and any future reply) shows up in that record's Activity timeline.
 */
/**
 * Find or create the Conversation a fresh outbound message (not a reply in an
 * already-open thread) should attach to, linking it to the triggering record.
 * Shared by sendEmailToRecord and sendTemplateToRecord so "start a new
 * correspondence from a record" behaves identically across channels.
 */
const _findOrCreateConversationForRecord = async ({ tenantId, account, identifier, linkedRecord, contactName }) => {
  const identifier_ = String(identifier).toLowerCase().trim();
  const externalThreadId = `contact:${identifier_}`;
  let conversation = await Conversation.findOne({
    tenantId,
    channelAccountId: account._id,
    externalThreadId,
  });
  if (!conversation) {
    conversation = await Conversation.create({
      tenantId,
      channel: account.channel,
      channelAccountId: account._id,
      externalThreadId,
      contactIdentifier: identifier_,
      contactName: contactName || '',
      linkedRecord,
      status: 'open',
    });
  } else {
    if (!conversation.linkedRecord) conversation.linkedRecord = linkedRecord;
    // A fresh send is new correspondence from the agent/Flow's side — surface
    // it even if the thread had previously been closed.
    conversation.status = 'open';
    await conversation.save();
  }
  return conversation;
};

const sendEmailToRecord = async ({ tenantId, objectApiName, recordId, to, subject, body, templateId, channelAccountId, user }) => {
  if (!to) throw new AppError('A recipient email address is required.', 400);

  const account = channelAccountId
    ? await ChannelAccount.findOne({ _id: channelAccountId, tenantId, channel: 'email' }).select('+credentials')
    : await ChannelAccount.findOne({ tenantId, channel: 'email', isActive: true }).select('+credentials');
  if (!account) {
    throw new AppError(
      'No active email channel account is configured. Create one under Channel Accounts (channel: email) first.',
      400,
    );
  }

  const linkedRecord = { objectApiName, recordId };
  let finalSubject = subject;
  let finalBody = body;
  let templateMeta;

  if (templateId) {
    const EmailTemplate = (await import('../models/EmailTemplate.js')).default;
    const template = await EmailTemplate.findOne({ _id: templateId, tenantId });
    if (!template) throw new AppError('Email template not found.', 404);
    if (!template.isActive) throw new AppError('This email template is inactive.', 400);
    const values = await _recordMergeValues({ tenantId, linkedRecord });
    finalSubject = _renderEmailTemplate(template.subject, values);
    finalBody = _renderEmailTemplate(template.bodyHtml || template.bodyText, values);
    templateMeta = { id: template._id, name: template.name };
  } else {
    if (!subject || !body) {
      throw new AppError('subject and body are required when not using a template.', 400);
    }
    const values = await _recordMergeValues({ tenantId, linkedRecord });
    finalSubject = _renderEmailTemplate(subject, values);
    finalBody = _renderEmailTemplate(body, values);
  }

  const conversation = await _findOrCreateConversationForRecord({
    tenantId, account, identifier: to, linkedRecord,
  });

  const message = await _sendAndRecord({
    tenantId,
    conversation,
    body: finalBody,
    user,
    subject: finalSubject,
    template: templateMeta,
  });

  return { message, conversationId: String(conversation._id) };
};

/**
 * Send a reusable MessageTemplate to a record on any channel without an
 * existing conversation — the Flow action path (§5, §16.5). Goes through the
 * exact same _sendTemplateCore as a manual Inbox reply, so a Flow can no more
 * send an unapproved WhatsApp template than an agent can.
 */
const sendTemplateToRecord = async ({ tenantId, objectApiName, recordId, channel, to, templateId, channelAccountId, extraValues = {}, user }) => {
  if (!channel) throw new AppError('channel is required.', 400);
  if (!to) throw new AppError('A recipient identifier (phone/email/handle) is required.', 400);

  const account = channelAccountId
    ? await ChannelAccount.findOne({ _id: channelAccountId, tenantId, channel }).select('+credentials')
    : await ChannelAccount.findOne({ tenantId, channel, isActive: true }).select('+credentials');
  if (!account) {
    throw new AppError(
      `No active ${channel} channel account is configured. Create one under Channel Accounts first.`,
      400,
    );
  }

  const conversation = await _findOrCreateConversationForRecord({
    tenantId, account, identifier: to, linkedRecord: { objectApiName, recordId },
  });

  const message = await _sendTemplateCore({ tenantId, conversation, templateId, extraValues, user });
  return { message, conversationId: String(conversation._id) };
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

/**
 * Copy a conversation and its messages to another tenant. The target tenant
 * must have an active channel account for the same channel. The source
 * conversation is closed by default and marked with transfer metadata.
 */
const transferToTenant = async ({ fromTenantId, conversationId, targetTenantId, closeSource = true }) => {
  if (!targetTenantId) throw new AppError('targetTenantId is required.', 400);
  if (String(fromTenantId) === String(targetTenantId)) {
    throw new AppError('Source and target tenant are the same.', 400);
  }

  const sourceConv = await Conversation.findOne({ _id: conversationId, tenantId: fromTenantId });
  if (!sourceConv) throw new AppError('Conversation not found.', 404);

  const targetAccount = await ChannelAccount.findOne({
    tenantId: targetTenantId,
    channel: sourceConv.channel,
    isActive: true,
  });
  if (!targetAccount) {
    throw new AppError(
      `No active ${sourceConv.channel} channel account in the target tenant.`,
      400,
    );
  }

  const externalThreadId = `transfer:${String(sourceConv._id)}`;
  let targetConv = await Conversation.findOne({
    tenantId: targetTenantId,
    channelAccountId: targetAccount._id,
    externalThreadId,
  });
  if (!targetConv) {
    targetConv = await Conversation.create({
      tenantId: targetTenantId,
      channel: sourceConv.channel,
      channelAccountId: targetAccount._id,
      externalThreadId,
      contactIdentifier: sourceConv.contactIdentifier,
      contactName: sourceConv.contactName,
      subject: sourceConv.subject,
      status: 'open',
      metadata: {
        transferredFrom: String(sourceConv._id),
        transferredFromTenant: String(fromTenantId),
      },
    });
  }

  const sourceMessages = await Message.find({ tenantId: fromTenantId, conversationId: sourceConv._id })
    .sort({ occurredAt: 1 })
    .lean();

  let messagesCopied = 0;
  if (sourceMessages.length > 0) {
    const copiedMessages = sourceMessages.map(({ _id, tenantId: _t, conversationId: _cid, channelAccountId: _ca, externalMessageId: _eid, ...rest }) => ({
      ...rest,
      tenantId: targetTenantId,
      conversationId: targetConv._id,
      channelAccountId: targetAccount._id,
      metadata: { ...(rest.metadata || {}), originalMessageId: String(_id), originalTenantId: String(fromTenantId) },
    }));
    await Message.insertMany(copiedMessages, { ordered: false });
    messagesCopied = copiedMessages.length;
    const lastMsg = sourceMessages[sourceMessages.length - 1];
    targetConv.lastMessageAt = lastMsg.occurredAt || lastMsg.createdAt;
    await targetConv.save();
  }

  if (closeSource) {
    sourceConv.status = 'closed';
    sourceConv.closedAt = new Date();
    sourceConv.metadata = {
      ...(sourceConv.metadata || {}),
      transferredTo: String(targetConv._id),
      transferredToTenant: String(targetTenantId),
    };
    await sourceConv.save();
  }

  return {
    sourceConversationId: String(sourceConv._id),
    targetConversationId: String(targetConv._id),
    targetTenantId: String(targetTenantId),
    messagesCopied,
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
  replyWithTemplate,
  addNote,
  createRecordFromConversation,
  sendEmailToRecord,
  sendTemplateToRecord,
  transferToTenant,
};
