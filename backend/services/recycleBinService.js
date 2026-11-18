import DynamicRecord from '../models/DynamicRecord.js';
import Tenant from '../models/Tenant.js';
import configurationService from './configurationService.js';
import logger from '../utils/logger.js';

/**
 * Recycle Bin purge (Core BRD §3.1.3.3).
 *
 * Deleting a record soft-deletes it (isDeleted / deletedAt) so it can be
 * restored. This worker is the other half: once a record has sat in the bin
 * longer than the tenant's retention window it is removed for good.
 *
 * The window comes from `records.recycle_bin_retention_days`, which defaults
 * to 30 and can be overridden per tenant, so each tenant is resolved
 * separately rather than purged against one global cutoff.
 */

const DEFAULT_RETENTION_DAYS = 30;

/** Purge one tenant's expired records. Returns how many were removed. */
const purgeTenant = async (tenantId) => {
  const days = Number(
    await configurationService.resolve(
      'records.recycle_bin_retention_days',
      tenantId,
      DEFAULT_RETENTION_DAYS,
    ),
  );

  // A non-positive or unparseable window would purge the bin immediately,
  // which is never what an admin means — treat it as "keep the default".
  const retentionDays = Number.isFinite(days) && days > 0 ? days : DEFAULT_RETENTION_DAYS;

  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  const { deletedCount } = await DynamicRecord.deleteMany({
    tenantId,
    isDeleted: true,
    deletedAt: { $ne: null, $lt: cutoff },
  });

  return { tenantId, retentionDays, cutoff, purged: deletedCount || 0 };
};

/** Purge every tenant. Used by the worker and callable from a script. */
const purgeExpiredRecords = async () => {
  const tenants = await Tenant.find({}).select('_id').lean();
  const results = [];

  for (const tenant of tenants) {
    try {
      results.push(await purgeTenant(tenant._id));
    } catch (err) {
      // One tenant's failure must not stop the rest of the sweep.
      logger.error(`Recycle bin purge failed for tenant ${tenant._id}: ${err.message}`);
    }
  }

  const total = results.reduce((sum, r) => sum + r.purged, 0);
  if (total > 0) {
    logger.info(`Recycle bin purge removed ${total} record(s) across ${results.length} tenant(s).`);
  }
  return results;
};

export default { purgeExpiredRecords, purgeTenant };
