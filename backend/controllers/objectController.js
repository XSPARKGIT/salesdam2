import ObjectMeta, { VALIDATION_RULE_LIMITS } from '../models/ObjectMeta.js';
import FieldMeta from '../models/FieldMeta.js';
import DynamicRecord from '../models/DynamicRecord.js';
import Role from '../models/Role.js';
import logger from '../utils/logger.js';
import {
  asyncHandler,
  sendSuccess,
  AppError,
  paginate,
} from '../utils/errors.js';
import { audit } from '../utils/auditLogger.js';
import {
  seedDefaultFields,
  ensureUserObject,
} from '../services/metadataService.js';
import { validateFormula, configKeysIn } from '../services/formulaParser.js';
import configurationService from '../services/configurationService.js';
import { buildSampleContext, buildFieldKindMap } from '../services/validationEngine.js';
import { reindexObject } from '../services/searchService.js';
import { canManageSetup, getVisibleObjects, getReadableObjects } from '../services/objectAccessService.js';

// API names the platform reserves for system fields on every object, so the
// user's name field can't be created on top of one of them.
const RESERVED_FIELD_API_NAMES = ['owner_id', 'description', 'id'];

// Upper bound on object-level validation rules, to keep the per-save formula
// evaluation cost bounded.
const MAX_VALIDATION_RULES = 50;

// Fields whose change is worth naming in a validation-rule audit event.
// Long free-text fields (expression, errorMessage, description) are flagged
// as changed without their full text, to keep entries compact and avoid
// echoing large formulas into the Audit Trail.
const VALIDATION_RULE_AUDIT_FIELDS = ['name', 'description', 'expression', 'errorMessage', 'errorField', 'isActive'];
const SHORT_VALIDATION_RULE_FIELDS = new Set(['name', 'errorField', 'isActive']);

const ruleKey = (rule) => String(rule._id || rule.id || '');

/**
 * Diffs the object's validation rules before vs. after a save and emits
 * distinct, per-rule audit events (BRD §20.1) — never folded into the
 * generic ObjectMeta 'update' event, so rule changes stay individually
 * searchable in the Audit Trail.
 */
const auditValidationRuleChanges = async ({ tenantId, userId, objectApiName, before, after, req }) => {
  const beforeByKey = new Map(before.map((r) => [ruleKey(r), r]));
  const afterByKey = new Map(after.map((r) => [ruleKey(r), r]));

  const events = [];
  for (const [key, rule] of afterByKey) {
    if (!beforeByKey.has(key)) {
      events.push({
        action: 'validation_rule_create',
        resourceId: rule._id || rule.id,
        details: { name: rule.name, isActive: rule.isActive !== false },
      });
    }
  }
  for (const [key, rule] of beforeByKey) {
    if (!afterByKey.has(key)) {
      events.push({
        action: 'validation_rule_delete',
        resourceId: rule._id || rule.id,
        details: { name: rule.name },
      });
    }
  }
  for (const [key, prevRule] of beforeByKey) {
    const nextRule = afterByKey.get(key);
    if (!nextRule) continue;
    const changed = VALIDATION_RULE_AUDIT_FIELDS.filter((f) => String(prevRule[f] ?? '') !== String(nextRule[f] ?? ''));
    if (changed.length === 0) continue;
    const details = { name: nextRule.name, changedFields: changed };
    // Short, non-sensitive fields are useful enough to show their actual
    // before/after values; long free-text fields are flagged by name only.
    for (const f of changed) {
      if (SHORT_VALIDATION_RULE_FIELDS.has(f)) {
        details[f] = { from: prevRule[f], to: nextRule[f] };
      }
    }
    events.push({ action: 'validation_rule_update', resourceId: nextRule._id || nextRule.id, details });
  }

  await Promise.all(events.map((e) => audit({
    tenantId,
    userId,
    action: e.action,
    resource: 'ValidationRule',
    resourceId: e.resourceId,
    objectApiName,
    details: e.details,
    req,
  })));
};

/**
 * Normalise and validate an object-level Kanban configuration.
 *
 * A Kanban board is only usable when it is enabled and points at a real,
 * active picklist field. Disabling the board clears the stale group-by value so
 * the next enable cannot accidentally inherit an orphaned field.
 */
const resolveKanbanConfig = async ({
  tenantId,
  objectApiName,
  kanbanConfig,
}) => {
  const enabled = Boolean(kanbanConfig?.enabled);
  const fieldApiName =
    typeof kanbanConfig?.fieldApiName === 'string'
      ? kanbanConfig.fieldApiName.trim().toLowerCase()
      : '';

  if (!enabled) {
    return { enabled: false, fieldApiName: '' };
  }

  if (!fieldApiName) {
    throw new AppError(
      'Kanban view requires a group-by picklist field when enabled.',
      400,
    );
  }

  const groupByField = await FieldMeta.findOne({
    tenantId,
    objectApiName,
    apiName: fieldApiName,
  });

  if (!groupByField || groupByField.type !== 'picklist') {
    throw new AppError(
      `Kanban group-by field "${fieldApiName}" must be a picklist field.`,
      400,
    );
  }

  const hasActiveValues = (groupByField.picklistValues || []).some(
    (picklistValue) => picklistValue?.isActive,
  );

  if (!hasActiveValues) {
    throw new AppError(
      `Kanban group-by field "${fieldApiName}" must have at least one active picklist value.`,
      400,
    );
  }

  return { enabled: true, fieldApiName };
};

const resolveCalendarConfig = async ({
  tenantId,
  objectApiName,
  calendarConfig,
}) => {
  const enabled = Boolean(calendarConfig?.enabled);
  const dateFieldApiName =
    typeof calendarConfig?.dateFieldApiName === 'string'
      ? calendarConfig.dateFieldApiName.trim().toLowerCase()
      : '';
  const titleFieldApiName =
    typeof calendarConfig?.titleFieldApiName === 'string'
      ? calendarConfig.titleFieldApiName.trim().toLowerCase()
      : '';

  if (!enabled) {
    return { enabled: false, dateFieldApiName: '', titleFieldApiName: '' };
  }

  if (!dateFieldApiName) {
    throw new AppError(
      'Calendar view requires a date field when enabled.',
      400,
    );
  }

  const dateField = await FieldMeta.findOne({
    tenantId,
    objectApiName,
    apiName: dateFieldApiName,
  });

  if (!dateField || !['date', 'datetime'].includes(dateField.type)) {
    throw new AppError(
      `Calendar date field "${dateFieldApiName}" must be a date or datetime field.`,
      400,
    );
  }

  if (titleFieldApiName) {
    const titleField = await FieldMeta.findOne({
      tenantId,
      objectApiName,
      apiName: titleFieldApiName,
    });
    if (!titleField) {
      throw new AppError(
        `Calendar title field "${titleFieldApiName}" does not exist.`,
        400,
      );
    }
  }

  return { enabled: true, dateFieldApiName, titleFieldApiName };
};

/**
 * GET /api/objects
 * List all objects for the current tenant.
 */
const listObjects = asyncHandler(async (req, res) => {
  const { includeFields, navOnly, includeInactive } = req.query;
  const filter = { tenantId: req.tenantId };
  // Setup pages pass includeInactive=true to show deactivated objects too.
  // All other consumers (nav, record lists) only see active objects.
  if (includeInactive !== 'true') filter.isActive = true;
  if (navOnly === 'true') filter.showInNav = true;

  // Filter by the tenant's allowedObjects if configured
  let allowed = req.tenant?.allowedObjects?.length > 0 ? req.tenant.allowedObjects : null;

  // Workspace isolation + role read access. Setup pages (object manager, role
  // and workspace editors) pass scope=all to get the full catalogue, which only
  // users who manage the org's setup may do.
  // Reports pass scope=readable: every object the Role can read, whichever
  // App is open (BRD 5.3).
  const fullCatalogue = req.query.scope === 'all' && (await canManageSetup(req.user));
  if (req.query.scope === 'readable') {
    const readable = await getReadableObjects(req);
    if (readable) allowed = (allowed || [...readable]).filter((n) => readable.has(n));
  } else if (!fullCatalogue) {
    const visible = await getVisibleObjects(req);
    if (visible) allowed = (allowed || [...visible]).filter((n) => visible.has(n));
  }
  if (allowed) filter.apiName = { $in: allowed };

  const objects = await ObjectMeta.find(filter).sort({ navOrder: 1, name: 1 });

  if (includeFields === 'true') {
    const withFields = await Promise.all(
      objects.map(async (obj) => {
        const fields = await FieldMeta.find({
          objectId: obj._id,
          tenantId: req.tenantId,
        }).sort({ displayOrder: 1, apiName: 1 });
        return { ...obj.toObject(), fields };
      }),
    );
    return sendSuccess(res, { data: withFields });
  }

  sendSuccess(res, { data: objects });
});

/**
 * GET /api/objects/:apiName
 */
const getObject = asyncHandler(async (req, res) => {
  const { apiName } = req.params;

  // Auto-seed the user object if requested but not yet created
  if (apiName === 'user') {
    await ensureUserObject(req.tenantId, req.user._id);
  }

  const obj = await ObjectMeta.findOne({ tenantId: req.tenantId, apiName });
  if (!obj) throw new AppError(`Object "${apiName}" not found.`, 404);

  const fields = await FieldMeta.find({
    objectId: obj._id,
    tenantId: req.tenantId,
  }).sort({ displayOrder: 1, apiName: 1 });

  sendSuccess(res, { data: { ...obj.toObject(), fields } });
});

/**
 * POST /api/objects
 */
const createObject = asyncHandler(async (req, res) => {
  const {
    name,
    label,
    pluralLabel,
    apiName,
    description,
    icon,
    color,
    nameFieldApiName,
    enableHistory,
    showInNav,
    navOrder,
    sharingModel,
    kanbanConfig,
    calendarConfig,
    nameFieldType,
    nameFieldLabel,
    autoNumberPrefix,
    autoNumberPadding,
    autoNumberStartAt,
  } = req.body;

  // Normalise the name-field config once. Each value falls back to its default
  // only when the client omitted it (or sent a blank string).
  const nameFieldConfig = {
    nameFieldType: nameFieldType || 'text',
    nameFieldLabel: nameFieldLabel?.trim() || 'Name',
    nameFieldApiName: nameFieldApiName?.trim().toLowerCase() || 'name',
    autoNumberPrefix: autoNumberPrefix || '',
    autoNumberPadding: parseInt(autoNumberPadding, 10) || 5,
    autoNumberStartAt: parseInt(autoNumberStartAt, 10) || 1,
  };

  if (!['text', 'auto_number'].includes(nameFieldConfig.nameFieldType)) {
    throw new AppError('nameFieldType must be "text" or "auto_number".', 400);
  }

  if (!/^[a-z][a-z0-9_]{1,39}$/.test(nameFieldConfig.nameFieldApiName)) {
    throw new AppError(
      'Name field API name must start with a letter and contain only lowercase letters, numbers, and underscores.',
      400,
    );
  }

  if (RESERVED_FIELD_API_NAMES.includes(nameFieldConfig.nameFieldApiName)) {
    throw new AppError(
      `"${nameFieldConfig.nameFieldApiName}" is reserved and cannot be used as the name field API name.`,
      400,
    );
  }

  // OBJ-004: reject consecutive or trailing underscores.
  if (/__|_$/.test(apiName)) {
    throw new AppError(
      'Object API name must not contain consecutive underscores (__) or end with an underscore (_).',
      400,
    );
  }

  // Check apiName uniqueness per tenant
  const existing = await ObjectMeta.findOne({
    tenantId: req.tenantId,
    apiName,
  });
  if (existing)
    throw new AppError(
      `An object with API name "${apiName}" already exists.`,
      409,
    );

  // Enforce tenant limits — system/standard objects don't count against the quota.
  if (req.tenant) {
    const count = await ObjectMeta.countDocuments({
      tenantId: req.tenantId,
      isActive: true,
      isCustom: true,
      isSystem: { $ne: true },
    });
    if (count >= req.tenant.limits.maxObjects) {
      throw new AppError(
        `Object limit reached (max ${req.tenant.limits.maxObjects} custom objects).`,
        429,
      );
    }
  }

  const obj = await ObjectMeta.create({
    tenantId: req.tenantId,
    name,
    label,
    pluralLabel,
    apiName,
    description,
    icon,
    color,
    // Kept in sync with the FieldMeta seeded below.
    nameFieldApiName: nameFieldConfig.nameFieldApiName,
    enableHistory,
    showInNav,
    navOrder,
    sharingModel,
    kanbanConfig,
    calendarConfig: calendarConfig?.enabled
      ? await resolveCalendarConfig({ tenantId: req.tenantId, objectApiName: apiName, calendarConfig })
      : { enabled: false, dateFieldApiName: '', titleFieldApiName: '' },
    isCustom: true,
    isActive: true,
    createdBy: req.user._id,
  });

  // Seed default system fields — pass name field config so the name field is
  // created with the label, API name, and type the user specified.
  await seedDefaultFields(obj, req.tenantId, req.user._id, nameFieldConfig);

  // Add newly created custom object to tenant's allowedObjects if the list is configured
  if (req.tenant?.allowedObjects?.length > 0) {
    await req.tenant.updateOne({
      $addToSet: { allowedObjects: apiName },
      $inc: { 'usage.objects': 1 },
    });
  } else {
    // Update tenant usage if no allowedObjects restriction
    await req.tenant?.updateOne({ $inc: { 'usage.objects': 1 } });
  }

  await audit({
    tenantId: req.tenantId,
    userId: req.user._id,
    userEmail: req.user.email,
    action: 'create',
    resource: 'ObjectMeta',
    resourceId: obj._id,
    req,
  });

  // BRD §9.1 secure-by-default: add a no-access object permission entry to
  // every existing role so an admin must explicitly grant access.
  try {
    await Role.updateMany(
      {
        tenantId: req.tenantId,
        'objectPermissions.objectApiName': { $ne: apiName },
      },
      {
        $push: {
          objectPermissions: {
            objectApiName: apiName,
            canCreate: false,
            canRead: false,
            canUpdate: false,
            canDelete: false,
            canExport: false,
            canImport: false,
            fieldPermissions: [],
          },
        },
      },
    );
  } catch (err) {
    logger.warn(`Failed to provision object permissions for new object "${apiName}": ${err.message}`);
  }

  const fields = await FieldMeta.find({ objectId: obj._id }).sort({
    displayOrder: 1,
  });
  sendSuccess(
    res,
    { data: { ...obj.toObject(), fields } },
    'Object created successfully',
    201,
  );
});

/**
 * PUT /api/objects/:apiName
 */
const updateObject = asyncHandler(async (req, res) => {
  const { apiName } = req.params;
  const obj = await ObjectMeta.findOne({ tenantId: req.tenantId, apiName });
  if (!obj) throw new AppError(`Object "${apiName}" not found.`, 404);

  const allowedUpdates = [
    'name',
    'label',
    'pluralLabel',
    'description',
    'icon',
    'color',
    'enableHistory',
    'enableActivities',
    'enableNotes',
    'enableFiles',
    'showInNav',
    'navOrder',
    'sharingModel',
    'searchable',
    'searchFields',
    'actionButtons',
    'validationRules',
    'kanbanConfig',
    'calendarConfig',
    'isActive',
    'hasRecordTypes',
    'isJunctionObject',
  ];

  // Validate any validation rule expressions before saving
  if (
    Array.isArray(req.body.validationRules) &&
    req.body.validationRules.length > 0
  ) {
    const rules = req.body.validationRules;

    if (rules.length > MAX_VALIDATION_RULES) {
      throw new AppError(
        `An object can have at most ${MAX_VALIDATION_RULES} validation rules.`,
        400,
      );
    }

    // Length caps, checked here so the user gets a clear message rather than a
    // raw Mongoose validation error from the schema's maxlength.
    const tooLong = [];
    for (const rule of rules) {
      const label = rule.name || 'Unnamed rule';
      for (const [key, limit] of Object.entries(VALIDATION_RULE_LIMITS)) {
        const value = rule[key];
        if (typeof value === 'string' && value.trim().length > limit) {
          tooLong.push(
            `"${label}": ${key} is ${value.trim().length} characters (max ${limit}).`,
          );
        }
      }
    }
    if (tooLong.length > 0) {
      throw new AppError(tooLong.join('\n'), 400);
    }

    const fields = await FieldMeta.find({
      tenantId: req.tenantId,
      objectApiName: apiName,
    });
    const sampleCtx = buildSampleContext(fields);
    const fieldKinds = buildFieldKindMap(fields);
    const fieldNames = new Set(fields.map((f) => f.apiName));
    const invalidRules = [];
    for (const rule of rules) {
      const label = `"${rule.name || 'Unnamed rule'}"`;
      // The error location must be a field on this object (or blank = top of record).
      if (rule.errorField && !fieldNames.has(rule.errorField)) {
        invalidRules.push(`${label}: error location "${rule.errorField}" is not a field on this object.`);
        continue;
      }
      // Only active rules are enforced at save time, so only they must parse.
      if (rule.isActive === false || !rule.expression) continue;
      // A rule's formula is a condition: TRUE blocks the save (BRD 6.1).
      const result = validateFormula(rule.expression.trim(), sampleCtx, {
        asCondition: true,
        fieldKinds,
      });
      if (!result.valid) {
        invalidRules.push(`${label}: ${result.error}`);
      }
    }
    // BRD 6.2: CONFIG("key") must name a configuration value that exists for
    // this tenant (its own override or a platform default).
    if (invalidRules.length === 0) {
      const used = new Map();
      for (const rule of rules) {
        if (rule.isActive === false || !rule.expression) continue;
        for (const key of configKeysIn(rule.expression)) {
          if (!used.has(key)) used.set(key, rule.name || 'Unnamed rule');
        }
      }
      if (used.size) {
        const found = await configurationService.resolveMany([...used.keys()], req.tenantId);
        for (const [key, ruleName] of used) {
          if (!(key in found)) {
            invalidRules.push(`"${ruleName}": CONFIG("${key}") is not a configuration setting. Ask your platform admin to add it, or check the spelling.`);
          }
        }
      }
    }
    if (invalidRules.length > 0) {
      throw new AppError(
        `Invalid validation rule expression(s):\n${invalidRules.join('\n')}`,
        400,
      );
    }
  }

  const wasSearchable = obj.searchable;
  const wasHasRecordTypes = obj.hasRecordTypes;
  // Snapshot before the overwrite below, so the rule-level diff below can
  // tell exactly what changed — only taken when this request actually
  // touches validationRules, so an unrelated field update never runs it.
  const prevValidationRules = req.body.validationRules !== undefined
    ? (obj.validationRules ? obj.validationRules.toObject() : [])
    : null;
  allowedUpdates.forEach((key) => {
    if (key === 'kanbanConfig' || key === 'calendarConfig') return;
    if (req.body[key] !== undefined) obj[key] = req.body[key];
  });
  if (req.body.kanbanConfig !== undefined) {
    obj.kanbanConfig = await resolveKanbanConfig({
      tenantId: req.tenantId,
      objectApiName: apiName,
      kanbanConfig: req.body.kanbanConfig,
    });
  }
  if (req.body.calendarConfig !== undefined) {
    obj.calendarConfig = await resolveCalendarConfig({
      tenantId: req.tenantId,
      objectApiName: apiName,
      calendarConfig: req.body.calendarConfig,
    });
  }
  obj.lastModifiedBy = req.user._id;
  await obj.save();

  // Distinct, per-rule audit events (BRD §20.1) — only when this request
  // actually touched validationRules, and only for the rules that changed.
  if (prevValidationRules !== null) {
    await auditValidationRuleChanges({
      tenantId: req.tenantId,
      userId: req.user._id,
      objectApiName: apiName,
      before: prevValidationRules,
      after: obj.validationRules ? obj.validationRules.toObject() : [],
      req,
    });
  }

  // RTYPE-002: Ensure a system "type" picklist exists whenever hasRecordTypes
  // is enabled — covers both the initial toggle and any case where the field
  // was missing despite the flag already being true (e.g. failed first save).
  if (obj.hasRecordTypes) {
    const existingTypeField = await FieldMeta.findOne({
      tenantId: req.tenantId,
      objectApiName: apiName,
      apiName: 'type',
    });
    if (!existingTypeField) {
      await FieldMeta.create({
        tenantId: req.tenantId,
        objectId: obj._id,
        objectApiName: apiName,
        apiName: 'type',
        name: 'Type',
        label: 'Type',
        type: 'picklist',
        isSystem: true,
        isRequired: false,
        isCustom: false,
        picklistValues: [],
        createdBy: req.user._id,
        lastModifiedBy: req.user._id,
      });
    }
  }

  // If searchable was just turned on, rebuild _searchText for all existing records
  if (!wasSearchable && obj.searchable) {
    reindexObject(req.tenantId, apiName).catch(() => {});
  }

  await audit({
    tenantId: req.tenantId,
    userId: req.user._id,
    action: 'update',
    resource: 'ObjectMeta',
    resourceId: obj._id,
    req,
  });

  sendSuccess(res, { data: obj }, 'Object updated successfully');
});

/**
 * DELETE /api/objects/:apiName
 */
const deleteObject = asyncHandler(async (req, res) => {
  const { apiName } = req.params;
  const obj = await ObjectMeta.findOne({ tenantId: req.tenantId, apiName });
  if (!obj) throw new AppError(`Object "${apiName}" not found.`, 404);
  if (!obj.isCustom)
    throw new AppError('System objects cannot be deleted.', 403);
  if (obj.isSystem)
    throw new AppError('System objects cannot be deleted.', 403);

  // Counted up front so the response can report what the cascade removed.
  const [fieldCount, recordCount] = await Promise.all([
    FieldMeta.countDocuments({ tenantId: req.tenantId, objectId: obj._id }),
    DynamicRecord.countDocuments({
      tenantId: req.tenantId,
      objectApiName: apiName,
    }),
  ]);

  // LIFE-005: Block deletion when dependents exist unless ?force=true is passed.
  if (req.query.force !== 'true' && (recordCount > 0 || fieldCount > 0)) {
    throw new AppError(
      `Cannot delete object "${apiName}": it has ${recordCount} record(s) and ${fieldCount} field(s). ` +
        `Add ?force=true to the request to confirm permanent deletion of all dependents.`,
      409,
    );
  }

  // Hard-delete the object. The pre-deleteOne hook on ObjectMeta cascades to
  // fields, records, layouts, counters, screens and config, and strips the
  // object from workspace/tenant allow-lists, object groups and permissions.
  await obj.deleteOne();

  await req.tenant?.updateOne({ $inc: { 'usage.objects': -1 } });

  await audit({
    tenantId: req.tenantId,
    userId: req.user._id,
    action: 'delete',
    resource: 'ObjectMeta',
    resourceId: obj._id,
    details: { apiName, fieldCount, recordCount },
    req,
  });

  sendSuccess(
    res,
    { data: { apiName, fieldCount, recordCount } },
    'Object deleted successfully',
  );
});

/**
 * POST /api/objects/:apiName/rename
 * Renames a custom object's apiName and migrates all dependent references.
 * Body: { newApiName: string }
 */
const renameObject = asyncHandler(async (req, res) => {
  const { apiName } = req.params;
  const { newApiName } = req.body;
  const tenantId = req.tenantId;

  if (!newApiName) throw new AppError('"newApiName" is required.', 400);
  if (!/^[a-z][a-z0-9_]*$/.test(newApiName) || /__|_$/.test(newApiName)) {
    throw new AppError(
      'New API name must start with a lowercase letter and contain only lowercase letters, digits, and single underscores (no trailing or consecutive underscores).',
      400,
    );
  }
  if (newApiName === apiName) throw new AppError('New API name is the same as the current name.', 400);

  const obj = await ObjectMeta.findOne({ tenantId, apiName });
  if (!obj) throw new AppError(`Object "${apiName}" not found.`, 404);
  if (obj.isSystem) throw new AppError('System objects cannot be renamed.', 403);

  const conflict = await ObjectMeta.findOne({ tenantId, apiName: newApiName });
  if (conflict) throw new AppError(`An object with API name "${newApiName}" already exists.`, 409);

  // Migrate all dependent collections atomically where possible
  await ObjectMeta.updateOne({ tenantId, _id: obj._id }, { $set: { apiName: newApiName } });
  const { modifiedCount: fieldCount } = await FieldMeta.updateMany(
    { tenantId, objectApiName: apiName },
    { $set: { objectApiName: newApiName } },
  );
  const { modifiedCount: recordCount } = await DynamicRecord.updateMany(
    { tenantId, objectApiName: apiName },
    { $set: { objectApiName: newApiName } },
  );

  await audit({
    tenantId,
    userId: req.user._id,
    action: 'rename',
    resource: 'ObjectMeta',
    resourceId: obj._id,
    details: { from: apiName, to: newApiName, fieldCount, recordCount },
    req,
  });

  const updated = await ObjectMeta.findOne({ tenantId, apiName: newApiName });
  sendSuccess(
    res,
    { data: updated, migration: { fieldCount, recordCount } },
    `Object renamed from "${apiName}" to "${newApiName}". ${fieldCount} field reference(s) and ${recordCount} record(s) migrated.`,
  );
});

export { listObjects, getObject, createObject, updateObject, deleteObject, renameObject };
