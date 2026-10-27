import backupService from '../services/backupService.js';
import { asyncHandler, sendSuccess, AppError } from '../utils/errors.js';
import { audit } from '../utils/auditLogger.js';

const create = asyncHandler(async (req, res) => {
  const result = await backupService.createBackup({ tenantId: req.tenantId, userId: req.user._id });
  await audit({ tenantId: req.tenantId, userId: req.user._id, action: 'backup_create', resource: 'Backup', resourceId: result.id, req });
  sendSuccess(res, { data: result }, 'Backup created', 201);
});

const list = asyncHandler(async (req, res) => {
  const backups = await backupService.listBackups(req.tenantId);
  sendSuccess(res, { data: backups });
});

const verify = asyncHandler(async (req, res) => {
  const { parsed } = await backupService.readBackup(req.params.id, req.tenantId);
  sendSuccess(res, { data: { valid: true, version: parsed.version, checksum: parsed.checksum } });
});

const remove = asyncHandler(async (req, res) => {
  await backupService.deleteBackup(req.params.id, req.tenantId);
  await audit({ tenantId: req.tenantId, userId: req.user._id, action: 'backup_delete', resource: 'Backup', resourceId: req.params.id, req });
  sendSuccess(res, {}, 'Backup deleted');
});

const restore = asyncHandler(async (req, res) => {
  const result = await backupService.restoreBackup({ id: req.params.id, tenantId: req.tenantId });
  await audit({ tenantId: req.tenantId, userId: req.user._id, action: 'backup_restore', resource: 'Backup', resourceId: req.params.id, req });
  sendSuccess(res, { data: result }, 'Backup restored');
});

export { create, list, verify, remove, restore };
