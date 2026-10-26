import mongoose from 'mongoose';
import DynamicRecord from '../models/DynamicRecord.js';
import ObjectMeta from '../models/ObjectMeta.js';
import FieldMeta from '../models/FieldMeta.js';
import AutoNumberCounter from '../models/AutoNumberCounter.js';
import {
  asyncHandler,
  sendSuccess,
  AppError,
  ValidationError,
  paginate,
} from '../utils/errors.js';
import { audit } from '../utils/auditLogger.js';
import {
  validateRecordData,
  runObjectValidationRules,
} from '../services/validationService.js';
import {
  getEditableFields,
  getVisibleFields,
  buildDataAccessFilter,
} from '../middleware/permissions.js';
import { buildSearchText } from '../services/searchService.js';
import { fireAutomations, runAutomation } from '../services/automationService.js';
import {
  setRollupValuesOnRecord,
  refreshRollupOnParent,
} from '../services/rollupService.js';
import { injectFormulaValuesMultiple, injectFormulaValues, computeAndSetFormulaValues, computeFormulaValues } from '../services/formulaService.js';
import { convertDealToOrder } from '../services/dealConversionService.js';
import { applyAutoNumbers } from '../services/autoNumberService.js';
import ListView from '../models/ListView.js';
import RecentlyViewed from '../models/RecentlyViewed.js';
import FieldHistory from '../models/FieldHistory.js';
import { buildFilterQuery, buildSort } from '../services/listViewService.js';
import { defaultViewsFor } from '../config/listViews.js';
import approvalProcessService from '../services/approvalProcessService.js';
import duplicateDetectionService from '../services/duplicateDetectionService.js';
import recordMergeService from '../services/recordMergeService.js';

/**
 * Resolves a view key to its definition. Config-defined defaults are checked
 * first, then the user's own saved views (by id).
 */
async function resolveListView({ tenantId, userId, objectMeta, viewKey }) {
  const fromDefaults = defaultViewsFor(objectMeta).find((v) => v.key === viewKey);
  if (fromDefaults) return fromDefaults;

  if (!mongoose.isValidObjectId(viewKey)) return null;

  const saved = await ListView.findOne({
    _id: viewKey,
    tenantId,
    objectApiName: objectMeta.apiName,
    $or: [{ isShared: true }, { createdBy: userId }],
  });
  if (!saved) return null;

  return {
    key: String(saved._id),
    name: saved.name,
    filters: saved.filters || [],
    columns: saved.columns || [],
    sortField: saved.sortField || null,
    sortOrder: saved.sortOrder || 'desc',
    source: 'records',
    isDefault: false,
  };
}

/**
 * GET /api/records/:objectApiName
 */
const listRecords = asyncHandler(async (req, res) => {
  const { objectApiName } = req.params;
  const {
    page = 1,
    limit = 50,
    sort,
    search,
    filter: filterStr,
    view: viewKey,
  } = req.query;

  const obj = await ObjectMeta.findOne({
    tenantId: req.tenantId,
    apiName: objectApiName,
  });
  if (!obj) throw new AppError(`Object "${objectApiName}" not found.`, 404);

  const skip = (parseInt(page) - 1) * parseInt(limit);

  // Loaded up front rather than alongside the query below, because the filter
  // builder needs the field types to coerce operands to the BSON type each field
  // is actually stored as (numbers, dates). Without it "amount > 100" compares a
  // string against numbers and matches nothing.
  const fields = await FieldMeta.find({ objectId: obj._id });
  const fieldTypes = Object.fromEntries(fields.map((f) => [f.apiName, f.type]));

  // Data access filter — scopes results to what the user is allowed to see
  const dataFilter = await buildDataAccessFilter(req.user);
  const query = {
    tenantId: req.tenantId,
    objectApiName,
    isDeleted: false,
    ...dataFilter,
  };

  // ── Resolve the requested list view ───────────────────────────────────────
  const view = viewKey
    ? await resolveListView({
        tenantId: req.tenantId,
        userId: req.user._id,
        objectMeta: obj,
        viewKey,
      })
    : null;

  const filterClauses = [];
  // Populated for the Recently Viewed source, to restore view-history order.
  let recentOrder = null;

  if (view) {
    filterClauses.push(
      buildFilterQuery(view.filters, { userId: req.user._id, fieldTypes }),
    );

    // "Recently Viewed" isn't a filter over field values — it's this user's own
    // view history. Restrict to those ids; the result order is restored below.
    if (view.source === 'recently_viewed') {
      recentOrder = await RecentlyViewed.recordIdsFor({
        tenantId: req.tenantId,
        userId: req.user._id,
        objectApiName,
      });
      // With no history, match nothing rather than falling through to everything.
      query._id = { $in: recentOrder };
    }
  }

  // Ad-hoc filters from the query string, same condition shape as a saved view.
  if (filterStr) {
    try {
      const parsed =
        typeof filterStr === 'string' ? JSON.parse(filterStr) : filterStr;
      // Accept both the condition-array shape and the legacy
      // { field: value } map, which is treated as equality.
      const conditions = Array.isArray(parsed)
        ? parsed
        : Object.entries(parsed || {}).map(([field, value]) => ({
            field,
            operator: 'eq',
            value,
          }));
      filterClauses.push(
        buildFilterQuery(conditions, { userId: req.user._id, fieldTypes }),
      );
    } catch {
      throw new AppError('Invalid filter parameter.', 400);
    }
  }

  const activeClauses = filterClauses.filter((c) => Object.keys(c).length > 0);
  if (activeClauses.length === 1) {
    Object.assign(query, activeClauses[0]);
  } else if (activeClauses.length > 1) {
    query.$and = [...(query.$and || []), ...activeClauses];
  }

  // Full-text search
  if (search) {
    query.$text = { $search: search };
  }

  // Explicit sort wins; otherwise the view's sort; otherwise newest first.
  let sortObj;
  if (sort) {
    const field = sort.startsWith('-') ? sort.slice(1) : sort;
    sortObj = buildSort(field, sort.startsWith('-') ? 'desc' : 'asc');
  } else if (view?.sortField) {
    sortObj = buildSort(view.sortField, view.sortOrder);
  } else {
    sortObj = { createdAt: -1 };
  }

  const [records, total] = await Promise.all([
    DynamicRecord.find(query)
      .sort(sortObj)
      .skip(skip)
      .limit(parseInt(limit))
      .populate('createdBy', 'firstName lastName email')
      .populate('lastModifiedBy', 'firstName lastName email')
      .populate('ownerId', 'firstName lastName email'),
    DynamicRecord.countDocuments(query),
  ]);

  // Apply field-level visibility.
  //
  // Derived from the object's field definitions, not from the first record's
  // stored keys. Doing the latter meant any field absent from record #1 was
  // stripped from every row — so formula fields (which aren't always persisted)
  // and fields that happen to be empty on the first record silently vanished
  // from the whole list.
  const allFieldApiNames = [
    ...fields.map((f) => f.apiName),
    'id',
    'createdAt',
    'updatedAt',
  ];
  const visibleFields = await getVisibleFields(
    req.user,
    objectApiName,
    allFieldApiNames,
  );

  // Inject formula values into records
  const dataWithFormulas = await injectFormulaValuesMultiple(records, fields);

  // Root document columns are always returned — they are selectable as list
  // columns, so omitting one here would render it as an empty cell.
  const ALWAYS_RETURNED = [
    'id',
    'objectApiName',
    'createdAt',
    'updatedAt',
    'createdBy',
    'lastModifiedBy',
    'ownerId',
  ];

  const data = dataWithFormulas.map((obj) => {
    // Strip hidden fields
    const filtered = {};
    Object.keys(obj).forEach((k) => {
      if (visibleFields.includes(k) || ALWAYS_RETURNED.includes(k)) {
        filtered[k] = obj[k];
      }
    });
    return filtered;
  });

  // Mongo can't sort by "position in this id list", so restore the view-history
  // order here for Recently Viewed.
  if (recentOrder) {
    const rank = new Map(recentOrder.map((id, i) => [String(id), i]));
    data.sort(
      (a, b) =>
        (rank.get(String(a.id)) ?? Infinity) -
        (rank.get(String(b.id)) ?? Infinity),
    );
  }

  const payload = paginate(data, total, page, limit);
  // The active view's columns travel with the data so the table can render the
  // right columns in the right order without a second request.
  if (view) {
    payload.view = {
      key: view.key,
      name: view.name,
      columns: view.columns || [],
      sortField: view.sortField || null,
      sortOrder: view.sortOrder || 'desc',
      isDefault: !!view.isDefault,
    };
  }

  sendSuccess(res, payload);
});

/**
 * GET /api/records/:objectApiName/:id
 */
const getRecord = asyncHandler(async (req, res) => {
  const { objectApiName, id } = req.params;

  // Data access filter — prevents reading records outside the user's scope
  const dataFilter = await buildDataAccessFilter(req.user);

  const record = await DynamicRecord.findOne({
    _id: id,
    tenantId: req.tenantId,
    objectApiName,
    isDeleted: false,
    ...dataFilter,
  })
    .populate('createdBy', 'firstName lastName email avatar')
    .populate('lastModifiedBy', 'firstName lastName email avatar')
    .populate('ownerId', 'firstName lastName email avatar');

  if (!record) throw new AppError('Record not found.', 404);

  // Fetch all fields for this object
  const allFields = await FieldMeta.find({
    tenantId: req.tenantId,
    objectApiName,
  });

  // Rollup summary values, recomputed on read so the detail view always agrees
  // with the current children. These are written onto the in-memory record (not
  // saved) before formulas run, because injectFormulaValues builds its
  // evaluation context from record.data — a formula referencing a rollup would
  // otherwise see the stale stored number.
  await setRollupValuesOnRecord(req.tenantId, record, allFields);

  // Inject formula field values
  const dataObj = await injectFormulaValues(record, allFields);

  // BRD §9.1 field-level security — strip fields the user cannot view
  const ALWAYS_RETURNED = ['id', 'objectApiName', 'createdAt', 'updatedAt', 'createdBy', 'lastModifiedBy', 'ownerId'];
  const allFieldApiNames = [...allFields.map((f) => f.apiName), ...ALWAYS_RETURNED];
  const visibleFields = await getVisibleFields(req.user, objectApiName, allFieldApiNames);
  const visibleSet = new Set(visibleFields);
  const filteredData = {};
  Object.keys(dataObj).forEach((k) => {
    if (visibleSet.has(k) || ALWAYS_RETURNED.includes(k)) filteredData[k] = dataObj[k];
  });

  // Feed the per-user "Recently Viewed" list. Fire-and-forget — it must never
  // delay or fail the read.
  RecentlyViewed.track({
    tenantId: req.tenantId,
    userId: req.user._id,
    objectApiName,
    recordId: record._id,
  }).catch(() => {});

  sendSuccess(res, { data: filteredData });
});

/**
 * POST /api/records/:objectApiName
 */
const createRecord = asyncHandler(async (req, res) => {
  const { objectApiName } = req.params;

  // Configurable duplicate detection (Core BRD §3.4). Runs on the request body
  // so it applies equally to manual capture, API and import callers.
  const duplicateCheck = await duplicateDetectionService.check(
    req.tenantId,
    objectApiName,
    req.body,
    {},
  );
  if (duplicateCheck.action === 'block') {
    return res.status(409).json({
      success: false,
      message: 'A potential duplicate record was found.',
      duplicates: duplicateCheck.matches,
      duplicateCheck: { action: duplicateCheck.action },
    });
  }
  // DUP-011: return the existing record rather than creating a duplicate.
  if (duplicateCheck.action === 'use_existing' && duplicateCheck.matches.length > 0) {
    const existing = duplicateCheck.matches[0].record;
    return res.status(200).json({
      success: true,
      message: 'An existing matching record was returned instead of creating a duplicate.',
      data: existing,
      duplicateCheck: { action: 'use_existing', existingRecordId: String(existing._id) },
    });
  }
  // DUP-012: trigger a configured automation flow on match.
  let flowTriggered = false;
  if (duplicateCheck.action === 'trigger_flow' && duplicateCheck.flowId) {
    runAutomation(duplicateCheck.flowId, req.body, req.tenantId, {
      duplicateMatches: duplicateCheck.matches,
    }).catch(() => {});
    flowTriggered = true;
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Check storage limit (20MB)
    const STORAGE_LIMIT = 20 * 1024 * 1024;
    const totalRecords = await DynamicRecord.aggregate([
      { $match: { tenantId: req.tenantId } },
      {
        $group: {
          _id: null,
          total_size: { $sum: { $bsonSize: '$$ROOT' } },
        },
      },
    ]).session(session);

    const currentUsage = totalRecords[0]?.total_size || 0;
    if (currentUsage >= STORAGE_LIMIT) {
      throw new AppError(
        `Storage limit (20MB) exceeded. Cannot create new records. Current usage: ${(currentUsage / (1024 * 1024)).toFixed(2)}MB`,
        402,
      );
    }

    const obj = await ObjectMeta.findOne({
      tenantId: req.tenantId,
      apiName: objectApiName,
    }).session(session);
    if (!obj) throw new AppError(`Object "${objectApiName}" not found.`, 404);

    // Prevent direct creation of quotes and invoices (they must be generated from deals/orders)
    if (['quote', 'invoice'].includes(objectApiName)) {
      throw new AppError(
        `${objectApiName === 'quote' ? 'Quotes' : 'Invoices'} can only be generated from ${objectApiName === 'quote' ? 'deals' : 'orders'}.`,
        403,
      );
    }

    const fields = await FieldMeta.find({
      tenantId: req.tenantId,
      objectApiName,
    }).session(session);

    // Strip fields the user is not allowed to edit
    const editableFieldNames = await getEditableFields(
      req.user,
      objectApiName,
      fields.map((f) => f.apiName),
    );
    const editableBody = Object.fromEntries(
      Object.entries(req.body).filter(([k]) => editableFieldNames.includes(k)),
    );

    // Validate and sanitize input data
    const { data: validatedData, errors, fieldErrors } = await validateRecordData(
      editableBody,
      fields,
      req.tenantId,
      null,
    );

    // Object-level validation rules (cross-field expressions). Formula values
    // are computed into the context first — they don't exist on the record yet
    // (that happens further down), so without this a rule referencing a formula
    // field would silently compare against null and never fire.
    // FORM-006: On create every field is "changed" from nothing, so pass an empty
    // __prev so ISCHANGED() returns true for fields that have a value and false
    // for fields that are blank — matching Salesforce's create-path semantics.
    const ruleErrors = runObjectValidationRules(obj.validationRules || [], {
      ...validatedData,
      ...computeFormulaValues(validatedData, fields),
      __prev: {},
    });
    // Split: rules with an errorField go into fieldErrors (inline); others go
    // into the banner errors array.
    for (const re of ruleErrors) {
      if (re.errorField) fieldErrors[re.errorField] = re.message;
      else errors.push(re.message);
    }

    if (errors.length > 0 || Object.keys(fieldErrors).length > 0) {
      throw new ValidationError(errors, 400, {
        fieldErrors,
        validationErrors: ruleErrors,
        message: errors.join('; ') || 'Validation failed.',
      });
    }

    const record = new DynamicRecord({
      tenantId: req.tenantId,
      objectId: obj._id,
      objectApiName,
      ownerId: req.body.ownerId || req.user._id,
      createdBy: req.user._id,
      lastModifiedBy: req.user._id,
    });

    // Set all validated fields
    Object.entries(validatedData).forEach(([key, value]) => {
      record.setField(key, value);
    });

    // ── Auto-number fields — generate values atomically ───────────────────────
    await applyAutoNumbers(record, fields, req.tenantId, objectApiName);

    // ── Rollup summary fields — must precede formulas, which may read them ────
    await setRollupValuesOnRecord(req.tenantId, record, fields);

    // ── Formula fields — compute and save values ──────────────────────────────
    await computeAndSetFormulaValues(record, fields);

    // Build search text
    record._searchText = await buildSearchText(record, fields);

    await record.save({ session });

    // Update tenant record count (within transaction)
    await req.tenant?.updateOne({ $inc: { 'usage.records': 1 } }, { session });

    // Audit log (within transaction)
    await audit({
      tenantId: req.tenantId,
      userId: req.user._id,
      userEmail: req.user.email,
      action: 'create',
      resource: 'DynamicRecord',
      resourceId: record._id,
      objectApiName,
      req,
      session,
    });

    // Write a creation snapshot to FieldHistory when enableHistory is on.
    // Every field present at creation is written as oldValue: null → newValue: <value>.
    if (obj.enableHistory) {
      const snapshot = record.toDataObject();
      const creationDocs = fields
        .filter((f) => {
          const v = snapshot[f.apiName];
          return v !== null && v !== undefined && v !== '';
        })
        .map((f) => ({
          tenantId: req.tenantId,
          objectApiName,
          recordId: record._id,
          fieldApiName: f.apiName,
          oldValue: null,
          newValue: snapshot[f.apiName],
          changedBy: req.user._id,
          isCreation: true,
        }));
      if (creationDocs.length > 0) {
        FieldHistory.insertMany(creationDocs, { session }).catch(() => {});
      }
    }

    // Commit transaction
    await session.commitTransaction();

    // Fire record-triggered automations (non-blocking, after transaction)
    fireAutomations('create', objectApiName, record, req.tenantId).catch(
      () => {},
    );

    // Refresh rollup summaries on parent records (non-blocking, after transaction)
    _triggerParentRollup(
      req.tenantId,
      objectApiName,
      record.toDataObject(),
      fields,
    );

    sendSuccess(
      res,
      {
        data: record.toDataObject(),
        ...(duplicateCheck.action === 'warn' && duplicateCheck.matches.length
          ? { duplicateMatches: duplicateCheck.matches }
          : {}),
        ...(flowTriggered
          ? { flowTriggered: true, flowId: String(duplicateCheck.flowId) }
          : {}),
      },
      'Record created successfully',
      201,
    );
  } catch (err) {
    // Abort the transaction on any error
    await session.abortTransaction();
    throw err;
  } finally {
    // End the session
    session.endSession();
  }
});

/**
 * PUT /api/records/:objectApiName/:id
 */
const updateRecord = asyncHandler(async (req, res) => {
  const { objectApiName, id } = req.params;

  // Configurable duplicate detection (Core BRD §3.4), excluding this record.
  const duplicateCheck = await duplicateDetectionService.check(
    req.tenantId,
    objectApiName,
    req.body,
    { excludeRecordId: id },
  );
  if (duplicateCheck.action === 'block') {
    return res.status(409).json({
      success: false,
      message: 'This change would create a duplicate record.',
      duplicates: duplicateCheck.matches,
    });
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const record = await DynamicRecord.findOne({
      _id: id,
      tenantId: req.tenantId,
      objectApiName,
      isDeleted: false,
    }).session(session);
    if (!record) throw new AppError('Record not found.', 404);

    if (
      await approvalProcessService.isRecordLocked(req.tenantId, objectApiName, id)
    ) {
      throw new AppError(
        'This record is locked while an approval is pending.',
        423,
      );
    }

    const fields = await FieldMeta.find({
      tenantId: req.tenantId,
      objectApiName,
    }).session(session);

    // Strip fields the user is not allowed to edit
    const editableFieldNames = await getEditableFields(
      req.user,
      objectApiName,
      fields.map((f) => f.apiName),
    );
    const editableBody = Object.fromEntries(
      Object.entries(req.body).filter(([k]) => editableFieldNames.includes(k)),
    );

    // PATCH = partial update — only validate/process fields that were actually sent
    const isPartial = req.method === 'PATCH';
    const { data: validatedData, errors, fieldErrors } = await validateRecordData(
      editableBody,
      fields,
      req.tenantId,
      record._id,
      { partial: isPartial },
    );

    // Run object-level rules against the record as it will look after the
    // write. This applies to PATCH as well as PUT — a partial update can still
    // break a cross-field rule, so skipping it would let invalid state through.
    {
      const mergedData = { ...record.toDataObject(), ...validatedData };
      const objMeta = await ObjectMeta.findOne({
        tenantId: req.tenantId,
        apiName: objectApiName,
      }).session(session);
      // Recompute formula values from the merged data. `toDataObject()` carries
      // the values stored before this edit, so a rule referencing a formula
      // field would otherwise be checked against a stale figure.
      // FORM-006: Pass __prev so ISCHANGED() can compare old vs new values.
      const prevData = record.toDataObject();
      const ruleErrors = runObjectValidationRules(objMeta?.validationRules || [], {
        ...mergedData,
        ...computeFormulaValues(mergedData, fields),
        __prev: prevData,
      });
      for (const re of ruleErrors) {
        if (re.errorField) fieldErrors[re.errorField] = re.message;
        else errors.push(re.message);
      }
    }

    if (errors.length > 0 || Object.keys(fieldErrors).length > 0) {
      throw new ValidationError(errors, 400, {
        fieldErrors,
        validationErrors: [...(errors.map((m) => ({ message: m, errorField: '' }))), ...Object.entries(fieldErrors).map(([f, m]) => ({ message: m, errorField: f }))],
        message: errors.join('; ') || 'Validation failed.',
      });
    }

    // Snapshot the parent links before the write. When a lookup is repointed
    // (a line item moved to a different deal) the rollups on the record it left
    // have to be refreshed too, not just the one it joined.
    const parentLinksBefore = _parentLinks(record.toDataObject(), fields);

    // OBJ-013: snapshot old values for field history (non-blocking).
    const prevSnapshot = record.toDataObject();

    // Only update provided fields
    Object.entries(validatedData).forEach(([key, value]) => {
      record.setField(key, value);
    });

    // ── Rollup summary fields — must precede formulas, which may read them ────
    await setRollupValuesOnRecord(req.tenantId, record, fields);

    // ── Formula fields — recompute and save values ────────────────────────────
    await computeAndSetFormulaValues(record, fields);

    record.lastModifiedBy = req.user._id;
    record._searchText = await buildSearchText(record, fields);
    await record.save({ session });

    // OBJ-013: record field-level history when the object has enableHistory=true.
    {
      const objMeta = await ObjectMeta.findOne({
        tenantId: req.tenantId,
        apiName: objectApiName,
      }).select('enableHistory').session(session);
      if (objMeta?.enableHistory) {
        const historyDocs = Object.keys(validatedData)
          .filter((k) => prevSnapshot[k] !== validatedData[k])
          .map((k) => ({
            tenantId: req.tenantId,
            objectApiName,
            recordId: record._id,
            fieldApiName: k,
            oldValue: prevSnapshot[k] ?? null,
            newValue: validatedData[k] ?? null,
            changedBy: req.user._id,
          }));
        if (historyDocs.length > 0) {
          FieldHistory.insertMany(historyDocs, { session }).catch(() => {});
        }
      }
    }

    // ── Deal to Order conversion: trigger when deal stage changes to 'closed_won' ──
    let convertedOrder = null;
    if (
      objectApiName === 'deal' &&
      validatedData.stage === 'closed_won' &&
      !record.getField('is_converted')
    ) {
      convertedOrder = await convertDealToOrder(
        record,
        req.tenantId,
        req.user._id,
        session,
      );
    }

    await audit({
      tenantId: req.tenantId,
      userId: req.user._id,
      action: 'update',
      resource: 'DynamicRecord',
      resourceId: record._id,
      objectApiName,
      req,
      details: { fields: Object.keys(validatedData) },
      session,
    });

    // Commit transaction
    await session.commitTransaction();

    fireAutomations('update', objectApiName, record, req.tenantId).catch(
      () => {},
    );
    // Refresh from the record as saved, not from `validatedData`. A PATCH that
    // changes only a quantity does not carry the parent lookup, so keying off
    // the request body meant the parent's rollups were never recomputed.
    _triggerParentRollup(
      req.tenantId,
      objectApiName,
      record.toDataObject(),
      fields,
      parentLinksBefore,
    );

    const responseData = { data: record.toDataObject() };
    if (convertedOrder) {
      responseData.convertedOrder = convertedOrder.toDataObject();
    }
    if (duplicateCheck.action === 'warn' && duplicateCheck.matches.length) {
      responseData.duplicateMatches = duplicateCheck.matches;
    }

    sendSuccess(
      res,
      responseData,
      convertedOrder
        ? 'Deal converted to order successfully'
        : 'Record updated successfully',
    );
  } catch (err) {
    // Abort the transaction on any error
    await session.abortTransaction();
    throw err;
  } finally {
    // End the session
    session.endSession();
  }
});

/**
 * DELETE /api/records/:objectApiName/:id
 */
const deleteRecord = asyncHandler(async (req, res) => {
  const { objectApiName, id } = req.params;
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const record = await DynamicRecord.findOne({
      _id: id,
      tenantId: req.tenantId,
      objectApiName,
      isDeleted: false,
    }).session(session);
    if (!record) throw new AppError('Record not found.', 404);

    if (
      await approvalProcessService.isRecordLocked(req.tenantId, objectApiName, id)
    ) {
      throw new AppError(
        'This record is locked while an approval is pending.',
        423,
      );
    }

    // REL-003: enforce block/nullify deletion behaviours on child objects.
    {
      const childLookupFields = await FieldMeta.find({
        tenantId: req.tenantId,
        lookupObjectApiName: objectApiName,
        deleteBehavior: { $in: ['block', 'nullify'] },
      }).select('objectApiName apiName deleteBehavior').session(session);

      for (const lf of childLookupFields) {
        const childCount = await DynamicRecord.countDocuments({
          tenantId: req.tenantId,
          objectApiName: lf.objectApiName,
          isDeleted: false,
          [`data.${lf.apiName}`]: id,
        }).session(session);

        if (childCount === 0) continue;

        if (lf.deleteBehavior === 'block') {
          throw new AppError(
            `Cannot delete this record: ${childCount} child record(s) in "${lf.objectApiName}" are linked via "${lf.apiName}". Reassign or delete them first.`,
            409,
          );
        }
        if (lf.deleteBehavior === 'nullify') {
          await DynamicRecord.updateMany(
            {
              tenantId: req.tenantId,
              objectApiName: lf.objectApiName,
              isDeleted: false,
              [`data.${lf.apiName}`]: id,
            },
            { $unset: { [`data.${lf.apiName}`]: '' } },
            { session },
          );
        }
      }
    }

    record.isDeleted = true;
    record.deletedAt = new Date();
    record.deletedBy = req.user._id;
    await record.save({ session });

    await audit({
      tenantId: req.tenantId,
      userId: req.user._id,
      action: 'delete',
      resource: 'DynamicRecord',
      resourceId: record._id,
      objectApiName,
      req,
      session,
    });

    // Handle cascade deletes (within transaction)
    const fields = await FieldMeta.find({
      tenantId: req.tenantId,
      objectApiName,
    }).session(session);

    const cascadeDeleted = await _cascadeDelete(
      req.tenantId,
      objectApiName,
      record._id,
      req.user._id,
      session,
    );

    // Counts the parent plus every cascaded child, so usage stays accurate.
    await req.tenant?.updateOne(
      { $inc: { 'usage.records': -(1 + cascadeDeleted) } },
      { session },
    );

    // Commit transaction
    await session.commitTransaction();

    fireAutomations('delete', objectApiName, record, req.tenantId).catch(
      () => {},
    );

    // Snapshot lookup values after deletion for parent rollup refresh (non-blocking)
    const dataSnapshot = record.toDataObject();
    _triggerParentRollup(req.tenantId, objectApiName, dataSnapshot, fields);

    sendSuccess(res, {}, 'Record deleted successfully');
  } catch (err) {
    // Abort the transaction on any error
    await session.abortTransaction();
    throw err;
  } finally {
    // End the session
    session.endSession();
  }
});

/**
 * POST /api/records/:objectApiName/bulk-delete
 */
const bulkDelete = asyncHandler(async (req, res) => {
  const { objectApiName } = req.params;
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0)
    throw new AppError('ids array is required.', 400);
  if (ids.length > 200)
    throw new AppError('Max 200 records per bulk operation.', 400);

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Resolve which ids actually exist and are still live, so the cascade only
    // runs for records this call really deleted. `data` comes along so the
    // parent links can be snapshotted for the rollup refresh below — once these
    // are soft-deleted the lookup values are no longer reachable.
    const targets = await DynamicRecord.find({
      _id: { $in: ids },
      tenantId: req.tenantId,
      objectApiName,
      isDeleted: false,
    }).session(session);
    const targetIds = targets.map((t) => t._id);
    const deletedSnapshots = targets.map((t) => t.toDataObject());

    const result = await DynamicRecord.updateMany(
      { _id: { $in: targetIds }, tenantId: req.tenantId },
      { isDeleted: true, deletedAt: new Date(), deletedBy: req.user._id },
      { session }
    );

    // Handle cascade deletes for each deleted record (within transaction).
    // A shared `visited` set stops the same child being processed twice when
    // several selected parents lead to it.
    const visited = new Set();
    let cascadeDeleted = 0;
    for (const recordId of targetIds) {
      cascadeDeleted += await _cascadeDelete(
        req.tenantId,
        objectApiName,
        recordId,
        req.user._id,
        session,
        0,
        visited,
      );
    }

    await req.tenant?.updateOne(
      { $inc: { 'usage.records': -(result.modifiedCount + cascadeDeleted) } },
      { session },
    );

    // Commit transaction
    await session.commitTransaction();

    // Refresh rollups on the parents of everything just removed (non-blocking).
    // Without this, bulk-deleting line items left the parent's totals stale.
    const bulkFields = await FieldMeta.find({
      tenantId: req.tenantId,
      objectApiName,
    });
    for (const snapshot of deletedSnapshots) {
      _triggerParentRollup(req.tenantId, objectApiName, snapshot, bulkFields);
    }

    sendSuccess(
      res,
      { data: { deleted: result.modifiedCount, cascadeDeleted } },
      'Records deleted',
    );
  } catch (err) {
    // Abort the transaction on any error
    await session.abortTransaction();
    throw err;
  } finally {
    // End the session
    session.endSession();
  }
});

/**
 * _parentLinks — the parent records this child currently points at.
 * Returns [{ parentId, parentObjectApiName }] for every populated
 * lookup / master-detail field.
 */
function _parentLinks(data, fields) {
  return (fields || [])
    .filter(
      (f) =>
        (f.type === 'lookup' || f.type === 'master_detail') &&
        f.lookupObjectApiName,
    )
    .map((f) => ({
      parentId: data?.[f.apiName],
      parentObjectApiName: f.lookupObjectApiName,
    }))
    .filter((link) => !!link.parentId);
}

/**
 * _triggerParentRollup — non-blocking helper.
 * Refreshes rollup_summary fields on every parent this child is (or was) linked
 * to. `previousLinks` covers a repointed lookup: the record the child left must
 * be recalculated as well as the one it joined.
 */
function _triggerParentRollup(
  tenantId,
  childObjectApiName,
  data,
  fields,
  previousLinks = [],
) {
  const links = [..._parentLinks(data, fields), ...previousLinks];

  // A child can reach the same parent through more than one path (and the
  // before/after snapshots usually agree), so refresh each parent once.
  const seen = new Set();
  for (const { parentId, parentObjectApiName } of links) {
    const key = `${parentObjectApiName}:${parentId}`;
    if (seen.has(key)) continue;
    seen.add(key);

    refreshRollupOnParent(
      tenantId,
      childObjectApiName,
      parentId,
      parentObjectApiName,
    ).catch(() => {});
  }
}

// Guards against runaway recursion if lookups form a cycle.
const CASCADE_MAX_DEPTH = 5;

/**
 * POST /api/records/:objectApiName/merge
 *
 * Folds one or more duplicate records into a surviving master record
 * (Core BRD §3.4). Soft-deletes the duplicates, fills blank master fields from
 * them, repoints inbound lookups and writes an audit entry.
 */
const mergeRecords = asyncHandler(async (req, res) => {
  const { objectApiName } = req.params;
  const { masterId, duplicateIds, fieldValues } = req.body || {};

  const result = await recordMergeService.mergeRecords({
    tenantId: req.tenantId,
    objectApiName,
    masterId,
    duplicateIds,
    fieldValues,
    user: req.user,
  });

  await audit({
    tenantId: req.tenantId,
    userId: req.user._id,
    userEmail: req.user.email,
    action: 'merge',
    resource: 'DynamicRecord',
    resourceId: result.master._id,
    objectApiName,
    req,
    details: {
      mergedRecordIds: result.mergedRecordIds,
      repointedReferences: result.repointedReferences,
    },
  });

  sendSuccess(
    res,
    {
      data: {
        master: result.master.toDataObject(),
        mergedRecordIds: result.mergedRecordIds,
        repointedReferences: result.repointedReferences,
      },
    },
    'Records merged',
  );
});

/**
 * _cascadeDelete — soft-deletes the children of a deleted record.
 *
 * Finds every lookup / master-detail field across the tenant that points at
 * `parentObjectApiName` with `cascadeDelete: true`, soft-deletes the child
 * records referencing `parentRecordId`, then recurses so grandchildren are
 * removed too (e.g. deal → deal line item → any cascade child of that).
 *
 * @returns {Promise<number>} how many child records were soft-deleted, so the
 *   caller can keep the tenant's record usage count accurate.
 */
async function _cascadeDelete(
  tenantId,
  parentObjectApiName,
  parentRecordId,
  userId,
  session = null,
  depth = 0,
  visited = new Set(),
) {
  if (depth >= CASCADE_MAX_DEPTH) return 0;

  // A record could be reachable by more than one path; only process it once.
  const visitKey = `${parentObjectApiName}:${parentRecordId}`;
  if (visited.has(visitKey)) return 0;
  visited.add(visitKey);

  const fieldQuery = FieldMeta.find({
    tenantId,
    lookupObjectApiName: parentObjectApiName,
    type: { $in: ['lookup', 'master_detail'] },
    $or: [{ cascadeDelete: true }, { deleteBehavior: 'cascade' }],
  });
  if (session) fieldQuery.session(session);
  const cascadeFields = await fieldQuery;

  // Lookup values are stored as strings (same convention as rollupService), but
  // match the ObjectId form too so records written by any other path are caught.
  const parentIdMatches = [String(parentRecordId)];
  if (mongoose.isValidObjectId(parentRecordId)) {
    parentIdMatches.push(new mongoose.Types.ObjectId(String(parentRecordId)));
  }

  let deletedCount = 0;

  for (const field of cascadeFields) {
    const childObjectApiName = field.objectApiName;

    // Fetch the ids first: they're needed to recurse, and so the returned count
    // reflects only the records this call actually deleted.
    const childQuery = DynamicRecord.find({
      tenantId,
      objectApiName: childObjectApiName,
      isDeleted: false,
      [`data.${field.apiName}`]: { $in: parentIdMatches },
    }).select('_id');
    if (session) childQuery.session(session);
    const children = await childQuery;
    if (children.length === 0) continue;

    const childIds = children.map((c) => c._id);

    const updateQuery = DynamicRecord.updateMany(
      { _id: { $in: childIds }, tenantId },
      { isDeleted: true, deletedAt: new Date(), deletedBy: userId },
    );
    if (session) updateQuery.session(session);
    const result = await updateQuery;
    deletedCount += result.modifiedCount ?? childIds.length;

    // A cascaded child may itself be the parent of another cascade chain.
    for (const childId of childIds) {
      deletedCount += await _cascadeDelete(
        tenantId,
        childObjectApiName,
        childId,
        userId,
        session,
        depth + 1,
        visited,
      );
    }
  }

  return deletedCount;
}

// LIFE-006: Restore a soft-deleted record from the Recycle Bin.
// Records soft-deleted more than 30 days ago cannot be restored.
const restoreRecord = asyncHandler(async (req, res) => {
  const { objectApiName, id } = req.params;

  const obj = await ObjectMeta.findOne({
    tenantId: req.tenantId,
    apiName: objectApiName,
  });
  if (!obj) throw new AppError(`Object "${objectApiName}" not found.`, 404);

  const record = await DynamicRecord.findOne({
    _id: id,
    tenantId: req.tenantId,
    objectApiName,
    isDeleted: true,
  });
  if (!record) throw new AppError('Deleted record not found.', 404);

  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
  if (record.deletedAt && Date.now() - record.deletedAt.getTime() > THIRTY_DAYS_MS) {
    throw new AppError(
      'This record was deleted more than 30 days ago and can no longer be restored.',
      410,
    );
  }

  record.isDeleted = false;
  record.deletedAt = undefined;
  record.deletedBy = undefined;
  await record.save();

  await audit({
    tenantId: req.tenantId,
    userId: req.user._id,
    action: 'restore',
    resource: 'DynamicRecord',
    resourceId: record._id,
    details: { objectApiName },
    req,
  });

  sendSuccess(res, { data: record }, 'Record restored successfully');
});

// LIFE-006: List deleted records in the Recycle Bin (within 30-day window).
const listDeletedRecords = asyncHandler(async (req, res) => {
  const { objectApiName } = req.params;
  const THIRTY_DAYS_AGO = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const { page, limit, skip } = paginate(req.query);
  const filter = {
    tenantId: req.tenantId,
    objectApiName,
    isDeleted: true,
    deletedAt: { $gte: THIRTY_DAYS_AGO },
  };

  const [records, total] = await Promise.all([
    DynamicRecord.find(filter).skip(skip).limit(limit).sort({ deletedAt: -1 }),
    DynamicRecord.countDocuments(filter),
  ]);

  sendSuccess(res, { data: records, total, page, limit }, 'Deleted records retrieved');
});

export {
  listRecords,
  getRecord,
  createRecord,
  updateRecord,
  deleteRecord,
  bulkDelete,
  mergeRecords,
  restoreRecord,
  listDeletedRecords,
  // Exported so the cascade rules can be exercised directly in tests.
  _cascadeDelete,
};
