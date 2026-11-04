import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import Tenant from '../models/Tenant.js';
import DynamicRecord from '../models/DynamicRecord.js';
import ObjectMeta from '../models/ObjectMeta.js';
import FieldMeta from '../models/FieldMeta.js';
import RetentionRule from '../models/RetentionRule.js';
import BackupJob from '../models/BackupJob.js';
import { AppError } from '../utils/errors.js';
import logger from '../utils/logger.js';

const BACKUP_DIR = process.env.BACKUP_DIR || '/tmp/salesdam-backups';

const ensureBackupDir = () => {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
};

/**
 * Resolve retention days for a category for a tenant.
 * Tenant override → system default (tenantId null) → code default (90).
 */
const resolveRetention = async (tenantId, category) => {
  const tenantRule = await RetentionRule.findOne({ tenantId, category, enabled: true }).lean();
  if (tenantRule) return tenantRule.retentionDays;
  const systemRule = await RetentionRule.findOne({ tenantId: null, category, enabled: true }).lean();
  if (systemRule) return systemRule.retentionDays;
  return 90;
};

/**
 * Enforce retention: soft-delete records older than retention period.
 * Returns count of affected records.
 */
const enforceRetention = async (tenantId, category) => {
  const days = await resolveRetention(tenantId, category);
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  let affected = 0;
  if (category === 'business_records') {
    const res = await DynamicRecord.updateMany(
      { tenantId, isDeleted: false, createdAt: { $lt: cutoff } },
      { $set: { isDeleted: true, deletedAt: new Date(), deletedBy: null } },
    );
    affected = res.modifiedCount;
  } else if (category === 'audit_logs') {
    // AuditLog has TTL index; manual purge of old logs
    const AuditLog = (await import('../models/AuditLog.js')).default;
    const res = await AuditLog.deleteMany({ tenantId, createdAt: { $lt: cutoff } });
    affected = res.deletedCount;
  }
  logger.info(`Retention enforced for tenant ${tenantId} category ${category}: ${affected} records affected (cutoff ${cutoff.toISOString()})`);
  return { category, retentionDays: days, cutoff, affected };
};

/**
 * Create a backup artifact for a tenant.
 */
const createBackup = async (tenantId, type = 'full', user) => {
  ensureBackupDir();
  const job = await BackupJob.create({ tenantId, type, status: 'running', startedAt: new Date(), createdBy: user?._id });
  try {
    const [objects, fields, records] = await Promise.all([
      ObjectMeta.find({ tenantId }).lean(),
      FieldMeta.find({ tenantId }).lean(),
      DynamicRecord.find({ tenantId, isDeleted: false }).lean(),
    ]);

    const artifact = {
      tenantId,
      type,
      createdAt: new Date().toISOString(),
      objects,
      fields,
      records,
    };

    const filename = `backup_${tenantId}_${Date.now()}.json`;
    const filepath = path.join(BACKUP_DIR, filename);
    fs.writeFileSync(filepath, JSON.stringify(artifact));

    job.status = 'completed';
    job.artifactPath = filepath;
    job.artifactSizeBytes = fs.statSync(filepath).size;
    job.componentCount = objects.length + fields.length + records.length;
    job.completedAt = new Date();
    await job.save();

    return job;
  } catch (err) {
    job.status = 'failed';
    job.error = err.message;
    job.completedAt = new Date();
    await job.save();
    throw err;
  }
};

/**
 * Restore a backup into a target tenant.
 */
const restoreBackup = async (jobId, targetTenantId, user) => {
  const job = await BackupJob.findOne({ _id: jobId, tenantId: targetTenantId });
  if (!job) throw new AppError('Backup job not found.', 404);
  if (job.status !== 'completed') throw new AppError('Only completed backups can be restored.', 400);

  const raw = fs.readFileSync(job.artifactPath, 'utf8');
  const artifact = JSON.parse(raw);

  // Restore objects and fields (upsert by apiName)
  for (const obj of artifact.objects || []) {
    await ObjectMeta.findOneAndUpdate({ tenantId: targetTenantId, apiName: obj.apiName }, { $set: { ...obj, tenantId: targetTenantId, _id: undefined } }, { upsert: true });
  }
  for (const f of artifact.fields || []) {
    await FieldMeta.findOneAndUpdate({ tenantId: targetTenantId, objectApiName: f.objectApiName, apiName: f.apiName }, { $set: { ...f, tenantId: targetTenantId, _id: undefined } }, { upsert: true });
  }

  job.status = 'restored';
  job.restoredAt = new Date();
  job.restoredBy = user?._id;
  await job.save();

  return { restored: true, componentCount: job.componentCount };
};

export default { resolveRetention, enforceRetention, createBackup, restoreBackup };
