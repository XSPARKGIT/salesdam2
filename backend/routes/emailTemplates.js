import express from 'express';
import EmailTemplate from '../models/EmailTemplate.js';
import { requireAuth } from '../middleware/auth.js';
import { enforceTenant } from '../middleware/tenant.js';
import { checkAppPermission } from '../middleware/permissions.js';
import { asyncHandler, sendSuccess, AppError } from '../utils/errors.js';

const router = express.Router();
router.use(requireAuth, enforceTenant);

// GET  /api/email-templates?category=Sales&search=welcome
router.get('/', asyncHandler(async (req, res) => {
  const { category, search, active } = req.query;
  const filter = { tenantId: req.tenantId };
  if (category) filter.category = category;
  if (active !== undefined) filter.isActive = active !== 'false';
  if (search) {
    filter.$or = [
      { name:    { $regex: search, $options: 'i' } },
      { subject: { $regex: search, $options: 'i' } },
    ];
  }
  const templates = await EmailTemplate.find(filter)
    .select('-bodyHtml -bodyText')   // omit heavy body fields from list
    .sort({ category: 1, name: 1 });
  sendSuccess(res, { data: templates });
}));

// GET /api/email-templates/categories  — distinct category list
router.get('/categories', asyncHandler(async (req, res) => {
  const cats = await EmailTemplate.distinct('category', { tenantId: req.tenantId });
  sendSuccess(res, { data: cats.filter(Boolean).sort() });
}));

// GET /api/email-templates/:id
router.get('/:id', asyncHandler(async (req, res) => {
  const tmpl = await EmailTemplate.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!tmpl) throw new AppError('Template not found.', 404);
  sendSuccess(res, { data: tmpl });
}));

// POST /api/email-templates
router.post('/', checkAppPermission('canManageCommunicationTemplates'), asyncHandler(async (req, res) => {
  const { name, subject, bodyText, bodyHtml, category, description, tags } = req.body;
  if (!name || !subject) throw new AppError('name and subject are required.', 400);

  const tmpl = await EmailTemplate.create({
    tenantId: req.tenantId,
    name, subject, bodyText, bodyHtml,
    category: category || 'General',
    description, tags,
    createdBy: req.user._id,
  });
  sendSuccess(res, { data: tmpl }, 'Template created', 201);
}));

// PUT /api/email-templates/:id
router.put('/:id', checkAppPermission('canManageCommunicationTemplates'), asyncHandler(async (req, res) => {
  const tmpl = await EmailTemplate.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!tmpl) throw new AppError('Template not found.', 404);

  const allowed = ['name', 'subject', 'bodyText', 'bodyHtml', 'category', 'description', 'tags', 'isActive'];
  allowed.forEach(k => { if (req.body[k] !== undefined) tmpl[k] = req.body[k]; });
  tmpl.lastModifiedBy = req.user._id;
  await tmpl.save();
  sendSuccess(res, { data: tmpl }, 'Template updated');
}));

// DELETE /api/email-templates/:id
router.delete('/:id', checkAppPermission('canManageCommunicationTemplates'), asyncHandler(async (req, res) => {
  await EmailTemplate.deleteOne({ _id: req.params.id, tenantId: req.tenantId });
  sendSuccess(res, {}, 'Template deleted');
}));

// POST /api/email-templates/:id/preview
// Body: { fields: { name: "John", company: "Acme" } }
// Returns the subject/body with merge tokens resolved
router.post('/:id/preview', asyncHandler(async (req, res) => {
  const tmpl = await EmailTemplate.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!tmpl) throw new AppError('Template not found.', 404);

  const data = req.body.fields || {};
  const interp = (str) => (str || '').replace(/\{(\w+)\}/g, (_, k) => data[k] ?? `{${k}}`);

  sendSuccess(res, {
    data: {
      subject:  interp(tmpl.subject),
      bodyText: interp(tmpl.bodyText),
      bodyHtml: interp(tmpl.bodyHtml),
    },
  });
}));

export default router;
