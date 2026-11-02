import mongoose from 'mongoose';
import ApprovalProcess from '../models/ApprovalProcess.js';
import ApprovalRequest from '../models/ApprovalRequest.js';
import DynamicRecord from '../models/DynamicRecord.js';
import User from '../models/User.js';
import Role from '../models/Role.js';
import ObjectMeta from '../models/ObjectMeta.js';
import ApproverGroup from '../models/ApproverGroup.js';
import Notification from '../models/Notification.js';
import configurationService from './configurationService.js';
import { runAutomation } from './automationService.js';
import { evaluateFormula, configKeysIn } from './formulaParser.js';
import { queueMail, approvalEmailHtml, escapeHtml } from './mailer.js';
import leadApprovalService from './leadApprovalService.js';
import { AppError } from '../utils/errors.js';
import logger from '../utils/logger.js';

/* ── Entry-criteria evaluation ──────────────────────────────────────────── */

const toComparable = (v) => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.getTime();
  return v;
};

const looseEquals = (a, b) => {
  const na = toComparable(a);
  const nb = toComparable(b);
  if (na === null && nb === null) return true;
  if (na === null || nb === null) return false;
  return String(na) === String(nb);
};

const toNumber = (v) => {
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
};

const compare = (actual, operator, expected) => {
  switch (operator) {
    case 'not_equals':
      return !looseEquals(actual, expected);
    case 'greater_than': {
      const a = toNumber(actual);
      const b = toNumber(expected);
      return a !== null && b !== null && a > b;
    }
    case 'less_than': {
      const a = toNumber(actual);
      const b = toNumber(expected);
      return a !== null && b !== null && a < b;
    }
    case 'greater_or_equal': {
      const a = toNumber(actual);
      const b = toNumber(expected);
      return a !== null && b !== null && a >= b;
    }
    case 'less_or_equal': {
      const a = toNumber(actual);
      const b = toNumber(expected);
      return a !== null && b !== null && a <= b;
    }
    case 'contains':
      return String(actual ?? '')
        .toLowerCase()
        .includes(String(expected ?? '').toLowerCase());
    case 'is_empty':
      return actual === null || actual === undefined || actual === '';
    case 'is_not_empty':
      return !(actual === null || actual === undefined || actual === '');
    case 'equals':
    default:
      return looseEquals(actual, expected);
  }
};

/**
 * True when the record satisfies the process entry criteria (AND/OR across
 * conditions). An empty rule list matches every record. `tenantConfig`
 * condition values are resolved through the TenantConfiguration layer.
 */
const evaluateEntryCriteria = async (process, record, tenantId) => {
  // Entry Criteria is a true/false formula (BRD §8) — same language as
  // validation rules, including CONFIG("key") for tenant thresholds. A formula
  // that can't be evaluated counts as not met, so a broken one never lets
  // every record into an approval.
  const expression = String(process.entryCondition || '').trim();
  if (expression) {
    try {
      const keys = configKeysIn(expression);
      const __config = keys.length ? await configurationService.resolveMany(keys, tenantId) : {};
      return Boolean(evaluateFormula(expression, { ...record.toDataObject(), __config }));
    } catch (err) {
      logger.warn(`Approval process "${process.name}": entry criteria could not be evaluated: ${err.message}`);
      return false;
    }
  }

  // Older processes: a list of conditions.
  const conditions = process.entryCriteria?.conditions || [];
  if (conditions.length === 0) return true;

  const data = record.toDataObject();
  const results = [];
  for (const cond of conditions) {
    let expected = cond.value;
    if (cond.valueType === 'tenantConfig') {
      expected = await configurationService.resolve(cond.value, tenantId);
    }
    results.push(compare(data[cond.field], cond.operator, expected));
  }
  return process.entryCriteria.logic === 'OR'
    ? results.some(Boolean)
    : results.every(Boolean);
};

/* ── Approver determination ─────────────────────────────────────────────── */

const idOf = (ref) => String(ref?._id || ref || '');

/**
 * A user's manager (BRD §8, "via role hierarchy"): the manager assigned to
 * them, or failing that anyone holding the nearest role above theirs in the
 * role hierarchy that actually has users. Returns { approverUserId } or
 * { approverRoleId }, or null when neither exists.
 */
const resolveManagerOf = async (tenantId, userId) => {
  if (!userId) return null;
  const user = await User.findOne({ _id: userId, tenantId }).select('manager role');
  if (!user) return null;
  if (user.manager) return { approverUserId: user.manager };

  let role = user.role ? await Role.findOne({ _id: user.role, tenantId }).select('parentRole') : null;
  for (let depth = 0; role?.parentRole && depth < 10; depth++) {
    const parent = await Role.findOne({ _id: role.parentRole, tenantId }).select('parentRole');
    if (!parent) return null;
    const holders = await User.countDocuments({ tenantId, role: parent._id, status: 'active', _id: { $ne: userId } });
    if (holders > 0) return { approverRoleId: parent._id };
    role = parent;
  }
  return null;
};

/**
 * Resolve who is responsible for a step. Returns { approverUserId } for a
 * named person, { approverRoleId } for a role (anyone holding it may decide) or
 * { approverGroupId } for a public group.
 */
const resolveApprover = async (step, { tenantId, record, submitter }) => {
  switch (step.approverType) {
    case 'user': {
      if (!step.approverUserId) {
        throw new AppError('Approval step has no named approver.', 400);
      }
      return { approverUserId: step.approverUserId };
    }
    case 'manager': {
      // The record owner's manager (or the submitter's, if the step says so).
      // When the owner has neither a manager nor a role above them, fall back
      // to the submitter's, so a record owned by someone outside the hierarchy
      // can still be routed.
      const owner = step.managerOf === 'submitter' ? submitter : record?.ownerId || submitter;
      const found =
        (await resolveManagerOf(tenantId, owner)) ||
        (idOf(owner) !== idOf(submitter) ? await resolveManagerOf(tenantId, submitter) : null);
      if (!found) {
        throw new AppError(
          'No manager could be found for this record. Ask your administrator to assign a manager to the record owner (or to put a role above theirs in the role hierarchy) before submitting.',
          400,
        );
      }
      return found;
    }
    case 'field': {
      const value = record.getField(step.approverFieldApiName);
      if (!value || !mongoose.isValidObjectId(value)) {
        throw new AppError(
          `Approver field '${step.approverFieldApiName}' is empty on the record.`,
          400,
        );
      }
      return { approverUserId: value };
    }
    case 'queue': {
      if (!step.approverRoleId) {
        throw new AppError('Approval step has no approver queue (role).', 400);
      }
      return { approverRoleId: step.approverRoleId };
    }
    case 'group': {
      if (!step.approverGroupId) {
        throw new AppError('Approval step has no approver group.', 400);
      }
      const group = await ApproverGroup.exists({ _id: step.approverGroupId, tenantId });
      if (!group) throw new AppError('The approver group for this step no longer exists.', 400);
      return { approverGroupId: step.approverGroupId };
    }
    default:
      throw new AppError(`Unknown approver type '${step.approverType}'.`, 400);
  }
};

/**
 * May `user` decide this step? A named approver; a holder of the step's role
 * (a queue, or the role above the owner in the hierarchy); or a member of the
 * step's public group — listed directly or holding one of its roles.
 */
const userCanDecide = async (step, user) => {
  if (!step || !user) return false;
  const userId = String(user._id);
  const roleId = idOf(user.role);
  if (step.approverUserId && idOf(step.approverUserId) === userId) return true;
  if (step.approverRoleId && roleId && idOf(step.approverRoleId) === roleId) return true;
  if (step.approverGroupId) {
    const group = await ApproverGroup.findById(idOf(step.approverGroupId)).select('memberIds roleIds').lean();
    if (group) {
      if ((group.memberIds || []).some((m) => String(m) === userId)) return true;
      if (roleId && (group.roleIds || []).some((r) => String(r) === roleId)) return true;
    }
  }
  return false;
};

/** Active users who may decide a step — for notifications. */
const stepApproverIds = async (tenantId, step) => {
  const ids = new Set();
  if (step.approverUserId) ids.add(idOf(step.approverUserId));
  const roleIds = [];
  if (step.approverRoleId) roleIds.push(step.approverRoleId);
  if (step.approverGroupId) {
    const group = await ApproverGroup.findById(idOf(step.approverGroupId)).select('memberIds roleIds').lean();
    (group?.memberIds || []).forEach((m) => ids.add(String(m)));
    roleIds.push(...(group?.roleIds || []));
  }
  if (roleIds.length) {
    const holders = await User.find({ tenantId, role: { $in: roleIds }, status: 'active' }).select('_id').lean();
    holders.forEach((u) => ids.add(String(u._id)));
  }
  return [...ids];
};

/* ── Notifications ──────────────────────────────────────────────────────── */

const appUrl = () => process.env.APP_URL || 'http://localhost:3000';

const notifyUsers = async (tenantId, userIds, { title, body, link, data }) => {
  const unique = [...new Set(userIds.filter(Boolean).map((id) => String(id)))];
  if (unique.length === 0) return;
  const recordLink = link || undefined;
  await Promise.all(
    unique.map((userId) =>
      Notification.create({
        tenantId,
        userId,
        type: 'custom',
        title,
        body,
        link: recordLink,
        icon: 'ClipboardCheck',
        data,
      }).catch((err) => {
        logger.warn(`Approval notification failed: ${err.message}`);
      }),
    ),
  );
};

/** What the emails call the record: its name, else a sensible fallback. */
const describeRecord = async (tenantId, record) => {
  const obj = await ObjectMeta.findOne({ tenantId, apiName: record?.objectApiName }).select('nameFieldApiName label').lean();
  const title =
    record?.getField?.(obj?.nameFieldApiName || 'name') ||
    record?.getField?.('title') ||
    record?.getField?.('first_name') ||
    obj?.label ||
    'Record';
  return { title: String(title), label: obj?.label || record?.objectApiName || 'record' };
};

// Records an approval can leave behind a link to (e.g. the Deal a Lead became).
const RELATED_LINK_FIELDS = [
  { field: 'related_deal_id', objectApiName: 'deal', label: 'View Deal' },
  { field: 'converted_order', objectApiName: 'order', label: 'View Order' },
];

const emailUsers = async (tenantId, userIds, build) => {
  const users = await User.find({ _id: { $in: userIds }, tenantId, status: 'active' })
    .select('firstName email')
    .lean();
  await Promise.all(
    users
      .filter((u) => u.email)
      .map((u) => {
        const { subject, html } = build(u);
        return queueMail(u.email, subject, html);
      }),
  );
};

const userName = async (userId) => {
  const u = userId ? await User.findById(userId).select('firstName lastName').lean() : null;
  return u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() : 'Someone';
};

/** Tell whoever must decide the step: in-app, and by email unless switched off. */
const notifyStepApprover = async (tenantId, process, request, stepIndex, record = null) => {
  const step = request.steps[stepIndex];
  const link = `/o/${request.objectApiName}/${request.recordId}`;
  const payload = {
    title: `Approval required: ${request.processName}`,
    body: `A ${request.objectApiName} record is awaiting your decision${
      step.name ? ` (${step.name})` : ''
    }.`,
    link,
    data: {
      approvalRequestId: String(request._id),
      objectApiName: request.objectApiName,
      recordId: String(request.recordId),
    },
  };

  const approverIds = await stepApproverIds(tenantId, step);
  await notifyUsers(tenantId, approverIds, payload);

  if (process.actions?.onSubmit?.notifyByEmail !== false && record) {
    const { title, label } = await describeRecord(tenantId, record);
    const submitter = await userName(request.submittedBy);
    await emailUsers(tenantId, approverIds, (u) => ({
      subject: `${label} Approval Request: ${title}`,
      html: approvalEmailHtml({
        heading: `${label} Approval Request`,
        greeting: `Hello ${u.firstName || 'there'},`,
        paragraphs: [
          `${escapeHtml(submitter)} has submitted the following ${escapeHtml(label.toLowerCase())} for your approval${step.name ? ` (${escapeHtml(step.name)})` : ''}:`,
          `<strong>${escapeHtml(title)}</strong>`,
          `Please review the details and approve or reject it.`,
        ],
        buttons: [{ label: `Review ${label}`, url: `${appUrl()}${link}` }],
      }),
    }));
  }
};

/**
 * Tell the submitter the outcome: in-app straight away; by email (unless
 * switched off) once any follow-up has run, so the email can link to what the
 * approval produced — e.g. the Deal a Lead was converted to.
 */
const notifySubmitter = async (tenantId, process, request, outcome, comment) => {
  await notifyUsers(tenantId, [request.submittedBy], {
    title: `Approval ${outcome}: ${request.processName}`,
    body: `Your ${request.objectApiName} record was ${outcome}.${
      comment ? ` Comment: ${comment}` : ''
    }`,
    link: `/o/${request.objectApiName}/${request.recordId}`,
    data: {
      approvalRequestId: String(request._id),
      objectApiName: request.objectApiName,
      recordId: String(request.recordId),
    },
  });
};

const emailSubmitter = async (tenantId, process, request, outcome, comment, deciderId) => {
  const stage = outcome === 'approved' ? 'onApprove' : 'onReject';
  if (process.actions?.[stage]?.notifyByEmail === false) return;
  const record = await DynamicRecord.findOne({
    _id: request.recordId,
    tenantId,
    objectApiName: request.objectApiName,
  });
  if (!record) return;
  const { title, label } = await describeRecord(tenantId, record);
  const decider = await userName(deciderId);
  const recordLink = `/o/${request.objectApiName}/${request.recordId}`;
  const buttons = [{ label: `View ${label}`, url: `${appUrl()}${recordLink}` }];
  if (outcome === 'approved') {
    for (const rel of RELATED_LINK_FIELDS) {
      const target = record.getField(rel.field);
      if (target && mongoose.isValidObjectId(String(target))) {
        buttons.unshift({ label: rel.label, url: `${appUrl()}/o/${rel.objectApiName}/${target}` });
      }
    }
  }
  const approved = outcome === 'approved';
  await emailUsers(tenantId, [request.submittedBy], (u) => ({
    subject: `${label} ${approved ? 'Approved' : 'Rejected'}: ${title}`,
    html: approvalEmailHtml({
      heading: `${label} ${approved ? 'Approved' : 'Rejected'}`,
      color: approved ? '#27ae60' : '#c0392b',
      greeting: `Hello ${u.firstName || 'there'},`,
      paragraphs: [
        `Your ${escapeHtml(label.toLowerCase())} <strong>"${escapeHtml(title)}"</strong> has been ${approved ? 'approved' : 'rejected'} by ${escapeHtml(decider)}.`,
        ...(approved && buttons.length > 1 ? ['You can now view the record it created.'] : []),
      ],
      reason: approved ? '' : comment,
      buttons,
    }),
  }));
};

/* ── Helpers ────────────────────────────────────────────────────────────── */

const sortedSteps = (process) =>
  [...process.steps].sort((a, b) => a.order - b.order);

const applyFieldUpdates = (record, updates) => {
  if (!record || !Array.isArray(updates)) return false;
  let changed = false;
  for (const update of updates) {
    if (!update?.field) continue;
    record.setField(update.field, update.value);
    changed = true;
  }
  return changed;
};

/**
 * Launch the flow configured on an approval stage, if any. Runs after the
 * decision is saved and never throws, so a failing flow cannot undo it.
 */
const launchStageFlow = async (stage, process, request, record, outcome, comment = '') => {
  const flowId = process.actions?.[stage]?.flowId;
  if (!flowId || !record) return;
  await runAutomation(flowId, record, request.tenantId, {
    approvalOutcome: outcome,
    approvalComment: comment || '',
    approvalProcessName: process.name,
    approvalRequestId: String(request._id),
  });
};

/**
 * Final-approval platform action (BRD §8: "optionally trigger a Flow (e.g. the
 * existing Lead-to-Deal conversion)"). Runs before the approval is saved, so a
 * failed conversion leaves the request pending rather than approved.
 */
const runPlatformAction = async (action, { tenantId, record, user, options = {} }) => {
  if (!action || action.platformAction !== 'convert_lead_to_deal' || !record) return;
  if (record.objectApiName !== 'lead') {
    throw new AppError('"Convert lead to deal" only applies to leads.', 400);
  }
  const approver = await User.findById(user._id).select('firstName lastName email');
  let deal;
  try {
    deal = await leadApprovalService.convertLeadToDeal(tenantId, record, approver, options.clientId || null, null);
  } catch (err) {
    throw new AppError(`The lead could not be converted to a deal: ${err.message}`, 400);
  }
  record.setField('is_converted', true);
  record.setField('related_deal_id', deal._id);
};

// Record who has been asked to approve, when the process says where to put it.
const writeApproverField = (record, action, resolved) => {
  if (!record || !action?.approverField) return false;
  record.setField(action.approverField, resolved?.approverUserId || null);
  return true;
};

const stepDefinitionFor = (process, order) =>
  (process?.steps || []).find((s) => s.order === order);

/**
 * True when the record is currently locked by a pending approval. Used by the
 * record controller to block edits/deletes while an approval is in flight.
 */
const isRecordLocked = async (tenantId, objectApiName, recordId) => {
  const lock = await ApprovalRequest.findOne({
    tenantId,
    objectApiName,
    recordId,
    status: 'pending',
    locked: true,
  })
    .select('_id')
    .lean();
  return Boolean(lock);
};

/* ── Runtime operations ─────────────────────────────────────────────────── */

/**
 * Submit a record into an approval process. When `processId` is omitted the
 * first active process for the object whose entry criteria match is used; if
 * none match, returns null (the caller treats it as "no approval required").
 */
const submit = async ({ tenantId, objectApiName, recordId, processId, user }) => {
  const record = await DynamicRecord.findOne({
    _id: recordId,
    tenantId,
    objectApiName,
    isDeleted: false,
  });
  if (!record) throw new AppError('Record not found.', 404);

  const existing = await ApprovalRequest.findOne({
    tenantId,
    objectApiName,
    recordId,
    status: 'pending',
  });
  if (existing) {
    throw new AppError('This record is already awaiting approval.', 400);
  }

  let process = null;
  if (processId) {
    process = await ApprovalProcess.findOne({
      _id: processId,
      tenantId,
      active: true,
    });
    if (!process) throw new AppError('Approval process not found.', 404);
    if (process.objectApiName !== objectApiName) {
      throw new AppError('This process does not apply to the record type.', 400);
    }
    if (!(await evaluateEntryCriteria(process, record, tenantId))) {
      throw new AppError('Record does not meet the process entry criteria.', 400);
    }
  } else {
    const candidates = await ApprovalProcess.find({
      tenantId,
      objectApiName,
      active: true,
    }).sort({ createdAt: 1 });
    for (const candidate of candidates) {
      if (await evaluateEntryCriteria(candidate, record, tenantId)) {
        process = candidate;
        break;
      }
    }
  }
  if (!process) return null;

  const steps = sortedSteps(process);
  const firstStep = steps[0];
  const resolved = await resolveApprover(firstStep, {
    tenantId,
    record,
    submitter: user._id,
  });

  // Snapshot the values the submit action overwrites, so recall can restore them.
  const submitUpdates = process.actions?.onSubmit?.fieldUpdates || [];
  const approverField = process.actions?.onSubmit?.approverField || '';
  const snapshot = {};
  const snapshotFields = [];
  for (const field of [...submitUpdates.map((u) => u.field), ...(approverField ? [approverField] : [])]) {
    if (snapshotFields.includes(field)) continue;
    snapshot[field] = record.getField(field) ?? null;
    snapshotFields.push(field);
  }

  const request = await ApprovalRequest.create({
    tenantId,
    processId: process._id,
    processName: process.name,
    objectApiName,
    recordId: record._id,
    status: 'pending',
    currentStep: 0,
    locked: Boolean(process.actions?.onSubmit?.lockRecord),
    submittedBy: user._id,
    submittedAt: new Date(),
    steps: steps.map((step, index) => ({
      order: step.order,
      name: step.name,
      approverType: step.approverType,
      status: index === 0 ? 'pending' : 'waiting',
      ...(index === 0 ? resolved : {}),
    })),
    history: [
      { action: 'submitted', step: 0, by: user._id, at: new Date() },
    ],
    snapshot,
    snapshotFields,
  });

  const changedFields = applyFieldUpdates(record, submitUpdates);
  const wroteApprover = writeApproverField(record, process.actions?.onSubmit, resolved);
  if (changedFields || wroteApprover) {
    record.lastModifiedBy = user._id;
    await record.save();
  }

  await notifyStepApprover(tenantId, process, request, 0, record);
  await launchStageFlow('onSubmit', process, request, record, 'submitted');
  return request;
};

const _loadProcess = async (request) => {
  const process = await ApprovalProcess.findOne({
    _id: request.processId,
    tenantId: request.tenantId,
  });
  if (!process) {
    throw new AppError('The approval process for this request no longer exists.', 400);
  }
  return process;
};

const decide = async ({ tenantId, requestId, user, decision, comment = '', options = {} }) => {
  const request = await ApprovalRequest.findOne({ _id: requestId, tenantId });
  if (!request) throw new AppError('Approval request not found.', 404);
  if (request.status !== 'pending') {
    throw new AppError('This approval request is no longer pending.', 400);
  }

  const process = await _loadProcess(request);
  const index = request.currentStep;
  const step = request.steps[index];
  if (!(await userCanDecide(step, user))) {
    throw new AppError('You are not the approver for the current step.', 403);
  }
  // BRD §8: a process may require a reason for every rejection.
  if (
    decision === 'reject' &&
    process.actions?.onReject?.captureReason !== false &&
    !String(comment || '').trim()
  ) {
    throw new AppError('A reason is required to reject this request.', 400);
  }

  const now = new Date();
  const record = await DynamicRecord.findOne({
    _id: request.recordId,
    tenantId: request.tenantId,
    objectApiName: request.objectApiName,
  });

  step.decidedBy = user._id;
  step.decidedAt = now;
  step.comment = comment;

  if (decision === 'reject') {
    step.status = 'rejected';
    request.status = 'rejected';
    request.decidedBy = user._id;
    request.decidedAt = now;
    request.history.push({
      action: 'rejected',
      step: index,
      by: user._id,
      at: now,
      comment,
    });
    applyFieldUpdates(record, process.actions?.onReject?.fieldUpdates);
    if (record && process.actions?.onReject?.reasonField && comment) {
      record.setField(process.actions.onReject.reasonField, comment);
    }
    if (process.actions?.onReject?.unlockRecord !== false) request.locked = false;
    if (record) {
      record.lastModifiedBy = user._id;
      await record.save();
    }
    await request.save();
    await notifySubmitter(tenantId, process, request, 'rejected', comment);
    await launchStageFlow('onReject', process, request, record, 'rejected', comment);
    await emailSubmitter(tenantId, process, request, 'rejected', comment, user._id);
    return request;
  }

  // Approve the current step
  step.status = 'approved';
  request.history.push({
    action: 'approved_step',
    step: index,
    by: user._id,
    at: now,
    comment,
  });

  const nextIndex = index + 1;
  if (nextIndex < request.steps.length) {
    const nextState = request.steps[nextIndex];
    const def = stepDefinitionFor(process, nextState.order) || {
      approverType: nextState.approverType,
    };
    const resolved = await resolveApprover(def, {
      tenantId,
      record,
      submitter: request.submittedBy,
    });
    Object.assign(nextState, resolved, { status: 'pending' });
    request.currentStep = nextIndex;
    if (record && writeApproverField(record, process.actions?.onSubmit, resolved)) {
      await record.save();
    }
    await request.save();
    await notifyStepApprover(tenantId, process, request, nextIndex, record);
    return request;
  }

  // Final approval. The platform action (e.g. Lead → Deal) runs first: if it
  // fails the request stays pending, nothing is half-approved.
  await runPlatformAction(process.actions?.onApprove, { tenantId, record, user, options });
  request.status = 'approved';
  request.decidedBy = user._id;
  request.decidedAt = now;
  request.history.push({
    action: 'approved',
    step: index,
    by: user._id,
    at: now,
    comment,
  });
  applyFieldUpdates(record, process.actions?.onApprove?.fieldUpdates);
  if (record && process.actions?.onApprove?.reasonField && comment) {
    record.setField(process.actions.onApprove.reasonField, comment);
  }
  if (process.actions?.onApprove?.unlockRecord !== false) request.locked = false;
  if (record) {
    record.lastModifiedBy = user._id;
    await record.save();
  }
  await request.save();
  await notifySubmitter(tenantId, process, request, 'approved', comment);
  await launchStageFlow('onApprove', process, request, record, 'approved', comment);
  await emailSubmitter(tenantId, process, request, 'approved', comment, user._id);
  return request;
};

const recall = async ({ tenantId, requestId, user }) => {
  const request = await ApprovalRequest.findOne({ _id: requestId, tenantId });
  if (!request) throw new AppError('Approval request not found.', 404);
  if (request.status !== 'pending') {
    throw new AppError('Only a pending request can be recalled.', 400);
  }
  if (String(request.submittedBy) !== String(user._id)) {
    throw new AppError('Only the submitter can recall this request.', 403);
  }

  const record = await DynamicRecord.findOne({
    _id: request.recordId,
    tenantId,
    objectApiName: request.objectApiName,
  });

  if (record) {
    for (const field of request.snapshotFields || []) {
      record.setField(field, request.snapshot?.[field] ?? null);
    }
    record.lastModifiedBy = user._id;
    await record.save();
  }

  request.status = 'recalled';
  request.locked = false;
  request.history.push({
    action: 'recalled',
    step: request.currentStep,
    by: user._id,
    at: new Date(),
  });
  await request.save();
  return request;
};

const getState = async ({ tenantId, objectApiName, recordId }) => {
  return ApprovalRequest.findOne({ tenantId, objectApiName, recordId })
    .sort({ createdAt: -1 })
    .lean();
};

/**
 * Everything a record page needs to render its approval panel: the latest
 * request (with people resolved to names), what the current user may do,
 * and which processes the record could be submitted to right now.
 */
const describeRecordState = async ({ tenantId, objectApiName, recordId, user }) => {
  const request = await ApprovalRequest.findOne({ tenantId, objectApiName, recordId })
    .sort({ createdAt: -1 })
    .populate('submittedBy', 'firstName lastName')
    .populate('decidedBy', 'firstName lastName')
    .populate('steps.approverUserId', 'firstName lastName')
    .populate('steps.approverRoleId', 'name label')
    .populate('steps.approverGroupId', 'name label')
    .populate('steps.decidedBy', 'firstName lastName')
    .populate('history.by', 'firstName lastName')
    .lean();

  const userId = String(user._id);

  let canDecide = false;
  let canRecall = false;
  if (request?.status === 'pending') {
    canDecide = await userCanDecide(request.steps?.[request.currentStep], user);
    canRecall = idOf(request.submittedBy) === userId;
    // Built-in processes (Lead Approval) are decided with the object's own
    // buttons — e.g. choosing the client when a lead becomes a deal.
    const owning = await ApprovalProcess.findById(request.processId).select('systemKey').lean();
    if (owning?.systemKey) canDecide = false;
  }

  let eligibleProcesses = [];
  if (request?.status !== 'pending') {
    const record = await DynamicRecord.findOne({
      _id: recordId,
      tenantId,
      objectApiName,
      isDeleted: false,
    });
    if (record) {
      // Built-in processes are submitted with the object's own buttons.
      const candidates = await ApprovalProcess.find({
        tenantId,
        objectApiName,
        active: true,
        systemKey: { $in: ['', null] },
      })
        .sort({ createdAt: 1 })
        .select('name description entryCriteria entryCondition');
      for (const candidate of candidates) {
        if (await evaluateEntryCriteria(candidate, record, tenantId)) {
          eligibleProcesses.push({ _id: candidate._id, name: candidate.name });
        }
      }
    }
  }

  return {
    request,
    canDecide,
    canRecall,
    canSubmit: eligibleProcesses.length > 0,
    eligibleProcesses,
  };
};

const listPendingForUser = async ({ tenantId, user }) => {
  const roleId = user.role?._id || user.role;
  // Match only the active step: earlier steps keep their approver after
  // being decided, so a plain `steps.approverUserId` match would keep a
  // request in a past approver's queue.
  const or = [{ steps: { $elemMatch: { status: 'pending', approverUserId: user._id } } }];
  if (roleId) {
    or.push({ steps: { $elemMatch: { status: 'pending', approverRoleId: roleId } } });
  }
  // Steps assigned to a public group the user belongs to — directly or by role.
  const groups = await ApproverGroup.find({
    tenantId,
    $or: [{ memberIds: user._id }, ...(roleId ? [{ roleIds: roleId }] : [])],
  })
    .select('_id')
    .lean();
  if (groups.length) {
    or.push({ steps: { $elemMatch: { status: 'pending', approverGroupId: { $in: groups.map((g) => g._id) } } } });
  }
  return ApprovalRequest.find({ tenantId, status: 'pending', $or: or })
    .sort({ createdAt: -1 })
    .lean();
};

/* ── Lead approval as a process ─────────────────────────────────────────── */

/**
 * Today's Lead-to-Deal approval, expressed as an ordinary one-step process
 * (BRD §8). Seeded for every tenant that has the Lead object; the Lead buttons
 * run through it. It can be edited or switched off, but not deleted.
 */
const LEAD_APPROVAL_PROCESS = {
  systemKey: 'lead_approval',
  name: 'Lead Approval',
  description: "A lead's owner's manager approves it, and the lead is converted to a deal.",
  objectApiName: 'lead',
  steps: [{ order: 1, name: 'Manager approval', approverType: 'manager', managerOf: 'owner' }],
  actions: {
    onSubmit: {
      fieldUpdates: [{ field: 'approval_status', value: 'Submitted for Approval' }],
      approverField: 'assigned_approver',
      lockRecord: false,
      notifyByEmail: true,
    },
    onApprove: {
      fieldUpdates: [{ field: 'approval_status', value: 'Approved' }],
      platformAction: 'convert_lead_to_deal',
      unlockRecord: true,
      notifyByEmail: true,
    },
    onReject: {
      fieldUpdates: [{ field: 'approval_status', value: 'Rejected' }],
      reasonField: 'rejection_reason',
      captureReason: false, // the reason is optional for leads, as before
      unlockRecord: true,
      notifyByEmail: true,
    },
  },
};

/** Create the Lead approval process for a tenant if it has none. Returns true when added. */
const ensureLeadApprovalProcess = async (tenantId) => {
  if (await ApprovalProcess.exists({ tenantId, systemKey: LEAD_APPROVAL_PROCESS.systemKey })) return false;
  if (!(await ObjectMeta.exists({ tenantId, apiName: 'lead' }))) return false;
  await ApprovalProcess.create({ ...LEAD_APPROVAL_PROCESS, tenantId, active: true });
  logger.info(`Added the Lead Approval process for tenant ${tenantId}.`);
  return true;
};

const ensureLeadApprovalProcesses = async () => {
  const tenantIds = await ObjectMeta.distinct('tenantId', { apiName: 'lead' });
  let added = 0;
  for (const tenantId of tenantIds) if (await ensureLeadApprovalProcess(tenantId)) added++;
  return added;
};

export default {
  evaluateEntryCriteria,
  userCanDecide,
  resolveManagerOf,
  ensureLeadApprovalProcess,
  ensureLeadApprovalProcesses,
  LEAD_APPROVAL_PROCESS,
  resolveApprover,
  isRecordLocked,
  submit,
  decide,
  recall,
  getState,
  describeRecordState,
  listPendingForUser,
};
