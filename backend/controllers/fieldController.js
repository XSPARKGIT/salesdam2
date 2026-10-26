import FieldMeta from '../models/FieldMeta.js';
import ObjectMeta from '../models/ObjectMeta.js';
import GlobalValueSet from '../models/GlobalValueSet.js';
import Role from '../models/Role.js';
import logger from '../utils/logger.js';
import { reindexObject } from '../services/searchService.js';
import { asyncHandler, sendSuccess, AppError } from '../utils/errors.js';
import { audit } from '../utils/auditLogger.js';
import { validateFormula } from '../services/formulaParser.js';
import {
  buildSampleContext,
  buildFieldKindMap,
} from '../services/validationEngine.js';

const ROLLUP_TYPES = ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX'];
const ROLLUP_AGGREGATABLE_TYPES = ['number', 'currency', 'percent', 'formula'];

/**
 * Validate a rollup_summary field's configuration.
 *
 * A misconfigured rollup silently evaluates to null rather than failing, so the
 * checks happen here at save time where the admin can see the problem.
 *
 * @param {object} cfg          merged field config (existing values + updates)
 * @param {string} tenantId
 * @param {string} objectApiName the parent object the rollup lives on
 */
async function assertValidRollup(cfg, tenantId, objectApiName) {
  const {
    rollupObjectApiName,
    rollupRelationField,
    rollupType,
    rollupField,
    rollupFilter,
  } = cfg;

  if (!rollupObjectApiName) {
    throw new AppError('Rollup summary: choose the child object to aggregate.', 400);
  }
  if (!rollupType) {
    throw new AppError(
      `Rollup summary: choose an aggregate (${ROLLUP_TYPES.join(', ')}).`,
      400,
    );
  }
  if (!ROLLUP_TYPES.includes(String(rollupType).toUpperCase())) {
    throw new AppError(
      `Rollup summary: "${rollupType}" is not a valid aggregate. Use one of ${ROLLUP_TYPES.join(', ')}.`,
      400,
    );
  }

  const childFields = await FieldMeta.find({
    tenantId,
    objectApiName: rollupObjectApiName,
  });
  if (childFields.length === 0) {
    throw new AppError(
      `Rollup summary: object "${rollupObjectApiName}" has no fields.`,
      400,
    );
  }

  // The relationship field must be a lookup on the child that points back here,
  // otherwise the rollup would match no children.
  if (!rollupRelationField) {
    throw new AppError(
      'Rollup summary: choose the relationship field on the child object that points back to this record.',
      400,
    );
  }
  const relation = childFields.find((f) => f.apiName === rollupRelationField);
  if (
    !relation ||
    !['lookup', 'master_detail'].includes(relation.type) ||
    relation.lookupObjectApiName !== objectApiName
  ) {
    throw new AppError(
      `Rollup summary: "${rollupRelationField}" is not a relationship on "${rollupObjectApiName}" pointing to "${objectApiName}".`,
      400,
    );
  }

  // Only detail (master-detail) children can be summarised, expressed here as a
  // cascade-delete lookup: the child cannot outlive its parent, so the aggregate
  // can never include orphaned records. This matches what the field editor
  // offers, so the API cannot be used to create a rollup the UI would reject.
  if (!relation.cascadeDelete) {
    throw new AppError(
      `Rollup summary: "${relation.label}" on "${rollupObjectApiName}" is not a cascade-delete lookup. ` +
        'Only detail records that are deleted with their parent can be summarised.',
      400,
    );
  }

  // COUNT needs no field; every other aggregate needs a numeric one.
  if (String(rollupType).toUpperCase() !== 'COUNT') {
    if (!rollupField) {
      throw new AppError(
        `Rollup summary: ${rollupType} needs a field on "${rollupObjectApiName}" to aggregate.`,
        400,
      );
    }
    const agg = childFields.find((f) => f.apiName === rollupField);
    if (!agg) {
      throw new AppError(
        `Rollup summary: field "${rollupField}" does not exist on "${rollupObjectApiName}".`,
        400,
      );
    }
    if (!ROLLUP_AGGREGATABLE_TYPES.includes(agg.type)) {
      throw new AppError(
        `Rollup summary: "${agg.label}" is a ${agg.type} field and cannot be aggregated. Use a number, currency, percent or formula field.`,
        400,
      );
    }
  }

  // The filter runs against child records, so validate it against child fields.
  if (rollupFilter && rollupFilter.trim()) {
    const result = validateFormula(rollupFilter.trim(), buildSampleContext(childFields));
    if (!result.valid) {
      throw new AppError(
        `Rollup summary: filter is invalid: ${result.error}`,
        400,
      );
    }
  }
}

/**
 * Validate a formula expression against the sibling fields of an object.
 * Throws AppError if invalid.
 *
 * @param {string} [expectedType] - Declared `formulaReturnType`. When given, the
 *        expression must also evaluate to that type.
 */
async function assertValidFormula(
  expression,
  label,
  tenantId,
  objectApiName,
  expectedType,
) {
  if (!expression || !expression.trim()) {
    throw new AppError(`${label}: formula expression is required.`, 400);
  }
  const siblingFields = await FieldMeta.find({ tenantId, objectApiName });
  const result = validateFormula(expression.trim(), buildSampleContext(siblingFields), {
    expectedType,
    fieldKinds: buildFieldKindMap(siblingFields),
  });
  if (!result.valid) {
    throw new AppError(`${label} has an invalid formula: ${result.error}`, 400);
  }
}

/**
 * GET /api/objects/:objectApiName/fields
 */
const listFields = asyncHandler(async (req, res) => {
  const { objectApiName } = req.params;
  const obj = await ObjectMeta.findOne({
    tenantId: req.tenantId,
    apiName: objectApiName,
  });
  if (!obj) throw new AppError(`Object "${objectApiName}" not found.`, 404);

  const fields = await FieldMeta.find({
    tenantId: req.tenantId,
    objectId: obj._id,
  }).sort({ displayOrder: 1, apiName: 1 });

  sendSuccess(res, { data: fields });
});

/**
 * POST /api/objects/:objectApiName/fields
 */
const createField = asyncHandler(async (req, res) => {
  const { objectApiName } = req.params;

  const obj = await ObjectMeta.findOne({
    tenantId: req.tenantId,
    apiName: objectApiName,
  });

  if (!obj) {
    throw new AppError(`Object "${objectApiName}" not found.`, 404);
  }

  // Default name to label if not provided
  if (!req.body.name) {
    req.body.name = req.body.label;
  }

  const { apiName } = req.body;

  // Check uniqueness
  const existing = await FieldMeta.findOne({
    tenantId: req.tenantId,
    objectId: obj._id,
    apiName,
  });
  if (existing)
    throw new AppError(
      `Field "${apiName}" already exists on this object.`,
      409,
    );

  // Validate lookup target exists
  if (
    ['lookup', 'master_detail'].includes(req.body.type) &&
    req.body.lookupObjectApiName
  ) {
    const targetObj = await ObjectMeta.findOne({
      tenantId: req.tenantId,
      apiName: req.body.lookupObjectApiName,
    });
    if (!targetObj)
      throw new AppError(
        `Lookup target object "${req.body.lookupObjectApiName}" not found.`,
        404,
      );
  }

  // REL-005: Only one master-detail relationship allowed per object,
  // UNLESS it is a junction object (REL-006 exemption — two master-detail fields allowed).
  if (req.body.type === 'master_detail') {
    // Master-detail always cascade-deletes children when the parent is removed.
    req.body.cascadeDelete = true;

    const limit = obj.isJunctionObject ? 2 : 1;
    const existingMasterDetail = await FieldMeta.countDocuments({
      tenantId: req.tenantId,
      objectId: obj._id,
      type: 'master_detail',
    });
    if (existingMasterDetail >= limit) {
      throw new AppError(
        obj.isJunctionObject
          ? `Junction object "${objectApiName}" already has ${existingMasterDetail} master-detail relationship(s). Junction objects support at most 2.`
          : `Object "${objectApiName}" already has a master-detail relationship. Only one master-detail field is allowed per object.`,
        400,
      );
    }
  }

  // The model stores the expression on `formula`; accept the older
  // `formulaExpression` alias so existing clients keep working. Without this
  // the value was silently dropped by Mongoose strict mode and formula fields
  // saved blank.
  if (req.body.formula === undefined && req.body.formulaExpression !== undefined) {
    req.body.formula = req.body.formulaExpression;
  }
  delete req.body.formulaExpression;

  // Validate formula expression on formula fields
  if (req.body.type === 'formula') {
    // The return type decides how the computed value is stored and rendered, so
    // a formula field can't be created without one.
    if (!req.body.formulaReturnType) {
      throw new AppError(
        `Formula field "${req.body.label}": a return type is required.`,
        400,
      );
    }
    await assertValidFormula(
      req.body.formula,
      `Formula field "${req.body.label}"`,
      req.tenantId,
      objectApiName,
      req.body.formulaReturnType,
    );
  }

  // Validate formulaValidation expression if provided
  if (req.body.formulaValidation?.expression) {
    await assertValidFormula(
      req.body.formulaValidation.expression,
      `Field "${req.body.label}" formula validation`,
      req.tenantId,
      objectApiName,
    );
  }

  // Validate rollup summary configuration
  if (req.body.type === 'rollup_summary') {
    await assertValidRollup(req.body, req.tenantId, objectApiName);
  }

  // PICK-005: at most one isDefault=true value per picklist.
  if (['picklist', 'multipicklist'].includes(req.body.type) && Array.isArray(req.body.picklistValues)) {
    const defaultCount = req.body.picklistValues.filter((v) => v.isDefault).length;
    if (defaultCount > 1) {
      throw new AppError(
        `Only one picklist value may be marked as the default. ${defaultCount} default values were supplied.`,
        400,
      );
    }
  }

  // PICK-002: when a GlobalValueSet is linked, copy its values into the field
  // and ignore any inline picklistValues the caller passed.
  if (req.body.globalValueSetId) {
    if (!['picklist', 'multipicklist'].includes(req.body.type)) {
      throw new AppError('Only picklist and multipicklist fields can be linked to a global value set.', 400);
    }
    const gvs = await GlobalValueSet.findOne({
      _id: req.body.globalValueSetId,
      tenantId: req.tenantId,
    });
    if (!gvs) {
      throw new AppError('Global value set not found.', 404);
    }
    req.body.picklistValues = gvs.values;
  }

  // When no section is provided, inherit the most common section already used
  // by this object's fields so the new field lands alongside existing ones
  // instead of being placed in a generic "Information" bucket.
  if (!req.body.section) {
    const sectionCounts = await FieldMeta.aggregate([
      { $match: { tenantId: req.tenantId, objectId: obj._id, section: { $exists: true, $ne: null } } },
      { $group: { _id: '$section', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 1 },
    ]);
    if (sectionCounts.length > 0) {
      req.body.section = sectionCounts[0]._id;
    }
  }

  const field = await FieldMeta.create({
    tenantId: req.tenantId,
    objectId: obj._id,
    objectApiName,
    createdBy: req.user._id,
    ...req.body,
  });

  await audit({
    tenantId: req.tenantId,
    userId: req.user._id,
    action: 'create',
    resource: 'FieldMeta',
    resourceId: field._id,
    objectApiName,
    req,
  });

  // BRD §9.1 secure-by-default: add a hidden field permission to every role
  // that already has an object permission for this object.
  try {
    await Role.updateMany(
      { tenantId: req.tenantId, 'objectPermissions.objectApiName': objectApiName },
      {
        $push: {
          'objectPermissions.$[perm].fieldPermissions': {
            fieldApiName: field.apiName,
            canView: false,
            canEdit: false,
          },
        },
      },
      { arrayFilters: [{ 'perm.objectApiName': objectApiName }] },
    );
  } catch (err) {
    logger.warn(`Failed to provision field permissions for new field "${field.apiName}": ${err.message}`);
  }

  sendSuccess(res, { data: field }, 'Field created successfully', 201);
});

/**
 * PUT /api/objects/:objectApiName/fields/:fieldApiName
 */
const updateField = asyncHandler(async (req, res) => {
  const { objectApiName, fieldApiName } = req.params;
  const field = await FieldMeta.findOne({
    tenantId: req.tenantId,
    objectApiName,
    apiName: fieldApiName,
  });
  if (!field) throw new AppError(`Field "${fieldApiName}" not found.`, 404);

  // System fields have limited editability. Picklist system fields (e.g. the
  // auto-provisioned Record Type field) also allow picklistValues so record
  // types can be configured after the field is provisioned (RTYPE-003).
  if (field.isSystem) {
    const systemFieldAllowedUpdates = ['label', 'helpText'];
    if (field.type === 'picklist' || field.type === 'multipicklist') {
      systemFieldAllowedUpdates.push('picklistValues');
    }
    for (const [key] of Object.entries(req.body)) {
      if (!systemFieldAllowedUpdates.includes(key)) {
        throw new AppError(
          `Cannot modify "${key}" on system field "${field.apiName}". Allowed: ${systemFieldAllowedUpdates.join(', ')}.`,
          403,
        );
      }
    }
  }

  const allowedUpdates = [
    'label',
    'description',
    'helpText',
    'isRequired',
    'isUnique',
    'isReadOnly',
    'isHidden',
    'maxLength',
    'minLength',
    'precision',
    'scale',
    'minValue',
    'maxValue',
    'defaultValue',
    'picklistValues',
    'validationRule',
    'section',
    'column',
    'displayOrder',
    'isIndexed',
    'isSearchable',
    'isFilterable',
    'isSortable',
    // lookup / relation fields  ← these were missing, causing lookupObjectApiName to be cleared on edit
    'lookupObjectApiName',
    'lookupDisplayField',
    'cascadeDelete',
    'deleteBehavior',
    // auto-number
    'autoNumberPrefix',
    'autoNumberPadding',
    'autoNumberStartAt',
    // rollup summary
    'rollupObjectApiName',
    'rollupRelationField',
    'rollupType',
    'rollupField',
    'rollupFilter',
    // formula fields — `formula` is the actual model path
    'formula',
    'formulaReturnType',
    // structured validation rules
    'validations',
    'formulaValidation',
    // shared picklist catalogue
    'globalValueSetId',
  ];

  // Accept the older `formulaExpression` alias (see createField). Done after
  // the system-field check so the alias can't trip that guard.
  if (req.body.formula === undefined && req.body.formulaExpression !== undefined) {
    req.body.formula = req.body.formulaExpression;
  }
  delete req.body.formulaExpression;

  // Validate formula expression if being updated. Checked against the merged
  // expression/return type so changing only one of the two is still verified
  // against the other.
  if (req.body.formula !== undefined || field.type === 'formula') {
    const expr = req.body.formula ?? field.formula;
    if (expr) {
      await assertValidFormula(
        expr,
        `Formula field "${field.label}"`,
        req.tenantId,
        field.objectApiName,
        // Fields created before return types existed have none stored. Don't
        // block editing those — the expression is still syntax-checked, and the
        // type check starts applying as soon as a return type is set.
        req.body.formulaReturnType ?? field.formulaReturnType ?? undefined,
      );
    }
  }

  // Validate formulaValidation expression if being updated
  if (req.body.formulaValidation?.expression) {
    await assertValidFormula(
      req.body.formulaValidation.expression,
      `Field "${field.label}" formula validation`,
      req.tenantId,
      field.objectApiName,
    );
  }

  // Validate rollup summary configuration against the merged result, so a
  // partial edit (e.g. changing only the aggregate) is checked as a whole.
  if (field.type === 'rollup_summary') {
    const ROLLUP_KEYS = [
      'rollupObjectApiName',
      'rollupRelationField',
      'rollupType',
      'rollupField',
      'rollupFilter',
    ];
    const merged = {};
    ROLLUP_KEYS.forEach((k) => {
      merged[k] = req.body[k] !== undefined ? req.body[k] : field[k];
    });
    await assertValidRollup(merged, req.tenantId, field.objectApiName);
  }

  // PICK-002 (update): sync GVS values when a global value set is being linked or is already linked.
  const incomingGvsId = req.body.globalValueSetId ?? field.globalValueSetId;
  if (incomingGvsId && ['picklist', 'multipicklist'].includes(field.type)) {
    const gvs = await GlobalValueSet.findOne({ _id: incomingGvsId, tenantId: req.tenantId });
    if (!gvs) throw new AppError('Global value set not found.', 404);
    req.body.picklistValues = gvs.values;
  }

  // PICK-005: at most one isDefault=true value per picklist on update.
  if (
    ['picklist', 'multipicklist'].includes(field.type) &&
    Array.isArray(req.body.picklistValues)
  ) {
    const defaultCount = req.body.picklistValues.filter((v) => v.isDefault).length;
    if (defaultCount > 1) {
      throw new AppError(
        `Only one picklist value may be marked as the default. ${defaultCount} default values were supplied.`,
        400,
      );
    }
  }

  const wasSearchable = field.isSearchable;

  allowedUpdates.forEach((key) => {
    if (req.body[key] !== undefined) {
      // Don't overwrite formulaReturnType with an empty string on non-formula
      // fields — the enum rejects '' and the value is irrelevant outside formulas.
      if (key === 'formulaReturnType' && req.body[key] === '' && field.type !== 'formula') return;
      field[key] = req.body[key];
    }
  });
  field.lastModifiedBy = req.user._id;
  await field.save();

  // If isSearchable was just turned on, rebuild _searchText for all existing records
  if (!wasSearchable && field.isSearchable) {
    reindexObject(req.tenantId, field.objectApiName).catch(() => {});
  }

  sendSuccess(res, { data: field }, 'Field updated successfully');
});

/**
 * DELETE /api/objects/:objectApiName/fields/:fieldApiName
 */
const deleteField = asyncHandler(async (req, res) => {
  const { objectApiName, fieldApiName } = req.params;
  const field = await FieldMeta.findOne({
    tenantId: req.tenantId,
    objectApiName,
    apiName: fieldApiName,
  });
  if (!field) throw new AppError(`Field "${fieldApiName}" not found.`, 404);
  if (field.isSystem)
    throw new AppError(
      `System field "${field.label}" cannot be deleted. System fields are part of the object structure and can only be modified by administrators at the system level.`,
      403,
    );

  await FieldMeta.deleteOne({ _id: field._id });

  await audit({
    tenantId: req.tenantId,
    userId: req.user._id,
    action: 'delete',
    resource: 'FieldMeta',
    resourceId: field._id,
    req,
  });

  sendSuccess(res, {}, 'Field deleted successfully');
});

/**
 * POST /api/objects/:objectApiName/fields/reorder
 */
const reorderFields = asyncHandler(async (req, res) => {
  const { objectApiName } = req.params;
  const { order } = req.body; // [{ apiName, displayOrder }]
  if (!Array.isArray(order)) throw new AppError('order must be an array.', 400);

  await Promise.all(
    order.map(({ apiName, displayOrder }) =>
      FieldMeta.updateOne(
        { tenantId: req.tenantId, objectApiName, apiName },
        { displayOrder },
      ),
    ),
  );

  sendSuccess(res, {}, 'Fields reordered successfully');
});

const updateRelatedListColumns = asyncHandler(async (req, res) => {
  const { childObjectApiName, lookupFieldApiName, columns } = req.body;

  const field = await FieldMeta.findOne({
    tenantId: req.tenantId,
    objectApiName: childObjectApiName,
    apiName: lookupFieldApiName,
    type: { $in: ['lookup', 'master_detail'] },
  });

  if (!field) {
    throw new AppError('Lookup field not found.', 404);
  }

  field.relatedListConfig = {
    columns: columns.map((c, i) => ({
      fieldApiName: c,
      order: i,
    })),
  };

  await field.save();

  sendSuccess(
    res,
    { data: field.relatedListConfig },
    'Related list columns updated successfully',
  );
});

/**
 * POST /api/objects/:objectApiName/fields/:fieldApiName/rename
 * Renames a custom field's apiName and migrates all DynamicRecord data keys.
 * Body: { newApiName: string }
 */
const renameField = asyncHandler(async (req, res) => {
  const { objectApiName, fieldApiName } = req.params;
  const { newApiName } = req.body;
  const tenantId = req.tenantId;

  if (!newApiName) throw new AppError('"newApiName" is required.', 400);
  if (!/^[a-z][a-z0-9_]*$/.test(newApiName) || /__|_$/.test(newApiName)) {
    throw new AppError(
      'New API name must start with a lowercase letter and contain only lowercase letters, digits, and single underscores.',
      400,
    );
  }
  if (newApiName === fieldApiName) throw new AppError('New API name is the same as the current name.', 400);

  const field = await FieldMeta.findOne({ tenantId, objectApiName, apiName: fieldApiName });
  if (!field) throw new AppError(`Field "${fieldApiName}" not found on object "${objectApiName}".`, 404);
  if (field.isSystem) throw new AppError('System fields cannot be renamed.', 403);

  const conflict = await FieldMeta.findOne({ tenantId, objectApiName, apiName: newApiName });
  if (conflict) throw new AppError(`A field with API name "${newApiName}" already exists on "${objectApiName}".`, 409);

  // Update the FieldMeta document
  await FieldMeta.updateOne({ tenantId, _id: field._id }, { $set: { apiName: newApiName } });

  // Rename the data key across all DynamicRecord documents that carry this field.
  // $rename works for document paths including nested Map keys.
  const { modifiedCount: recordCount } = await DynamicRecord.updateMany(
    { tenantId, objectApiName, [`data.${fieldApiName}`]: { $exists: true } },
    { $rename: { [`data.${fieldApiName}`]: `data.${newApiName}` } },
  );

  await audit({
    tenantId,
    userId: req.user._id,
    action: 'rename',
    resource: 'FieldMeta',
    resourceId: field._id,
    details: { objectApiName, from: fieldApiName, to: newApiName, recordCount },
    req,
  });

  const updated = await FieldMeta.findOne({ tenantId, objectApiName, apiName: newApiName });
  sendSuccess(
    res,
    { data: updated, migration: { recordCount } },
    `Field renamed from "${fieldApiName}" to "${newApiName}". ${recordCount} record(s) data key migrated.`,
  );
});

export {
  listFields,
  createField,
  updateField,
  deleteField,
  reorderFields,
  updateRelatedListColumns,
  renameField,
  assertValidRollup,
};
