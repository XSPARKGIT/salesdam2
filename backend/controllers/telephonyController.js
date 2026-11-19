import telephonyService from '../services/telephonyService.js';
import telephonyProviders from '../services/telephonyProviders.js';
import { redactCallRecordings } from '../services/systemPermissionService.js';
import { asyncHandler, sendSuccess } from '../utils/errors.js';

// Supported telephony providers and their (not-yet-wired) call-control scope.
const listProviders = asyncHandler(async (_req, res) => {
  sendSuccess(res, { data: telephonyProviders.listProviders() });
});

// Outbound call control seam: declines explicitly until a provider is wired.
const dial = asyncHandler(async (req, res) => {
  telephonyProviders.callControl(req.body?.provider, 'dial');
});

const getMyStatus = asyncHandler(async (req, res) => {
  const status = await telephonyService.getStatus({
    tenantId: req.tenantId,
    userId: req.user._id,
  });
  sendSuccess(res, { data: status });
});

const setMyStatus = asyncHandler(async (req, res) => {
  const status = await telephonyService.setStatus({
    tenantId: req.tenantId,
    userId: req.user._id,
    status: req.body?.status,
  });
  sendSuccess(res, { data: status }, 'Availability updated');
});

// Supervisors (admins) may see every agent's availability (§18.6).
const listStatuses = asyncHandler(async (req, res) => {
  const statuses = await telephonyService.listStatuses(req.tenantId);
  sendSuccess(res, { data: statuses });
});

const getDispositions = asyncHandler(async (req, res) => {
  const data = await telephonyService.dispositions(req.tenantId);
  sendSuccess(res, { data });
});

const wrapUp = asyncHandler(async (req, res) => {
  const activity = await telephonyService.wrapUp({
    tenantId: req.tenantId,
    activityId: req.params.activityId,
    disposition: req.body?.disposition,
    notes: req.body?.notes,
    user: req.user,
  });
  sendSuccess(res, { data: activity }, 'Call wrap-up saved');
});

const callHistory = asyncHandler(async (req, res) => {
  const result = await telephonyService.callHistory({
    tenantId: req.tenantId,
    objectApiName: req.query.objectApiName,
    recordId: req.query.recordId,
    limit: req.query.limit,
    skip: req.query.skip,
  });
  const items = await redactCallRecordings(req.user, result.items);
  sendSuccess(res, {
    data: items,
    meta: { total: result.total, limit: result.limit, skip: result.skip },
  });
});

export {
  getMyStatus,
  setMyStatus,
  listStatuses,
  getDispositions,
  wrapUp,
  callHistory,
  listProviders,
  dial,
};
