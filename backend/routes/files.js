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

  // Enforce configured max file size (from TenantConfiguration or default 10MB)
  const { default: configurationService } = await import('../services/configurationService.js');
  const maxFileSizeMB = await configurationService.resolve('files.max_file_size_mb', req.tenantId, 10);
  const maxBytes = maxFileSizeMB * 1024 * 1024;
  if (file.size > maxBytes) {
    throw new AppError(`File exceeds maximum allowed size of ${maxFileSizeMB} MB.`, 400);
  }

  // Enforce configured allowed types
  const allowedTypes = await configurationService.resolve('files.allowed_types', req.tenantId, 'image/jpeg,image/png,image/gif,image/webp,application/pdf,text/plain');
  const allowedSet = new Set(String(allowedTypes).split(',').map((t) => t.trim()).filter(Boolean));
  if (!allowedSet.has(file.mimetype)) {
    throw new AppError(`File type "${file.mimetype}" is not permitted.`, 400);
  }

  // Enforce tenant storage limit
  const Tenant = (await import('../models/Tenant.js')).default;
  const tenant = await Tenant.findById(req.tenantId);
  if (tenant) {
    const allocatedMB = (tenant.limits?.storageGB || 1) * 1024;
    const usedMB = tenant.usage?.storageUsedMB || 0;
    const fileMB = file.size / (1024 * 1024);
    if (usedMB + fileMB > allocatedMB) {
      throw new AppError('Tenant storage limit exceeded.', 400);
    }
  }

  const name = sanitizeName(file.originalname);
  const data = file.buffer.toString('base64');

  // Scan the file before making it available
  const { scanFile } = await import('../services/fileScanService.js');
  const scanResult = await scanFile(file.buffer, file.mimetype, name);

  const isAvailable = scanResult.status === 'clean' || scanResult.status === 'skipped';

  const doc = await File.create({
    tenantId: req.tenantId,
    createdBy: req.user._id,
    name,
    mimeType: file.mimetype,
    data,
    sizeBytes: file.size,
    relatedTo: { objectApiName, recordId },
    scanStatus: scanResult.status,
    scanResult: scanResult.result,
    scannedAt: new Date(),
    isAvailable,
    version: 1,
  });

  // Update tenant storage usage
  if (tenant) {
    await Tenant.updateOne({ _id: req.tenantId }, { $inc: { 'usage.storageUsedMB': file.size / (1024 * 1024) } });
  }

  await audit({ tenantId: req.tenantId, userId: req.user._id, action: 'create', resource: 'File', resourceId: doc._id, req });
  sendSuccess(res, { data: { ...doc.toObject(), data: undefined } }, 'File uploaded', 201);
}));

// Storage usage summary (must come before /:id)
router.get('/storage-usage', asyncHandler(async (req, res) => {
  const Tenant = (await import('../models/Tenant.js')).default;
  const tenant = await Tenant.findById(req.tenantId).select('limits usage').lean();
  const allocatedMB = (tenant?.limits?.storageGB || 1) * 1024;
  const usedMB = tenant?.usage?.storageUsedMB || 0;
  sendSuccess(res, { data: { allocatedMB, usedMB, availableMB: Math.max(0, allocatedMB - usedMB), percentUsed: allocatedMB > 0 ? Math.round((usedMB / allocatedMB) * 100) : 0 } });
}));

// Get single file metadata
router.get('/:id', asyncHandler(async (req, res) => {
  const file = await File.findOne({ _id: req.params.id, tenantId: req.tenantId, isActive: true });
  if (!file) throw new AppError('File not found.', 404);
  if (file.relatedTo?.objectApiName) await checkRead(req.user, file.relatedTo.objectApiName);
  if (!file.isAvailable) throw new AppError('File is not available (pending scan or infected).', 403);
  sendSuccess(res, { data: { ...file.toObject(), data: undefined } });
}));

// Download
router.get('/:id/download', asyncHandler(async (req, res) => {
  const file = await File.findOne({ _id: req.params.id, tenantId: req.tenantId, isActive: true });
  if (!file) throw new AppError('File not found.', 404);
  if (file.relatedTo?.objectApiName) await checkRead(req.user, file.relatedTo.objectApiName);
  if (!file.isAvailable) throw new AppError('File is not available.', 403);
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
  if (!file.isAvailable) throw new AppError('File is not available.', 403);
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

  const oldSize = file.sizeBytes || 0;
  const oldVersion = file.version || 1;

  // Create a new version record instead of overwriting
  const newDoc = await File.create({
    tenantId: req.tenantId,
    createdBy: req.user._id,
    lastModifiedBy: req.user._id,
    name: sanitizeName(newFile.originalname),
    mimeType: newFile.mimetype,
    data: newFile.buffer.toString('base64'),
    sizeBytes: newFile.size,
    relatedTo: file.relatedTo,
    version: oldVersion + 1,
    supersedes: file._id,
    scanStatus: 'skipped',
    scanResult: 'No scanner configured.',
    isAvailable: true,
  });

  // Mark old file as superseded
  file.isActive = false;
  file.supersededBy = newDoc._id;
  file.lastModifiedBy = req.user._id;
  await file.save();

  // Adjust tenant storage usage
  const TenantModel = (await import('../models/Tenant.js')).default;
  const delta = (req.file.size - oldSize) / (1024 * 1024);
  await TenantModel.updateOne({ _id: req.tenantId }, { $inc: { 'usage.storageUsedMB': delta } });

  await audit({ tenantId: req.tenantId, userId: req.user._id, action: 'update', resource: 'File', resourceId: newDoc._id, req });
  sendSuccess(res, { data: { ...newDoc.toObject(), data: undefined } }, 'File replaced');
}));

// Soft-delete
router.delete('/:id', asyncHandler(async (req, res) => {
  const file = await File.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!file) throw new AppError('File not found.', 404);
  if (file.relatedTo?.objectApiName) await checkWrite(req.user, file.relatedTo.objectApiName);
  file.isActive = false;
  file.lastModifiedBy = req.user._id;
  await file.save();
  // Decrement tenant storage usage
  if (file.sizeBytes) {
    const Tenant = (await import('../models/Tenant.js')).default;
    await Tenant.updateOne({ _id: req.tenantId }, { $inc: { 'usage.storageUsedMB': -(file.sizeBytes / (1024 * 1024)) } });
  }
  await audit({ tenantId: req.tenantId, userId: req.user._id, action: 'delete', resource: 'File', resourceId: file._id, req });
  sendSuccess(res, {}, 'File deleted');
}));

// Get version history for a file
router.get('/:id/versions', asyncHandler(async (req, res) => {
  const file = await File.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!file) throw new AppError('File not found.', 404);
  if (file.relatedTo?.objectApiName) await checkRead(req.user, file.relatedTo.objectApiName);

  // Walk the version chain
  const versions = [];
  let current = file;
  // Find the latest version (walk supersededBy chain)
  let latest = file;
  while (latest.supersededBy) {
    const next = await File.findOne({ _id: latest.supersededBy, tenantId: req.tenantId });
    if (!next) break;
    latest = next;
  }
  // Walk back via supersedes
  const chain = [];
  let cur = latest;
  while (cur) {
    chain.unshift(cur);
    if (cur.supersedes) {
      cur = await File.findOne({ _id: cur.supersedes, tenantId: req.tenantId });
    } else {
      cur = null;
    }
  }
  const result = chain.map((f) => ({ _id: f._id, name: f.name, version: f.version, sizeBytes: f.sizeBytes, mimeType: f.mimeType, isActive: f.isActive, isAvailable: f.isAvailable, scanStatus: f.scanStatus, createdAt: f.createdAt, createdBy: f.createdBy }));
  sendSuccess(res, { data: result });
}));

export default router;
