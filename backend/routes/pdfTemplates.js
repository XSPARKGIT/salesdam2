import express from 'express';
import PdfTemplate from '../models/PdfTemplate.js';
import { requireAuth } from '../middleware/auth.js';
import { enforceTenant } from '../middleware/tenant.js';
import { checkAppPermission } from '../middleware/permissions.js';
import { asyncHandler, sendSuccess, AppError, paginate } from '../utils/errors.js';
import { audit } from '../utils/auditLogger.js';

const router = express.Router();

router.use(requireAuth, enforceTenant);

// List
router.get('/', asyncHandler(async (req, res) => {
  const { page = 1, limit = 50, search, category } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);
  const query = { tenantId: req.tenantId };
  if (category) query.category = category;
  if (search) query.name = { $regex: search, $options: 'i' };

  const [templates, total] = await Promise.all([
    PdfTemplate.find(query).select('-blocks').sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)),
    PdfTemplate.countDocuments(query),
  ]);
  sendSuccess(res, paginate(templates, total, page, limit));
}));

// Categories
router.get('/categories', asyncHandler(async (req, res) => {
  const cats = await PdfTemplate.distinct('category', { tenantId: req.tenantId });
  sendSuccess(res, { data: cats.filter(Boolean).sort() });
}));

// Get single (full, including blocks)
router.get('/:id', asyncHandler(async (req, res) => {
  const tmpl = await PdfTemplate.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!tmpl) throw new AppError('PDF template not found.', 404);
  sendSuccess(res, { data: tmpl });
}));

// Create
router.post('/', checkAppPermission('canManageDocumentTemplates'), asyncHandler(async (req, res) => {
  const { apiName } = req.body;
  if (!apiName) throw new AppError('apiName is required.', 400);
  const existing = await PdfTemplate.findOne({ tenantId: req.tenantId, apiName });
  if (existing) throw new AppError(`PDF template "${apiName}" already exists.`, 409);

  const tmpl = await PdfTemplate.create({
    tenantId: req.tenantId,
    createdBy: req.user._id,
    ...req.body,
  });
  await audit({ tenantId: req.tenantId, userId: req.user._id, action: 'create', resource: 'PdfTemplate', resourceId: tmpl._id, req });
  sendSuccess(res, { data: tmpl }, 'PDF template created', 201);
}));

// Update
router.put('/:id', checkAppPermission('canManageDocumentTemplates'), asyncHandler(async (req, res) => {
  const tmpl = await PdfTemplate.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!tmpl) throw new AppError('PDF template not found.', 404);

  const { apiName } = req.body;
  if (apiName && apiName !== tmpl.apiName) {
    const clash = await PdfTemplate.findOne({ tenantId: req.tenantId, apiName, _id: { $ne: tmpl._id } });
    if (clash) throw new AppError(`API name "${apiName}" is already in use.`, 409);
  }

  Object.assign(tmpl, { ...req.body, lastModifiedBy: req.user._id });
  await tmpl.save();
  await audit({ tenantId: req.tenantId, userId: req.user._id, action: 'update', resource: 'PdfTemplate', resourceId: tmpl._id, req });
  sendSuccess(res, { data: tmpl });
}));

// Delete
router.delete('/:id', checkAppPermission('canManageDocumentTemplates'), asyncHandler(async (req, res) => {
  const tmpl = await PdfTemplate.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!tmpl) throw new AppError('PDF template not found.', 404);
  await tmpl.deleteOne();
  await audit({ tenantId: req.tenantId, userId: req.user._id, action: 'delete', resource: 'PdfTemplate', resourceId: tmpl._id, req });
  sendSuccess(res, {}, 'PDF template deleted');
}));

// Duplicate
router.post('/:id/duplicate', checkAppPermission('canManageDocumentTemplates'), asyncHandler(async (req, res) => {
  const src = await PdfTemplate.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!src) throw new AppError('PDF template not found.', 404);

  const base = src.apiName.replace(/_copy\d*$/, '');
  let newApiName = `${base}_copy`;
  let counter = 1;
  while (await PdfTemplate.findOne({ tenantId: req.tenantId, apiName: newApiName })) {
    newApiName = `${base}_copy${++counter}`;
  }

  const copy = await PdfTemplate.create({
    tenantId:     req.tenantId,
    createdBy:    req.user._id,
    name:         `${src.name} (Copy)`,
    apiName:      newApiName,
    description:  src.description,
    category:     src.category,
    pageSettings: src.pageSettings,
    inputs:       src.inputs,
    blocks:       src.blocks,
  });
  sendSuccess(res, { data: copy }, 'PDF template duplicated', 201);
}));

export default router;
