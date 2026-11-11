import inboxService from '../services/inboxService.js';
import { audit } from '../utils/auditLogger.js';
import { asyncHandler, sendSuccess, AppError } from '../utils/errors.js';

const listConversations = asyncHandler(async (req, res) => {
  const result = await inboxService.listConversations({
    tenantId: req.tenantId,
    userId: req.user._id,
    assignedToMe: req.query.assignedToMe,
    assigned: req.query.assigned,
    status: req.query.status,
    channel: req.query.channel,
    isUnread: req.query.isUnread,
    limit: req.query.limit,
    skip: req.query.skip,
  });
  sendSuccess(res, {
    data: result.items,
    meta: { total: result.total, limit: result.limit, skip: result.skip },
  });
});

const getConversation = asyncHandler(async (req, res) => {
  const conversation = await inboxService.getConversation({
    tenantId: req.tenantId,
    id: req.params.id,
  });
  sendSuccess(res, { data: conversation });
});

const listMessages = asyncHandler(async (req, res) => {
  const result = await inboxService.listMessages({
    tenantId: req.tenantId,
    conversationId: req.params.id,
    limit: req.query.limit,
    skip: req.query.skip,
  });
  sendSuccess(res, {
    data: result.items,
    meta: { total: result.total, limit: result.limit, skip: result.skip },
  });
});

// Accept (assign to self) or transfer (assign to another user).
const assignConversation = asyncHandler(async (req, res) => {
  const { userId } = req.body || {};
  const target = userId === undefined ? req.user._id : userId;
  const conversation = await inboxService.assignConversation({
    tenantId: req.tenantId,
    id: req.params.id,
    userId: target,
  });
  sendSuccess(res, { data: conversation }, 'Conversation assigned');
});

const setStatus = asyncHandler(async (req, res) => {
  const { status } = req.body || {};
  if (!['open', 'pending', 'closed'].includes(status)) {
    throw new AppError('status must be open, pending or closed.', 400);
  }
  const conversation = await inboxService.setStatus({
    tenantId: req.tenantId,
    id: req.params.id,
    status,
  });
  sendSuccess(res, { data: conversation }, 'Conversation status updated');
});

const linkRecord = asyncHandler(async (req, res) => {
  const { objectApiName, recordId } = req.body || {};
  const conversation = await inboxService.linkRecord({
    tenantId: req.tenantId,
    id: req.params.id,
    objectApiName,
    recordId,
  });
  sendSuccess(res, { data: conversation }, 'Conversation record updated');
});

const reply = asyncHandler(async (req, res) => {
  const { body, attachments } = req.body || {};
  const message = await inboxService.reply({
    tenantId: req.tenantId,
    id: req.params.id,
    body,
    attachments,
    user: req.user,
  });
  sendSuccess(res, { data: message }, 'Reply queued', 201);
});

const replyWithTemplate = asyncHandler(async (req, res) => {
  const { templateId, values } = req.body || {};
  if (!templateId) throw new AppError('templateId is required.', 400);
  const message = await inboxService.replyWithTemplate({
    tenantId: req.tenantId,
    id: req.params.id,
    templateId,
    extraValues: values || {},
    user: req.user,
  });
  sendSuccess(res, { data: message }, 'Template reply queued', 201);
});

const addNote = asyncHandler(async (req, res) => {
  const message = await inboxService.addNote({
    tenantId: req.tenantId,
    id: req.params.id,
    body: req.body?.body,
    user: req.user,
  });
  sendSuccess(res, { data: message }, 'Note added', 201);
});

const createRecordFromConversation = asyncHandler(async (req, res) => {
  try {
    const result = await inboxService.createRecordFromConversation({
      tenantId: req.tenantId,
      id: req.params.id,
      objectApiName: req.body?.objectApiName,
      data: req.body?.data,
      user: req.user,
    });

    await audit({
      tenantId: req.tenantId,
      userId: req.user._id,
      userEmail: req.user.email,
      action: 'create',
      resource: 'DynamicRecord',
      resourceId: result.record.id,
      objectApiName: result.objectApiName,
      req,
      details: { conversationId: result.conversationId },
    });

    sendSuccess(res, { data: result }, 'Record created from conversation', 201);
  } catch (err) {
    // Duplicate rules can block creation; surface the matches like the record
    // API does so the client can offer "use existing" instead.
    if (Array.isArray(err.duplicates)) {
      return res.status(409).json({
        success: false,
        message: err.message,
        duplicates: err.duplicates,
      });
    }
    throw err;
  }
});

const transferToTenant = asyncHandler(async (req, res) => {
  const { targetTenantId, closeSource = true } = req.body || {};
  if (!targetTenantId) throw new AppError('targetTenantId is required.', 400);
  const result = await inboxService.transferToTenant({
    fromTenantId: req.tenantId,
    conversationId: req.params.id,
    targetTenantId,
    closeSource,
  });
  sendSuccess(res, { data: result }, 'Conversation transferred to tenant', 201);
});

export {
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
  transferToTenant,
};
