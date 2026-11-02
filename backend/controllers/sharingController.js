import ObjectSharingSetting from '../models/ObjectSharingSetting.js';
import SharingRule from '../models/SharingRule.js';
import ObjectMeta from '../models/ObjectMeta.js';
import Role from '../models/Role.js';
import ApproverGroup from '../models/ApproverGroup.js';
import User from '../models/User.js';
import { asyncHandler, sendSuccess, AppError } from '../utils/errors.js';

const OWD_VALUES = ['private', 'public_read_only', 'public_read_write'];

/**
 * GET /api/sharing/settings
 * Returns every object with its effective OWD (explicit or legacy default).
 */
export const listSharingSettings = asyncHandler(async (req, res) => {
  const [objects, settings] = await Promise.all([
    ObjectMeta.find({ tenantId: req.tenantId, isActive: true })
      .select('apiName label pluralLabel nameFieldApiName')
      .sort({ label: 1 })
      .lean(),
    ObjectSharingSetting.find({ tenantId: req.tenantId }).lean(),
  ]);

  const byObject = new Map(
    settings.map((s) => [s.objectApiName, s]),
  );

  const data = objects.map((o) => ({
    objectApiName: o.apiName,
    label: o.label,
    pluralLabel: o.pluralLabel,
    orgWideDefault: byObject.get(o.apiName)?.orgWideDefault || 'private',
    configured: byObject.has(o.apiName),
  }));

  sendSuccess(res, { data });
});

/**
 * PUT /api/sharing/settings/:objectApiName
 * Body: { orgWideDefault }
 */
export const updateSharingSetting = asyncHandler(async (req, res) => {
  const { objectApiName } = req.params;
  const { orgWideDefault } = req.body || {};

  if (!OWD_VALUES.includes(orgWideDefault)) {
    throw new AppError(
      `orgWideDefault must be one of: ${OWD_VALUES.join(', ')}.`,
      400,
    );
  }

  const obj = await ObjectMeta.findOne({ tenantId: req.tenantId, apiName: objectApiName });
  if (!obj) throw new AppError(`Object "${objectApiName}" not found.`, 404);

  const setting = await ObjectSharingSetting.findOneAndUpdate(
    { tenantId: req.tenantId, objectApiName },
    { $set: { orgWideDefault, updatedBy: req.user._id } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );

  sendSuccess(res, { data: setting }, 'Sharing setting saved');
});

/**
 * GET /api/sharing/rules?objectApiName=policy
 */
export const listSharingRules = asyncHandler(async (req, res) => {
  const { objectApiName } = req.query;
  const query = { tenantId: req.tenantId };
  if (objectApiName) query.objectApiName = objectApiName;

  const rules = await SharingRule.find(query)
    .sort({ createdAt: -1 })
    .lean();

  sendSuccess(res, { data: rules });
});

/** The options an admin can target: teams (roles), public groups, users. */
export const listSharingTargets = asyncHandler(async (req, res) => {
  const [roles, groups, users] = await Promise.all([
    Role.find({ tenantId: req.tenantId }).select('name label').sort({ label: 1 }).lean(),
    ApproverGroup.find({ tenantId: req.tenantId }).select('name label').sort({ label: 1 }).lean(),
    User.find({ tenantId: req.tenantId, status: 'active' })
      .select('firstName lastName email')
      .sort({ firstName: 1 })
      .lean(),
  ]);

  sendSuccess(res, {
    data: {
      roles: roles.map((r) => ({ id: r._id, name: r.name, label: r.label || r.name })),
      groups: groups.map((g) => ({ id: g._id, name: g.name, label: g.label || g.name })),
      users: users.map((u) => ({
        id: u._id,
        name: `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email,
        email: u.email,
      })),
    },
  });
});

const validateTarget = async (tenantId, sharedWith) => {
  if (!sharedWith || !['role', 'group', 'user'].includes(sharedWith.type)) {
    throw new AppError('sharedWith.type must be role, group or user.', 400);
  }
  if (!sharedWith.id) throw new AppError('sharedWith.id is required.', 400);

  const Model =
    sharedWith.type === 'role' ? Role : sharedWith.type === 'group' ? ApproverGroup : User;
  const exists = await Model.exists({ _id: sharedWith.id, tenantId });
  if (!exists) throw new AppError('Sharing target not found.', 400);
};

/**
 * POST /api/sharing/rules
 */
export const createSharingRule = asyncHandler(async (req, res) => {
  const {
    objectApiName,
    name,
    description,
    ruleType = 'criteria',
    criteria = [],
    sharedWith,
    accessLevel = 'read',
    isActive = true,
  } = req.body || {};

  if (!objectApiName) throw new AppError('objectApiName is required.', 400);
  if (!name?.trim()) throw new AppError('name is required.', 400);
  if (!['read', 'readWrite'].includes(accessLevel)) {
    throw new AppError('accessLevel must be read or readWrite.', 400);
  }
  if (!['all', 'criteria'].includes(ruleType)) {
    throw new AppError('ruleType must be all or criteria.', 400);
  }
  if (ruleType === 'criteria' && !Array.isArray(criteria)) {
    throw new AppError('criteria must be an array.', 400);
  }
  if (
    ruleType === 'criteria' &&
    !criteria.some((c) => c && String(c.field || '').trim())
  ) {
    throw new AppError('A criteria sharing rule requires at least one field.', 400);
  }

  const obj = await ObjectMeta.findOne({ tenantId: req.tenantId, apiName: objectApiName });
  if (!obj) throw new AppError(`Object "${objectApiName}" not found.`, 404);

  await validateTarget(req.tenantId, sharedWith);

  const rule = await SharingRule.create({
    tenantId: req.tenantId,
    objectApiName,
    name: name.trim(),
    description,
    ruleType,
    criteria: criteria.map((c) => ({
      field: c.field,
      operator: c.operator || 'eq',
      value: c.value,
    })),
    sharedWith,
    accessLevel,
    isActive,
    createdBy: req.user._id,
  });

  sendSuccess(res, { data: rule }, 'Sharing rule created');
});

/**
 * PUT /api/sharing/rules/:id
 */
export const updateSharingRule = asyncHandler(async (req, res) => {
  const rule = await SharingRule.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!rule) throw new AppError('Sharing rule not found.', 404);

  const {
    name,
    description,
    ruleType,
    criteria,
    sharedWith,
    accessLevel,
    isActive,
    objectApiName,
  } = req.body || {};

  if (objectApiName && objectApiName !== rule.objectApiName) {
    const obj = await ObjectMeta.findOne({ tenantId: req.tenantId, apiName: objectApiName });
    if (!obj) throw new AppError(`Object "${objectApiName}" not found.`, 404);
    rule.objectApiName = objectApiName;
  }
  if (sharedWith) await validateTarget(req.tenantId, sharedWith);
  if (accessLevel && !['read', 'readWrite'].includes(accessLevel)) {
    throw new AppError('accessLevel must be read or readWrite.', 400);
  }
  if (ruleType !== undefined && !['all', 'criteria'].includes(ruleType)) {
    throw new AppError('ruleType must be all or criteria.', 400);
  }
  const effectiveRuleType = ruleType ?? rule.ruleType;
  const effectiveCriteria = criteria !== undefined ? criteria : rule.criteria;
  if (
    effectiveRuleType === 'criteria' &&
    !(effectiveCriteria || []).some((c) => c && String(c.field || '').trim())
  ) {
    throw new AppError('A criteria sharing rule requires at least one field.', 400);
  }

  if (name !== undefined) rule.name = name.trim();
  if (description !== undefined) rule.description = description;
  if (ruleType !== undefined) rule.ruleType = ruleType;
  if (criteria !== undefined) {
    rule.criteria = (criteria || []).map((c) => ({
      field: c.field,
      operator: c.operator || 'eq',
      value: c.value,
    }));
  }
  if (sharedWith !== undefined) rule.sharedWith = sharedWith;
  if (accessLevel !== undefined) rule.accessLevel = accessLevel;
  if (isActive !== undefined) rule.isActive = isActive;

  await rule.save();
  sendSuccess(res, { data: rule }, 'Sharing rule updated');
});

/**
 * DELETE /api/sharing/rules/:id
 */
export const deleteSharingRule = asyncHandler(async (req, res) => {
  const rule = await SharingRule.findOneAndDelete({
    _id: req.params.id,
    tenantId: req.tenantId,
  });
  if (!rule) throw new AppError('Sharing rule not found.', 404);
  sendSuccess(res, { data: { id: rule._id } }, 'Sharing rule deleted');
});
