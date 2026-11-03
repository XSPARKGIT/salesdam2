import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import mongoose from 'mongoose';
import ObjectMeta from '../models/ObjectMeta.js';
import DynamicRecord from '../models/DynamicRecord.js';
import TenantConfiguration from '../models/TenantConfiguration.js';
import File from '../models/File.js';
import Tenant from '../models/Tenant.js';

const BACKUP_VERSION = '1.0';
const backupDir = () => process.env.BACKUP_DIR || path.join(process.cwd(), 'backups');

const ensureDir = async () => {
  const dir = backupDir();
  await fs.mkdir(dir, { recursive: true });
  return dir;
};

const checksum = (obj) => crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');

export const createBackup = async ({ tenantId, userId }) => {
  const dir = await ensureDir();
  const tenant = await Tenant.findById(tenantId).lean();
  const objectMetas = await ObjectMeta.find({ tenantId }).lean();
  const records = await DynamicRecord.find({ tenantId, isDeleted: { $ne: true } }).lean();
  const configs = await TenantConfiguration.find({ tenantId }).lean();
  const files = await File.find({ tenantId, isActive: true }).lean();

  const payload = {
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    tenantId: String(tenantId),
    createdBy: String(userId),
    components: ['tenant', 'objectMetas', 'records', 'tenantConfigurations', 'files'],
    data: { tenant, objectMetas, records, configs, files },
  };
  payload.checksum = checksum(payload.data);

  const id = `backup_${tenantId}_${Date.now()}`;
  const filePath = path.join(dir, `${id}.json`);
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2));
  return { id, filePath, metadata: { version: payload.version, createdAt: payload.createdAt, checksum: payload.checksum, components: payload.components } };
};

export const listBackups = async (tenantId) => {
  const dir = await ensureDir();
  const files = await fs.readdir(dir);
  const result = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    try {
      const raw = await fs.readFile(path.join(dir, f), 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed.tenantId !== String(tenantId)) continue;
      result.push({ id: f.replace('.json', ''), file: f, version: parsed.version, createdAt: parsed.createdAt, checksum: parsed.checksum, components: parsed.components });
    } catch {}
  }
  return result.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
};

export const readBackup = async (id, tenantId) => {
  const dir = await ensureDir();
  const filePath = path.join(dir, `${id}.json`);
  const raw = await fs.readFile(filePath, 'utf8');
  const parsed = JSON.parse(raw);
  if (parsed.tenantId !== String(tenantId)) throw new Error('Tenant mismatch');
  // verify checksum
  const actual = checksum(parsed.data);
  if (actual !== parsed.checksum) throw new Error('Checksum mismatch');
  return { id, filePath, parsed };
};

export const deleteBackup = async (id, tenantId) => {
  const { filePath } = await readBackup(id, tenantId);
  await fs.unlink(filePath);
};

export const restoreBackup = async ({ id, tenantId }) => {
  const { parsed } = await readBackup(id, tenantId);
  const d = parsed.data;
  // Replace tenant-scoped data
  await ObjectMeta.deleteMany({ tenantId });
  await DynamicRecord.deleteMany({ tenantId });
  await TenantConfiguration.deleteMany({ tenantId });
  await File.deleteMany({ tenantId });

  if (d.objectMetas?.length) await ObjectMeta.insertMany(d.objectMetas.map(x => ({ ...x, _id: x._id })));
  if (d.records?.length) await DynamicRecord.insertMany(d.records.map(x => ({ ...x, _id: x._id })));
  if (d.configs?.length) await TenantConfiguration.insertMany(d.configs.map(x => ({ ...x, _id: x._id })));
  if (d.files?.length) await File.insertMany(d.files.map(x => ({ ...x, _id: x._id })));

  return { restored: { objectMetas: d.objectMetas?.length || 0, records: d.records?.length || 0, configs: d.configs?.length || 0, files: d.files?.length || 0 } };
};

export default { createBackup, listBackups, readBackup, deleteBackup, restoreBackup, BACKUP_VERSION };
