import express from 'express';
import multer from 'multer';
import File from '../models/File.js';
import DynamicRecord from '../models/DynamicRecord.js';
import { requireAuth } from '../middleware/auth.js';
import { enforceTenant } from '../middleware/tenant.js';
import { hasObjectPermission } from '../middleware/permissions.js';
import { asyncHandler, sendSuccess, AppError, paginate } from '../utils/errors.js';
import { audit } from '../utils/auditLogger.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.use(requireAuth, enforceTenant);

const ALLOWED_MIMES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf', 'text/plain',
]);

const sanitizeName = (name) => String(name || 'file').replace(/[^\w.\-]/g, '_').slice(0, 255);

const resolveRecord = async (tenantId, objectApiName, recordId) => {
  if (!objectApiName || !recordId) throw new AppError('objectApiName and recordId are required.', 400);
  const record = await DynamicRecord.findOne({ _id: recordId, tenantId, objectApiName, isDeleted: false });
  if (!record) throw new AppError('Record not found.', 404);
  return record;
};

const checkRead = async (user, objectApiName) => {
  if (!(await hasObjectPermission(user, 'read', objectApiName))) throw new AppError('Permission denied.', 403);
};

const checkWrite = async (user, objectApiName) => {
  if (!(await hasObjectPermission(user, 'update', objectApiName))) throw new AppError('Permission denied.', 403);
};

// List attachments for a record
router.get('/', asyncHandler(async (req, res) => {
  const { page = 1, limit = 50, objectApiName, recordId } = req.query;
  if (objectApiName) await checkRead(req.user, objectApiName);
  if (objectApiName && recordId) await resolveRecord(req.tenantId, objectApiName, recordId);

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const query = { tenantId: req.tenantId, isActive: true };
  if (objectApiName) query['relatedTo.objectApiName'] = objectApiName;
  if (recordId) query['relatedTo.recordId'] = recordId;

  const [files, total] = await Promise.all([
    File.find(query).select('-data').sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)),
    File.countDocuments(query),
  ]);
  sendSuccess(res, paginate(files, total, page, limit));
}));

// Upload (multipart)
router.post('/upload', upload.single('file'), asyncHandler(async (req, res) => {
  const { objectApiName, recordId } = req.body;
  await checkWrite(req.user, objectApiName);
  await resolveRecord(req.tenantId, objectApiName, recordId);

  const file = req.file;
  if (!file) throw new AppError('file is required.', 400);
  if (!ALLOWED_MIMES.has(file.mimetype)) throw new AppError('Unsupported file type.', 400);

  const name = sanitizeName(file.originalname);
  const data = file.buffer.toString('base64');
  const doc = await File.create({
    tenantId: req.tenantId,
    createdBy: req.user._id,
    name,
    mimeType: file.mimetype,
    data,
    sizeBytes: file.size,
    relatedTo: { objectApiName, recordId },
  });
  await audit({ tenantId: req.tenantId, userId: req.user._id, action: 'create', resource: 'File', resourceId: doc._id, req });
  sendSuccess(res, { data: { ...doc.toObject(), data: undefined } }, 'File uploaded', 201);
}));

// Get single file metadata
router.get('/:id', asyncHandler(async (req, res) => {
  const file = await File.findOne({ _id: req.params.id, tenantId: req.tenantId, isActive: true });
  if (!file) throw new AppError('File not found.', 404);
  if (file.relatedTo?.objectApiName) await checkRead(req.user, file.relatedTo.objectApiName);
  sendSuccess(res, { data: { ...file.toObject(), data: undefined } });
}));

// Download
router.get('/:id/download', asyncHandler(async (req, res) => {
  const file = await File.findOne({ _id: req.params.id, tenantId: req.tenantId, isActive: true });
  if (!file) throw new AppError('File not found.', 404);
  if (file.relatedTo?.objectApiName) await checkRead(req.user, file.relatedTo.objectApiName);
  const buf = Buffer.from(file.data || '', 'base64');
  res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${sanitizeName(file.name)}"`);
  res.setHeader('Content-Length', String(buf.length));
  res.send(buf);
}));

// Preview (inline) for supported types
router.get('/:id/preview', asyncHandler(async (req, res) => {
  const file = await File.findOne({ _id: req.params.id, tenantId: req.tenantId, isActive: true });
  if (!file) throw new AppError('File not found.', 404);
  if (file.relatedTo?.objectApiName) await checkRead(req.user, file.relatedTo.objectApiName);
  const buf = Buffer.from(file.data || '', 'base64');
  res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${sanitizeName(file.name)}"`);
  res.setHeader('Content-Length', String(buf.length));
  res.send(buf);
}));

// Replace
router.put('/:id/replace', upload.single('file'), asyncHandler(async (req, res) => {
  const file = await File.findOne({ _id: req.params.id, tenantId: req.tenantId, isActive: true });
  if (!file) throw new AppError('File not found.', 404);
  if (file.relatedTo?.objectApiName) await checkWrite(req.user, file.relatedTo.objectApiName);

  const newFile = req.file;
  if (!newFile) throw new AppError('file is required.', 400);
  if (!ALLOWED_MIMES.has(newFile.mimetype)) throw new AppError('Unsupported file type.', 400);

  file.name = sanitizeName(newFile.originalname);
  file.mimeType = newFile.mimetype;
  file.data = newFile.buffer.toString('base64');
  file.sizeBytes = newFile.size;
  file.lastModifiedBy = req.user._id;
  await file.save();
  await audit({ tenantId: req.tenantId, userId: req.user._id, action: 'update', resource: 'File', resourceId: file._id, req });
  sendSuccess(res, { data: { ...file.toObject(), data: undefined } }, 'File replaced');
}));

// Soft-delete
router.delete('/:id', asyncHandler(async (req, res) => {
  const file = await File.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!file) throw new AppError('File not found.', 404);
  if (file.relatedTo?.objectApiName) await checkWrite(req.user, file.relatedTo.objectApiName);
  file.isActive = false;
  file.lastModifiedBy = req.user._id;
  await file.save();
  await audit({ tenantId: req.tenantId, userId: req.user._id, action: 'delete', resource: 'File', resourceId: file._id, req });
  sendSuccess(res, {}, 'File deleted');
}));

export default router;
