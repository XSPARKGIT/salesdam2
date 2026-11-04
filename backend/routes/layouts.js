import express from 'express';
import mongoose from 'mongoose';
import Layout from '../models/Layout.js';
import LayoutAssignment from '../models/LayoutAssignment.js';
import ObjectMeta from '../models/ObjectMeta.js';
import FieldMeta from '../models/FieldMeta.js';
import Role from '../models/Role.js';
import DynamicRecord from '../models/DynamicRecord.js';
import { requireAuth } from '../middleware/auth.js';
import { enforceTenant } from '../middleware/tenant.js';
import { requireObjectMetadataAccess } from '../services/objectAccessService.js';
import { checkAppPermission, buildDataAccessFilter } from '../middleware/permissions.js';
import { resolveLayout } from '../services/layoutResolver.js';
import { asyncHandler, sendSuccess, AppError } from '../utils/errors.js';
import { audit } from '../utils/auditLogger.js';

const router = express.Router();

router.use(requireAuth, enforceTenant);

// Workspace isolation: only objects reachable from the active workspace.
router.param('objectApiName', requireObjectMetadataAccess);

// Get layouts for an object — always fresh, never cached
router.get('/:objectApiName', asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const { objectApiName } = req.params;
  const layouts = await Layout.find({ tenantId: req.tenantId, objectApiName })
    .populate('assignedRoles', 'name label')
    .sort({ isDefault: -1, name: 1 });
  sendSuccess(res, { data: layouts });
}));

// Get the layout the current user sees (BRD 4.2): the first matching
// conditional rule for their Role, else the Role's default, else the object's
// default. Pass recordId for an existing record; without it (a new record)
// conditional rules are skipped.
router.get('/:objectApiName/resolve', asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const { objectApiName } = req.params;
  const { recordId } = req.query;

  let record = null;
  if (recordId && mongoose.isValidObjectId(recordId)) {
    // Same visibility rules as reading the record itself, so a rule can't be
    // used to probe the values of a record the user can't see.
    const dataFilter = await buildDataAccessFilter(req.user, objectApiName);
    record = await DynamicRecord.findOne({
      _id: recordId,
      tenantId: req.tenantId,
      objectApiName,
      isDeleted: false,
      ...dataFilter,
    }).select('data').lean();
  }

  const { layout, source, ruleIndex } = await resolveLayout({
    tenantId: req.tenantId,
    objectApiName,
    user: req.user,
    record,
    type: req.query.type || 'detail',
  });

  sendSuccess(res, { data: layout, assignment: { source, ruleIndex: ruleIndex ?? null } });
}));

// ─── Layout assignment (per Role) ────────────────────────────────────────────

const RULE_OPERATORS = new Set(['eq', 'neq', 'is_set', 'is_blank']);
const MAX_RULES = 50;

// List every Role's assignment for an object.
router.get('/:objectApiName/assignments', checkAppPermission('canManageLayouts'), asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const assignments = await LayoutAssignment.find({
    tenantId: req.tenantId,
    objectApiName: req.params.objectApiName,
  }).lean();
  sendSuccess(res, { data: assignments });
}));

// Replace all of an object's assignments. Body:
//   { assignments: [{ roleId, defaultLayoutId, rules: [{ field, operator, value, layoutId }] }] }
// Rule order is priority order. A Role sent with no default and no rules, or
// left out, has its assignment removed and falls back to the object default.
router.put('/:objectApiName/assignments', checkAppPermission('canManageLayouts'), asyncHandler(async (req, res) => {
  const { objectApiName } = req.params;
  const tenantId = req.tenantId;
  const input = req.body?.assignments;
  if (!Array.isArray(input)) throw new AppError('assignments must be an array.', 400);

  const [layouts, fields, roles] = await Promise.all([
    Layout.find({ tenantId, objectApiName }).select('_id').lean(),
    FieldMeta.find({ tenantId, objectApiName }).select('apiName').lean(),
    Role.find({ tenantId }).select('_id').lean(),
  ]);
  const layoutIds = new Set(layouts.map((l) => String(l._id)));
  const fieldNames = new Set(fields.map((f) => f.apiName));
  const roleIds = new Set(roles.map((r) => String(r._id)));

  const seen = new Set();
  const clean = input.map((a, i) => {
    const where = `Assignment ${i + 1}`;
    const roleId = String(a?.roleId || '');
    if (!roleIds.has(roleId)) throw new AppError(`${where}: unknown role.`, 400);
    if (seen.has(roleId)) throw new AppError(`${where}: the role is listed more than once.`, 400);
    seen.add(roleId);

    const defaultLayoutId = a.defaultLayoutId ? String(a.defaultLayoutId) : null;
    if (defaultLayoutId && !layoutIds.has(defaultLayoutId)) {
      throw new AppError(`${where}: the default layout does not belong to this object.`, 400);
    }

    const rules = Array.isArray(a.rules) ? a.rules : [];
    if (rules.length > MAX_RULES) throw new AppError(`${where}: at most ${MAX_RULES} rules per role.`, 400);
    const cleanRules = rules.map((r, j) => {
      const at = `${where}, rule ${j + 1}`;
      const operator = r?.operator || 'eq';
      if (!RULE_OPERATORS.has(operator)) throw new AppError(`${at}: unknown operator.`, 400);
      if (!fieldNames.has(r?.field)) throw new AppError(`${at}: unknown field.`, 400);
      if (!layoutIds.has(String(r?.layoutId || ''))) {
        throw new AppError(`${at}: the layout does not belong to this object.`, 400);
      }
      const value = r.value === undefined || r.value === null ? '' : String(r.value).trim();
      if ((operator === 'eq' || operator === 'neq') && !value) {
        throw new AppError(`${at}: a value is required.`, 400);
      }
      return { field: r.field, operator, value, layoutId: String(r.layoutId) };
    });

    return { roleId, defaultLayoutId, rules: cleanRules };
  });

  const keep = clean.filter((a) => a.defaultLayoutId || a.rules.length > 0);
  await LayoutAssignment.deleteMany({
    tenantId,
    objectApiName,
    roleId: { $nin: keep.map((a) => a.roleId) },
  });
  await Promise.all(keep.map((a) =>
    LayoutAssignment.findOneAndUpdate(
      { tenantId, objectApiName, roleId: a.roleId },
      { $set: { defaultLayoutId: a.defaultLayoutId, rules: a.rules, lastModifiedBy: req.user._id } },
      { upsert: true, runValidators: true },
    ),
  ));

  const saved = await LayoutAssignment.find({ tenantId, objectApiName }).lean();

  await audit({
    tenantId,
    userId: req.user._id,
    action: 'layout_assignment_update',
    resource: 'LayoutAssignment',
    resourceId: objectApiName,
    objectApiName,
    details: { roleCount: keep.length },
    req,
  });

  sendSuccess(res, { data: saved }, 'Layout assignment saved');
}));

// Create layout
router.post('/', checkAppPermission('canManageLayouts'), asyncHandler(async (req, res) => {
  const { objectApiName } = req.body;
  const obj = await ObjectMeta.findOne({ tenantId: req.tenantId, apiName: objectApiName });
  if (!obj) throw new AppError(`Object "${objectApiName}" not found.`, 404);

  // If this is the first layout or marked default, unset others
  if (req.body.isDefault) {
    await Layout.updateMany(
      { tenantId: req.tenantId, objectApiName, type: req.body.type || 'detail' },
      { isDefault: false }
    );
  }

  const layout = await Layout.create({
    tenantId: req.tenantId,
    objectId: obj._id,
    createdBy: req.user._id,
    ...req.body,
  });

  await audit({
    tenantId: req.tenantId,
    userId: req.user._id,
    action: 'create',
    resource: 'Layout',
    resourceId: layout._id,
    objectApiName,
    req,
  });

  sendSuccess(res, { data: layout }, 'Layout created', 201);
}));

// Update layout
router.put('/:id', checkAppPermission('canManageLayouts'), asyncHandler(async (req, res) => {
  const layout = await Layout.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!layout) throw new AppError('Layout not found.', 404);

  if (req.body.isDefault && !layout.isDefault) {
    await Layout.updateMany(
      { tenantId: req.tenantId, objectApiName: layout.objectApiName, type: layout.type },
      { isDefault: false }
    );
  }

  const allowed = ['name', 'description', 'isDefault', 'assignedRoles', 'tabs', 'sections', 'useTabs', 'buttons', 'relatedLists'];
  allowed.forEach(k => { if (req.body[k] !== undefined) layout[k] = req.body[k]; });
  layout.lastModifiedBy = req.user._id;
  await layout.save();

  await audit({
    tenantId: req.tenantId,
    userId: req.user._id,
    action: 'update',
    resource: 'Layout',
    resourceId: layout._id,
    objectApiName: layout.objectApiName,
    details: { fields: allowed.filter((k) => req.body[k] !== undefined) },
    req,
  });

  sendSuccess(res, { data: layout }, 'Layout updated');
}));

// Delete layout
router.delete('/:id', checkAppPermission('canManageLayouts'), asyncHandler(async (req, res) => {
  const layout = await Layout.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!layout) throw new AppError('Layout not found.', 404);
  if (layout.isDefault) throw new AppError('Cannot delete the default layout.', 403);
  await Layout.deleteOne({ _id: layout._id });
  // Roles assigned to it fall back to the object default; its rules go.
  await LayoutAssignment.updateMany(
    { tenantId: req.tenantId, objectApiName: layout.objectApiName, defaultLayoutId: layout._id },
    { $set: { defaultLayoutId: null } },
  );
  await LayoutAssignment.updateMany(
    { tenantId: req.tenantId, objectApiName: layout.objectApiName },
    { $pull: { rules: { layoutId: layout._id } } },
  );

  await audit({
    tenantId: req.tenantId,
    userId: req.user._id,
    action: 'delete',
    resource: 'Layout',
    resourceId: layout._id,
    objectApiName: layout.objectApiName,
    details: { name: layout.name },
    req,
  });

  sendSuccess(res, {}, 'Layout deleted');
}));

export default router;
