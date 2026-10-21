import mongoose from 'mongoose';
import ApprovalProcess from '../models/ApprovalProcess.js';
import ApprovalRequest from '../models/ApprovalRequest.js';
import DynamicRecord from '../models/DynamicRecord.js';
import User from '../models/User.js';
import Notification from '../models/Notification.js';
import configurationService from './configurationService.js';
import { runAutomation } from './automationService.js';
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

/**
 * Resolve who is responsible for a step. Returns { approverUserId } for named
 * approvers or { approverRoleId } for a queue (any holder may decide).
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
      const user = await User.findById(submitter).select('manager');
      if (!user?.manager) {
        throw new AppError(
          'The submitter has no manager assigned; cannot route this approval.',
          400,
        );
      }
      return { approverUserId: user.manager };
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
    default:
      throw new AppError(`Unknown approver type '${step.approverType}'.`, 400);
  }
};

/* ── Notifications ──────────────────────────────────────────────────────── */

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

const notifyStepApprover = async (tenantId, process, request, stepIndex) => {
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

  if (step.approverUserId) {
    await notifyUsers(tenantId, [step.approverUserId], payload);
  } else if (step.approverRoleId) {
    const users = await User.find({
      tenantId,
      role: step.approverRoleId,
      status: 'active',
    }).select('_id');
    await notifyUsers(
      tenantId,
      users.map((u) => u._id),
      payload,
    );
  }
};

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
  const snapshot = {};
  const snapshotFields = [];
  for (const update of submitUpdates) {
    snapshot[update.field] = record.getField(update.field) ?? null;
    snapshotFields.push(update.field);
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

  if (applyFieldUpdates(record, submitUpdates)) {
    record.lastModifiedBy = user._id;
    await record.save();
  }

  await notifyStepApprover(tenantId, process, request, 0);
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

const _authorizeDecision = (step, user, request) => {
  const userId = String(user._id);
  if (step.approverUserId && String(step.approverUserId) === userId) return true;
  if (step.approverType === 'queue' && step.approverRoleId) {
    const roleId = user.role?._id || user.role;
    if (roleId && String(roleId) === String(step.approverRoleId)) return true;
  }
  return false;
};

const decide = async ({ tenantId, requestId, user, decision, comment = '' }) => {
  const request = await ApprovalRequest.findOne({ _id: requestId, tenantId });
  if (!request) throw new AppError('Approval request not found.', 404);
  if (request.status !== 'pending') {
    throw new AppError('This approval request is no longer pending.', 400);
  }

  const process = await _loadProcess(request);
  const index = request.currentStep;
  const step = request.steps[index];
  if (!_authorizeDecision(step, user, request)) {
    throw new AppError('You are not the approver for the current step.', 403);
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
    if (process.actions?.onReject?.unlockRecord !== false) request.locked = false;
    if (record) {
      record.lastModifiedBy = user._id;
      await record.save();
    }
    await request.save();
    await notifySubmitter(tenantId, process, request, 'rejected', comment);
    await launchStageFlow('onReject', process, request, record, 'rejected', comment);
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
    await request.save();
    await notifyStepApprover(tenantId, process, request, nextIndex);
    return request;
  }

  // Final approval
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
  if (process.actions?.onApprove?.unlockRecord !== false) request.locked = false;
  if (record) {
    record.lastModifiedBy = user._id;
    await record.save();
  }
  await request.save();
  await notifySubmitter(tenantId, process, request, 'approved', comment);
  await launchStageFlow('onApprove', process, request, record, 'approved', comment);
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
    .populate('steps.decidedBy', 'firstName lastName')
    .populate('history.by', 'firstName lastName')
    .lean();

  const userId = String(user._id);
  const roleId = String(user.role?._id || user.role || '');
  const idOf = (ref) => String(ref?._id || ref || '');

  let canDecide = false;
  let canRecall = false;
  if (request?.status === 'pending') {
    const step = request.steps?.[request.currentStep];
    canDecide = Boolean(
      step &&
        ((step.approverUserId && idOf(step.approverUserId) === userId) ||
          (step.approverType === 'queue' && step.approverRoleId && idOf(step.approverRoleId) === roleId)),
    );
    canRecall = idOf(request.submittedBy) === userId;
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
      const candidates = await ApprovalProcess.find({ tenantId, objectApiName, active: true })
        .sort({ createdAt: 1 })
        .select('name description entryCriteria');
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
  return ApprovalRequest.find({ tenantId, status: 'pending', $or: or })
    .sort({ createdAt: -1 })
    .lean();
};

export default {
  evaluateEntryCriteria,
  resolveApprover,
  isRecordLocked,
  submit,
  decide,
  recall,
  getState,
  describeRecordState,
  listPendingForUser,
};
