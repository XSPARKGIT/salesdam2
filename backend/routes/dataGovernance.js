import express from 'express';
import RetentionRule from '../models/RetentionRule.js';
import BackupJob from '../models/BackupJob.js';
import dataGovernanceService from '../services/dataGovernanceService.js';
import { requireAuth } from '../middleware/auth.js';
import { enforceTenant } from '../middleware/tenant.js';
import { checkAppPermission } from '../middleware/permissions.js';
import { asyncHandler, sendSuccess, AppError } from '../utils/errors.js';

const router = express.Router();
router.use(requireAuth, enforceTenant);

// Retention rules
router.get('/retention-rules', checkAppPermission('canManageTenantSettings'), asyncHandler(async (req, res) => {
  const rules = await RetentionRule.find({ tenantId: { $in: [req.tenantId, null] } }).sort({ category: 1 });
  sendSuccess(res, { data: rules });
}));

router.put('/retention-rules/:category', checkAppPermission('canManageTenantSettings'), asyncHandler(async (req, res) => {
  const { retentionDays, enabled, description } = req.body || {};
  if (!retentionDays || retentionDays < 1) throw new AppError('retentionDays must be >= 1.', 400);
  const rule = await RetentionRule.findOneAndUpdate(
    { tenantId: req.tenantId, category: req.params.category },
    { $set: { retentionDays, enabled: enabled !== false, description: description || '', createdBy: req.user._id } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  sendSuccess(res, { data: rule }, 'Retention rule saved');
}));

router.post('/retention/enforce', checkAppPermission('canManageTenantSettings'), asyncHandler(async (req, res) => {
  const { category } = req.body || {};
  if (!category) throw new AppError('category is required.', 400);
  const result = await dataGovernanceService.enforceRetention(req.tenantId, category);
  sendSuccess(res, { data: result }, 'Retention enforced');
}));

// Backups
router.get('/backups', checkAppPermission('canManageTenantSettings'), asyncHandler(async (req, res) => {
  const jobs = await BackupJob.find({ tenantId: req.tenantId }).sort({ createdAt: -1 }).limit(50);
  sendSuccess(res, { data: jobs });
}));

router.post('/backups', checkAppPermission('canManageTenantSettings'), asyncHandler(async (req, res) => {
  const { type = 'full' } = req.body || {};
  const job = await dataGovernanceService.createBackup(req.tenantId, type, req.user);
  sendSuccess(res, { data: job }, 'Backup created', 201);
}));

router.post('/backups/:id/restore', checkAppPermission('canManageTenantSettings'), asyncHandler(async (req, res) => {
  const result = await dataGovernanceService.restoreBackup(req.params.id, req.tenantId, req.user);
  sendSuccess(res, { data: result }, 'Backup restored');
}));

router.post('/anonymise', checkAppPermission('canManageTenantSettings'), asyncHandler(async (req, res) => {
  const { objectApiName, recordIds } = req.body || {};
  if (!objectApiName || !Array.isArray(recordIds) || recordIds.length === 0) {
    throw new AppError('objectApiName and recordIds array are required.', 400);
  }
  const result = await dataGovernanceService.anonymiseRecords(req.tenantId, objectApiName, recordIds, req.user);
  sendSuccess(res, { data: result }, 'Records anonymised');
}));

export default router;