import Activity from '../models/Activity.js';
import Message from '../models/Message.js';
import Tenant from '../models/Tenant.js';
import configurationService from './configurationService.js';
import logger from '../utils/logger.js';

/**
 * Call-recording retention (BRD §14.2.10).
 *
 * `records.call_recording_retention_days` is read per tenant (tenant value → platform value →
 * built-in). Unlike the recycle bin, the built-in value is 0 = keep recordings, and any
 * non-positive or unparseable value means "do nothing": a tenant that has not chosen a window is
 * never touched. When a positive window is set, the recording link is removed from calls older than
 * the window (the call record itself — who, when, how long — stays).
 */
const purgeTenant = async (tenantId) => {
  const days = Number(await configurationService.resolve('records.call_recording_retention_days', tenantId, 0));
  if (!Number.isFinite(days) || days <= 0) return { tenantId, retentionDays: 0, purged: 0, skipped: true };

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const stamp = new Date();
  const a = await Activity.updateMany(
    { tenantId, type: 'call', 'metadata.recordingUrl': { $nin: [null, ''] }, occurredAt: { $lt: cutoff } },
    { $set: { 'metadata.recordingUrl': '', 'metadata.recordingPurgedAt': stamp } },
  );
  const m = await Message.updateMany(
    { tenantId, 'metadata.call.recordingUrl': { $nin: [null, ''] }, occurredAt: { $lt: cutoff } },
    { $set: { 'metadata.call.recordingUrl': '', 'metadata.call.recordingPurgedAt': stamp } },
  );
  return { tenantId, retentionDays: days, cutoff, purged: (a.modifiedCount || 0) + (m.modifiedCount || 0) };
};

const purgeExpiredRecordings = async () => {
  const tenants = await Tenant.find({}).select('_id').lean();
  const results = [];
  for (const t of tenants) {
    try {
      results.push(await purgeTenant(t._id));
    } catch (err) {
      logger.error(`Call recording purge failed for tenant ${t._id}: ${err.message}`);
    }
  }
  const total = results.reduce((s, r) => s + r.purged, 0);
  if (total > 0) logger.info(`Call recording purge cleared ${total} recording link(s).`);
  return results;
};

export default { purgeExpiredRecordings, purgeTenant };
