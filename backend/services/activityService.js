import Activity, { ACTIVITY_TYPES } from '../models/Activity.js';
import Notification from '../models/Notification.js';
import { AppError } from '../utils/errors.js';

/**
 * Activity & customer interaction framework (Core BRD §24).
 *
 * Activities are tenant-scoped and keyed to a primary business record, so the
 * same model serves manual entry, channel ingestion and the Flow engine.
 */

const MAX_LIMIT = 200;

const _assertType = (type) => {
  if (!ACTIVITY_TYPES.includes(type)) {
    throw new AppError(`Unknown activity type '${type}'.`, 400);
  }
};

/**
 * Create a user-entered activity. Tasks default to `open`; every other type
 * defaults to `completed`.
 */
const createActivity = async (data = {}, user) => {
  const { type, objectApiName, recordId } = data;
  _assertType(type);
  if (!objectApiName || !recordId) {
    throw new AppError('objectApiName and recordId are required.', 400);
  }
  const status = data.status || (type === 'task' ? 'open' : 'completed');
  const activity = await Activity.create({
    ...data,
    status,
    createdBy: user?._id,
    occurredAt: data.occurredAt ? new Date(data.occurredAt) : new Date(),
  });

  // Automated follow-up task trigger (Section 24.2): qualifying calls/meetings
  // with metadata.followUpRequired create a single follow-up task + notification.
  const qualifying = (type === 'call' || type === 'meeting') && data?.metadata?.followUpRequired === true;
  if (qualifying) {
    const externalId = `followup:${activity._id}`;
    const existing = await Activity.findOne({ tenantId: data.tenantId, externalId, type: 'task' });
    if (!existing) {
      const dueAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const assignee = data.assignedTo || data.createdBy || user?._id;
      const task = await Activity.create({
        tenantId: data.tenantId,
        type: 'task',
        subject: `Follow up: ${data.subject || type}`,
        body: data.body || '',
        objectApiName: data.objectApiName,
        recordId: data.recordId,
        assignedTo: assignee,
        createdBy: user?._id,
        status: 'open',
        dueAt,
        occurredAt: new Date(),
        externalId,
        metadata: { followUpFor: String(activity._id), source: type },
      }).catch(() => null);
      if (task && assignee) {
        await Notification.create({
          tenantId: data.tenantId,
          userId: assignee,
          type: 'task_due',
          title: `Follow-up task: ${task.subject}`,
          body: `A follow-up task was created from a ${type}.`,
          link: `/o/${data.objectApiName}/${data.recordId}`,
          data: { taskId: String(task._id), activityId: String(activity._id) },
        }).catch(() => {});
      }
    }
  }

  return activity;
};

/**
 * Idempotent ingestion for channel-originated activities. Re-logging the same
 * `externalId` returns the existing activity instead of creating a duplicate.
 */
const logChannelActivity = async (data = {}, user) => {
  const { type, objectApiName, recordId, externalId } = data;
  _assertType(type);
  if (!objectApiName || !recordId) {
    throw new AppError('objectApiName and recordId are required.', 400);
  }
  if (!externalId) {
    throw new AppError('externalId is required for channel logging.', 400);
  }
  return Activity.findOneAndUpdate(
    { tenantId: data.tenantId, externalId },
    {
      $setOnInsert: {
        ...data,
        status: data.status || 'completed',
        createdBy: user?._id,
        occurredAt: data.occurredAt ? new Date(data.occurredAt) : new Date(),
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
};

const _timelineFilter = ({ tenantId, objectApiName, recordId, types, userId, from, to }) => {
  const filter = { tenantId, objectApiName, recordId };
  if (types) {
    const list = Array.isArray(types) ? types : String(types).split(',');
    const clean = list.map((t) => t.trim()).filter(Boolean);
    if (clean.length) filter.type = { $in: clean };
  }
  if (userId) {
    filter.$or = [{ assignedTo: userId }, { createdBy: userId }];
  }
  if (from || to) {
    filter.occurredAt = {};
    if (from) filter.occurredAt.$gte = new Date(from);
    if (to) filter.occurredAt.$lte = new Date(to);
  }
  return filter;
};

const listTimeline = async (params) => {
  const limit = Math.min(Number(params.limit) || 50, MAX_LIMIT);
  const skip = Number(params.skip) || 0;
  const filter = _timelineFilter(params);
  const [items, total] = await Promise.all([
    Activity.find(filter)
      .sort({ occurredAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('assignedTo', 'firstName lastName')
      .populate('createdBy', 'firstName lastName')
      .lean(),
    Activity.countDocuments(filter),
  ]);
  return { items, total, limit, skip };
};

const listActivities = async ({ tenantId, type, objectApiName, recordId, status, limit, skip }) => {
  const filter = { tenantId };
  if (type) filter.type = type;
  if (objectApiName) filter.objectApiName = objectApiName;
  if (recordId) filter.recordId = recordId;
  if (status) filter.status = status;
  const size = Math.min(Number(limit) || 50, MAX_LIMIT);
  const offset = Number(skip) || 0;
  const [items, total] = await Promise.all([
    Activity.find(filter).sort({ occurredAt: -1 }).skip(offset).limit(size).lean(),
    Activity.countDocuments(filter),
  ]);
  return { items, total, limit: size, skip: offset };
};

const updateActivity = async ({ tenantId, id, updates = {}, user }) => {
  if (updates.type) _assertType(updates.type);
  if (updates.status === 'completed' && !updates.completedAt) {
    updates.completedAt = new Date();
  }
  const activity = await Activity.findOneAndUpdate(
    { _id: id, tenantId },
    { $set: updates },
    { new: true, runValidators: true },
  );
  if (!activity) throw new AppError('Activity not found.', 404);
  return activity;
};

const deleteActivity = async ({ tenantId, id }) => {
  const activity = await Activity.findOneAndDelete({ _id: id, tenantId });
  if (!activity) throw new AppError('Activity not found.', 404);
  return activity;
};

export default {
  ACTIVITY_TYPES,
  createActivity,
  logChannelActivity,
  listTimeline,
  listActivities,
  updateActivity,
  deleteActivity,
};
