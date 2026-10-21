import ApprovalProcess from '../models/ApprovalProcess.js';
import DynamicRecord from '../models/DynamicRecord.js';
import ObjectMeta from '../models/ObjectMeta.js';
import User from '../models/User.js';
import approvalProcessService from '../services/approvalProcessService.js';
import { asyncHandler, sendSuccess, AppError } from '../utils/errors.js';

/* ── Process configuration (admin) ──────────────────────────────────────── */

const listProcesses = asyncHandler(async (req, res) => {
  const { objectApiName } = req.query;
  const filter = { tenantId: req.tenantId };
  if (objectApiName) filter.objectApiName = objectApiName;
  const processes = await ApprovalProcess.find(filter).sort({ createdAt: -1 });
  sendSuccess(res, { data: processes });
});

const getProcess = asyncHandler(async (req, res) => {
  const process = await ApprovalProcess.findOne({
    _id: req.params.id,
    tenantId: req.tenantId,
  });
  if (!process) throw new AppError('Approval process not found.', 404);
  sendSuccess(res, { data: process });
});

const createProcess = asyncHandler(async (req, res) => {
  const { name, objectApiName, steps } = req.body || {};
  if (!name || !objectApiName) {
    throw new AppError('A name and object are required.', 400);
  }
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new AppError('At least one approval step is required.', 400);
  }
  const process = await ApprovalProcess.create({
    ...req.body,
    tenantId: req.tenantId,
    createdBy: req.user._id,
  });
  sendSuccess(res, { data: process }, 'Approval process created', 201);
});

const updateProcess = asyncHandler(async (req, res) => {
  // Never let the body move a process to another tenant or rewrite its author.
  // eslint-disable-next-line no-unused-vars
  const { tenantId, createdBy, _id, ...updates } = req.body || {};
  const process = await ApprovalProcess.findOneAndUpdate(
    { _id: req.params.id, tenantId: req.tenantId },
    { $set: updates },
    { new: true, runValidators: true },
  );
  if (!process) throw new AppError('Approval process not found.', 404);
  sendSuccess(res, { data: process }, 'Approval process updated');
});

const deleteProcess = asyncHandler(async (req, res) => {
  const process = await ApprovalProcess.findOneAndDelete({
    _id: req.params.id,
    tenantId: req.tenantId,
  });
  if (!process) throw new AppError('Approval process not found.', 404);
  sendSuccess(res, {}, 'Approval process deleted');
});

/* ── Runtime ────────────────────────────────────────────────────────────── */

const submitForApproval = asyncHandler(async (req, res) => {
  const { objectApiName, recordId, processId } = req.body || {};
  if (!objectApiName || !recordId) {
    throw new AppError('objectApiName and recordId are required.', 400);
  }
  const request = await approvalProcessService.submit({
    tenantId: req.tenantId,
    objectApiName,
    recordId,
    processId,
    user: req.user,
  });
  if (!request) {
    return sendSuccess(res, { data: null }, 'No approval is required for this record.');
  }
  sendSuccess(res, { data: request }, 'Submitted for approval', 201);
});

const approveRequest = asyncHandler(async (req, res) => {
  const request = await approvalProcessService.decide({
    tenantId: req.tenantId,
    requestId: req.params.id,
    user: req.user,
    decision: 'approve',
    comment: req.body?.comment,
  });
  sendSuccess(res, { data: request }, 'Approval recorded');
});

const rejectRequest = asyncHandler(async (req, res) => {
  const request = await approvalProcessService.decide({
    tenantId: req.tenantId,
    requestId: req.params.id,
    user: req.user,
    decision: 'reject',
    comment: req.body?.comment,
  });
  sendSuccess(res, { data: request }, 'Rejection recorded');
});

const recallRequest = asyncHandler(async (req, res) => {
  const request = await approvalProcessService.recall({
    tenantId: req.tenantId,
    requestId: req.params.id,
    user: req.user,
  });
  sendSuccess(res, { data: request }, 'Approval recalled');
});

const getRecordState = asyncHandler(async (req, res) => {
  const { objectApiName, recordId } = req.query;
  if (!objectApiName || !recordId) {
    throw new AppError('objectApiName and recordId are required.', 400);
  }
  // `data` stays the latest request for existing API callers; `meta` adds
  // what the current user can do with it, for the record page.
  const state = await approvalProcessService.describeRecordState({
    tenantId: req.tenantId,
    objectApiName,
    recordId,
    user: req.user,
  });
  const { request, ...meta } = state;
  sendSuccess(res, { data: request, meta });
});

const listMyPending = asyncHandler(async (req, res) => {
  const requests = await approvalProcessService.listPendingForUser({
    tenantId: req.tenantId,
    user: req.user,
  });

  // Resolve each record's display name and the submitter, so the queue can
  // be read without opening every record.
  const objectApiNames = [...new Set(requests.map((r) => r.objectApiName))];
  const metas = await ObjectMeta.find({ tenantId: req.tenantId, apiName: { $in: objectApiNames } })
    .select('apiName label nameFieldApiName')
    .lean();
  const metaByApi = Object.fromEntries(metas.map((m) => [m.apiName, m]));
  const records = await DynamicRecord.find({
    tenantId: req.tenantId,
    _id: { $in: requests.map((r) => r.recordId) },
  });
  const recordById = new Map(records.map((r) => [String(r._id), r]));
  const submitters = await User.find({
    tenantId: req.tenantId,
    _id: { $in: requests.map((r) => r.submittedBy).filter(Boolean) },
  })
    .select('firstName lastName')
    .lean();
  const submitterById = new Map(submitters.map((u) => [String(u._id), u]));

  const data = requests.map((r) => {
    const meta = metaByApi[r.objectApiName];
    const record = recordById.get(String(r.recordId));
    const submitter = submitterById.get(String(r.submittedBy));
    return {
      ...r,
      objectLabel: meta?.label || r.objectApiName,
      recordName: record?.getField(meta?.nameFieldApiName || 'name') ?? '',
      submittedByName: submitter
        ? [submitter.firstName, submitter.lastName].filter(Boolean).join(' ')
        : '',
      currentStepName: r.steps?.[r.currentStep]?.name || '',
    };
  });
  sendSuccess(res, { data });
});

export {
  listProcesses,
  getProcess,
  createProcess,
  updateProcess,
  deleteProcess,
  submitForApproval,
  approveRequest,
  rejectRequest,
  recallRequest,
  getRecordState,
  listMyPending,
};
