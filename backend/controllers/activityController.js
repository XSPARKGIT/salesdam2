import Activity from '../models/Activity.js';
import activityService from '../services/activityService.js';
import { asyncHandler, sendSuccess, AppError } from '../utils/errors.js';

const listActivities = asyncHandler(async (req, res) => {
  const result = await activityService.listActivities({
    tenantId: req.tenantId,
    type: req.query.type,
    objectApiName: req.query.objectApiName,
    recordId: req.query.recordId,
    status: req.query.status,
    limit: req.query.limit,
    skip: req.query.skip,
  });
  sendSuccess(res, {
    data: result.items,
    meta: { total: result.total, limit: result.limit, skip: result.skip },
  });
});

const getTimeline = asyncHandler(async (req, res) => {
  const { objectApiName, recordId } = req.query;
  if (!objectApiName || !recordId) {
    throw new AppError('objectApiName and recordId are required.', 400);
  }
  const result = await activityService.listTimeline({
    tenantId: req.tenantId,
    objectApiName,
    recordId,
    types: req.query.types,
    userId: req.query.userId,
    from: req.query.from,
    to: req.query.to,
    limit: req.query.limit,
    skip: req.query.skip,
  });
  sendSuccess(res, {
    data: result.items,
    meta: { total: result.total, limit: result.limit, skip: result.skip },
  });
});

const getActivityReport = asyncHandler(async (req, res) => {
  const { objectApiName, recordId, from, to, groupBy = 'type' } = req.query;
  const filter = { tenantId: req.tenantId };
  if (objectApiName) filter.objectApiName = objectApiName;
  if (recordId) filter.recordId = recordId;
  if (from || to) {
    filter.occurredAt = {};
    if (from) filter.occurredAt.$gte = new Date(from);
    if (to) filter.occurredAt.$lte = new Date(to);
  }

  const Activity = (await import('../models/Activity.js')).default;
  const field = groupBy === 'user' ? 'createdBy' : 'type';
  const pipeline = [
    { $match: filter },
    { $group: { _id: `$${field}`, count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ];
  const results = await Activity.aggregate(pipeline);
  sendSuccess(res, { data: { groupBy, results } });
});

const getActivity = asyncHandler(async (req, res) => {
  const activity = await Activity.findOne({
    _id: req.params.id,
    tenantId: req.tenantId,
  });
  if (!activity) throw new AppError('Activity not found.', 404);
  sendSuccess(res, { data: activity });
});

const createActivity = asyncHandler(async (req, res) => {
  const activity = await activityService.createActivity(
    { ...req.body, tenantId: req.tenantId },
    req.user,
  );
  sendSuccess(res, { data: activity }, 'Activity created', 201);
});

const logActivity = asyncHandler(async (req, res) => {
  const activity = await activityService.logChannelActivity(
    { ...req.body, tenantId: req.tenantId },
    req.user,
  );
  sendSuccess(res, { data: activity }, 'Activity logged', 201);
});

const updateActivity = asyncHandler(async (req, res) => {
  const activity = await activityService.updateActivity({
    tenantId: req.tenantId,
    id: req.params.id,
    updates: req.body,
    user: req.user,
  });
  sendSuccess(res, { data: activity }, 'Activity updated');
});

const deleteActivity = asyncHandler(async (req, res) => {
  await activityService.deleteActivity({
    tenantId: req.tenantId,
    id: req.params.id,
  });
  sendSuccess(res, {}, 'Activity deleted');
});

// Static enum helper for the timeline filter UI.
const getActivityTypes = asyncHandler(async (_req, res) => {
  sendSuccess(res, { data: activityService.ACTIVITY_TYPES });
});

export {
  listActivities,
  getTimeline,
  getActivity,
  createActivity,
  logActivity,
  updateActivity,
  deleteActivity,
  getActivityTypes,
  getActivityReport,
};
