import GlobalValueSet from '../models/GlobalValueSet.js';
import FieldMeta from '../models/FieldMeta.js';
import { asyncHandler, sendSuccess, AppError } from '../utils/errors.js';
import { audit } from '../utils/auditLogger.js';

/**
 * GET /api/global-value-sets
 */
export const listGlobalValueSets = asyncHandler(async (req, res) => {
  const sets = await GlobalValueSet.find({ tenantId: req.tenantId }).sort({ label: 1 });
  sendSuccess(res, { data: sets });
});

/**
 * GET /api/global-value-sets/:id
 */
export const getGlobalValueSet = asyncHandler(async (req, res) => {
  const gvs = await GlobalValueSet.findOne({
    _id: req.params.id,
    tenantId: req.tenantId,
  });
  if (!gvs) throw new AppError('Global value set not found.', 404);
  sendSuccess(res, { data: gvs });
});

/**
 * POST /api/global-value-sets
 */
export const createGlobalValueSet = asyncHandler(async (req, res) => {
  const { name, label, description, values } = req.body;
  if (!name) throw new AppError('name is required.', 400);
  if (!label) throw new AppError('label is required.', 400);

  const existing = await GlobalValueSet.findOne({ tenantId: req.tenantId, name });
  if (existing) throw new AppError(`A global value set named "${name}" already exists.`, 409);

  const gvs = await GlobalValueSet.create({
    tenantId: req.tenantId,
    name,
    label,
    description,
    values: values || [],
    createdBy: req.user._id,
  });

  await audit({
    tenantId: req.tenantId,
    userId: req.user._id,
    action: 'create',
    resource: 'GlobalValueSet',
    resourceId: gvs._id,
    req,
  });

  sendSuccess(res, { data: gvs }, 'Global value set created successfully', 201);
});

/**
 * PUT /api/global-value-sets/:id
 *
 * Updates the set and fans out the new values to every linked FieldMeta so
 * all dependent picklist fields stay in sync (PICK-002).
 */
export const updateGlobalValueSet = asyncHandler(async (req, res) => {
  const gvs = await GlobalValueSet.findOne({
    _id: req.params.id,
    tenantId: req.tenantId,
  });
  if (!gvs) throw new AppError('Global value set not found.', 404);

  const allowedUpdates = ['label', 'description', 'values', 'isActive'];
  allowedUpdates.forEach((key) => {
    if (req.body[key] !== undefined) gvs[key] = req.body[key];
  });
  gvs.lastModifiedBy = req.user._id;
  await gvs.save();

  // Fan-out: push the updated values to every picklist/multipicklist field that
  // references this GlobalValueSet. The synced copy keeps field-level data
  // consistent without requiring runtime joins.
  if (req.body.values !== undefined) {
    await FieldMeta.updateMany(
      {
        tenantId: req.tenantId,
        globalValueSetId: gvs._id,
        type: { $in: ['picklist', 'multipicklist'] },
      },
      { $set: { picklistValues: gvs.values } },
    );
  }

  await audit({
    tenantId: req.tenantId,
    userId: req.user._id,
    action: 'update',
    resource: 'GlobalValueSet',
    resourceId: gvs._id,
    req,
  });

  sendSuccess(res, { data: gvs }, 'Global value set updated successfully');
});

/**
 * DELETE /api/global-value-sets/:id
 *
 * Soft-blocks deletion when linked fields exist — the admin must unlink them
 * first or pass ?force=true to detach and delete.
 */
export const deleteGlobalValueSet = asyncHandler(async (req, res) => {
  const gvs = await GlobalValueSet.findOne({
    _id: req.params.id,
    tenantId: req.tenantId,
  });
  if (!gvs) throw new AppError('Global value set not found.', 404);

  const linkedCount = await FieldMeta.countDocuments({
    tenantId: req.tenantId,
    globalValueSetId: gvs._id,
  });

  if (linkedCount > 0 && req.query.force !== 'true') {
    throw new AppError(
      `Cannot delete: ${linkedCount} field(s) reference this value set. ` +
        'Unlink them first or pass ?force=true to detach and delete.',
      409,
    );
  }

  if (linkedCount > 0) {
    // Detach all linked fields; their copied picklistValues are kept as-is.
    await FieldMeta.updateMany(
      { tenantId: req.tenantId, globalValueSetId: gvs._id },
      { $set: { globalValueSetId: null } },
    );
  }

  await GlobalValueSet.deleteOne({ _id: gvs._id });

  await audit({
    tenantId: req.tenantId,
    userId: req.user._id,
    action: 'delete',
    resource: 'GlobalValueSet',
    resourceId: gvs._id,
    req,
  });

  sendSuccess(res, {}, 'Global value set deleted successfully');
});

/**
 * POST /api/global-value-sets/:id/link
 *
 * Links an existing picklist/multipicklist field to this GlobalValueSet and
 * immediately copies the set's current values into the field.
 *
 * Body: { objectApiName, fieldApiName }
 */
export const linkField = asyncHandler(async (req, res) => {
  const gvs = await GlobalValueSet.findOne({
    _id: req.params.id,
    tenantId: req.tenantId,
  });
  if (!gvs) throw new AppError('Global value set not found.', 404);

  const { objectApiName, fieldApiName } = req.body;
  if (!objectApiName || !fieldApiName) {
    throw new AppError('objectApiName and fieldApiName are required.', 400);
  }

  const field = await FieldMeta.findOne({
    tenantId: req.tenantId,
    objectApiName,
    apiName: fieldApiName,
  });
  if (!field) throw new AppError(`Field "${fieldApiName}" not found on "${objectApiName}".`, 404);
  if (!['picklist', 'multipicklist'].includes(field.type)) {
    throw new AppError('Only picklist and multipicklist fields can be linked to a global value set.', 400);
  }

  field.globalValueSetId = gvs._id;
  field.picklistValues = gvs.values;
  await field.save();

  sendSuccess(res, { data: field }, 'Field linked to global value set');
});

/**
 * POST /api/global-value-sets/:id/unlink
 *
 * Detaches a field from this GlobalValueSet. Existing picklistValues are
 * kept as an independent inline copy.
 *
 * Body: { objectApiName, fieldApiName }
 */
export const unlinkField = asyncHandler(async (req, res) => {
  const gvs = await GlobalValueSet.findOne({
    _id: req.params.id,
    tenantId: req.tenantId,
  });
  if (!gvs) throw new AppError('Global value set not found.', 404);

  const { objectApiName, fieldApiName } = req.body;
  if (!objectApiName || !fieldApiName) {
    throw new AppError('objectApiName and fieldApiName are required.', 400);
  }

  const field = await FieldMeta.findOne({
    tenantId: req.tenantId,
    objectApiName,
    apiName: fieldApiName,
    globalValueSetId: gvs._id,
  });
  if (!field) {
    throw new AppError(`Field "${fieldApiName}" is not linked to this global value set.`, 404);
  }

  field.globalValueSetId = null;
  await field.save();

  sendSuccess(res, { data: field }, 'Field unlinked from global value set');
});
