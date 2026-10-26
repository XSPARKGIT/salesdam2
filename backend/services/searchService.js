/**
 * Build a search text blob for a record, used to populate the _searchText field.
 * This is indexed for full-text search.
 */
const buildSearchText = async (record, fields) => {
  const parts = [];

  if (record.data) {
    for (const field of fields) {
      if (!field.isSearchable) continue;
      const value = record.data.get
        ? record.data.get(field.apiName)
        : record.data[field.apiName];
      if (value !== undefined && value !== null) {
        const strVal = String(value).trim();
        if (strVal) parts.push(strVal);
      }
    }
  }

  return parts.join(' ');
};

/**
 * Reindex all records for a given object — rebuilds _searchText on every
 * record in batches so existing data appears in global search.
 * Fire-and-forget: caller does not await this.
 */
const reindexObject = async (tenantId, objectApiName) => {
  // Lazy-import to avoid circular deps
  const DynamicRecord = (await import('../models/DynamicRecord.js')).default;
  const FieldMeta = (await import('../models/FieldMeta.js')).default;
  const logger = (await import('../utils/logger.js')).default;

  try {
    const fields = await FieldMeta.find({ tenantId, objectApiName }).lean();
    const BATCH = 200;
    let skip = 0;

    while (true) {
      const batch = await DynamicRecord.find({ tenantId, objectApiName, isDeleted: false })
        .select('data _searchText')
        .skip(skip)
        .limit(BATCH)
        .lean();

      if (batch.length === 0) break;

      const ops = batch.map((rec) => {
        const parts = [];
        for (const field of fields) {
          if (!field.isSearchable) continue;
          const val = rec.data instanceof Map
            ? rec.data.get(field.apiName)
            : rec.data?.[field.apiName];
          if (val !== undefined && val !== null) {
            const s = String(val).trim();
            if (s) parts.push(s);
          }
        }
        return {
          updateOne: {
            filter: { _id: rec._id },
            update: { $set: { _searchText: parts.join(' ') } },
          },
        };
      });

      await DynamicRecord.bulkWrite(ops, { ordered: false });
      skip += BATCH;
      if (batch.length < BATCH) break;
    }

    logger.info(`Search reindex complete for ${objectApiName} (tenant ${tenantId})`);
  } catch (err) {
    const logger = (await import('../utils/logger.js')).default;
    logger.error(`Search reindex failed for ${objectApiName}: ${err.message}`);
  }
};

export { buildSearchText, reindexObject };
