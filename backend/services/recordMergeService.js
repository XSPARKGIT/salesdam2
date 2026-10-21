import DynamicRecord from '../models/DynamicRecord.js';
import ObjectMeta from '../models/ObjectMeta.js';
import FieldMeta from '../models/FieldMeta.js';
import Activity from '../models/Activity.js';
import { AppError, ValidationError } from '../utils/errors.js';
import { validateRecordData, runObjectValidationRules } from './validationService.js';
import { buildSearchText } from './searchService.js';
import { computeAndSetFormulaValues } from './formulaService.js';
import { refreshRollupOnParent } from './rollupService.js';

/**
 * Duplicate record merge (Core BRD §3.4).
 *
 * The survivor keeps its id; each duplicate is soft-deleted and stamped
 * `mergedIntoId`. Blank survivor fields are filled from the duplicates (first
 * value wins), explicit `fieldValues` override, and every lookup that pointed
 * at a duplicate is repointed at the survivor. The survivor records an
 * append-only `mergeHistory` so a bad merge can be traced.
 */

// Values that only exist as the product of a save — never copied between
// records during a merge; the survivor recomputes them instead.
const COMPUTED_TYPES = new Set(['formula', 'rollup_summary', 'auto_number']);

const isBlank = (v) => v === undefined || v === null || v === '';

const mergeRecords = async ({
  tenantId,
  objectApiName,
  masterId,
  duplicateIds,
  fieldValues = {},
  user,
}) => {
  const sourceIds = [...new Set((duplicateIds || []).map(String))].filter(Boolean);
  if (!masterId) throw new AppError('A master (surviving) record id is required.', 400);
  if (sourceIds.length === 0) {
    throw new AppError('At least one duplicate record id is required.', 400);
  }
  if (sourceIds.includes(String(masterId))) {
    throw new AppError('The master record cannot also be listed as a duplicate.', 400);
  }
  if (!fieldValues || typeof fieldValues !== 'object') {
    throw new AppError('fieldValues must be an object.', 400);
  }

  const obj = await ObjectMeta.findOne({ tenantId, apiName: objectApiName });
  if (!obj) throw new AppError(`Object "${objectApiName}" not found.`, 404);
  const fields = await FieldMeta.find({ tenantId, objectApiName });

  const master = await DynamicRecord.findOne({
    _id: masterId,
    tenantId,
    objectApiName,
    isDeleted: false,
  });
  if (!master) throw new AppError('Master record not found.', 404);

  const duplicates = await DynamicRecord.find({
    _id: { $in: sourceIds },
    tenantId,
    objectApiName,
    isDeleted: false,
  });
  if (duplicates.length !== sourceIds.length) {
    throw new AppError('One or more duplicate records were not found.', 404);
  }
  const duplicateObjectIds = duplicates.map((d) => d._id);

  // Soft-delete the duplicates up front: they must not count against the
  // survivor's unique fields while its merged data is validated. Restored if
  // validation rejects the merge.
  await DynamicRecord.updateMany(
    { _id: { $in: duplicateObjectIds }, tenantId },
    {
      $set: {
        isDeleted: true,
        deletedAt: new Date(),
        deletedBy: user?._id,
        mergedIntoId: master._id,
      },
    },
  );

  let validated;
  try {
    const mergedData = {};
    for (const f of fields) {
      if (COMPUTED_TYPES.has(f.type)) continue;
      const current = master.getField(f.apiName);
      if (!isBlank(current)) mergedData[f.apiName] = current;
    }
    for (const d of duplicates) {
      for (const f of fields) {
        if (COMPUTED_TYPES.has(f.type)) continue;
        if (!isBlank(mergedData[f.apiName])) continue;
        const incoming = d.getField(f.apiName);
        if (!isBlank(incoming)) mergedData[f.apiName] = incoming;
      }
    }
    Object.assign(mergedData, fieldValues);

    const result = await validateRecordData(mergedData, fields, tenantId, master._id);
    if (result.errors.length === 0) {
      result.errors.push(...runObjectValidationRules(obj.validationRules || [], result.data));
    }
    if (result.errors.length > 0) {
      throw new ValidationError(result.errors, 400, {
        fieldErrors: result.fieldErrors,
        message: result.errors.join('; '),
      });
    }
    validated = result.data;
  } catch (err) {
    await DynamicRecord.updateMany(
      { _id: { $in: duplicateObjectIds }, tenantId },
      { $set: { isDeleted: false }, $unset: { deletedAt: 1, deletedBy: 1, mergedIntoId: 1 } },
    ).catch(() => {});
    throw err;
  }

  // Repoint every lookup that pointed at a duplicate, on any object. Lookup
  // values are stored as-is, so match both the string and ObjectId forms.
  const lookupFields = await FieldMeta.find({
    tenantId,
    type: { $in: ['lookup', 'master_detail'] },
    lookupObjectApiName: objectApiName,
  });
  const loserIdVariants = [...sourceIds, ...duplicateObjectIds];
  const repointed = [];
  for (const lf of lookupFields) {
    const res = await DynamicRecord.updateMany(
      {
        tenantId,
        objectApiName: lf.objectApiName,
        [`data.${lf.apiName}`]: { $in: loserIdVariants },
      },
      { $set: { [`data.${lf.apiName}`]: String(master._id) } },
    );
    if (res.modifiedCount) {
      repointed.push({
        objectApiName: lf.objectApiName,
        fieldApiName: lf.apiName,
        count: res.modifiedCount,
      });
    }
  }

  // Activities (notes, calls, tasks, channel messages) are keyed by record id
  // rather than a lookup field, so move them explicitly or they'd disappear
  // from the kept record's timeline.
  const activityPrimary = await Activity.updateMany(
    { tenantId, objectApiName, recordId: { $in: duplicateObjectIds } },
    { $set: { recordId: master._id } },
  );
  const activityRelated = await Activity.updateMany(
    {
      tenantId,
      relatedRecords: { $elemMatch: { objectApiName, recordId: { $in: duplicateObjectIds } } },
    },
    { $set: { 'relatedRecords.$[rel].recordId': master._id } },
    { arrayFilters: [{ 'rel.objectApiName': objectApiName, 'rel.recordId': { $in: duplicateObjectIds } }] },
  );
  const movedActivities = activityPrimary.modifiedCount + activityRelated.modifiedCount;
  if (movedActivities) {
    repointed.push({ objectApiName: 'activity', fieldApiName: 'recordId', count: movedActivities });
  }

  Object.entries(validated).forEach(([key, value]) => master.setField(key, value));
  await computeAndSetFormulaValues(master, fields);
  master._searchText = await buildSearchText(master, fields);
  master.lastModifiedBy = user?._id;
  master.mergeHistory.push({
    mergedAt: new Date(),
    mergedBy: user?._id,
    sourceIds: duplicateObjectIds,
  });
  await master.save();

  // Rollups on the survivor now depend on records that just moved to it.
  for (const r of repointed) {
    refreshRollupOnParent(tenantId, r.objectApiName, master._id, objectApiName).catch(
      () => {},
    );
  }

  return {
    master,
    mergedRecordIds: sourceIds,
    repointedReferences: repointed,
  };
};

export default { mergeRecords, COMPUTED_TYPES };
