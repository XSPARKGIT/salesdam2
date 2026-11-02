import vm from 'vm';
import CustomCode from '../models/CustomCode.js';
import logger from '../utils/logger.js';
import { AppError } from '../utils/errors.js';

const TIMEOUT_MS = 5000;
const MAX_EXECUTIONS = 50;

/**
 * Get the active version's code for a named custom code snippet.
 */
export const getActiveCode = async (tenantId, name) => {
  const doc = await CustomCode.findOne({ tenantId, name });
  if (!doc) throw new AppError(`Custom code "${name}" not found.`, 404);
  if (!doc.activeVersion) throw new AppError(`Custom code "${name}" has no active version.`, 400);
  const v = doc.versions.find((x) => x.version === doc.activeVersion);
  if (!v || v.status !== 'active') throw new AppError(`Custom code "${name}" active version not active.`, 400);
  return { doc, version: v };
};

/**
 * Execute a custom code snippet in a sandboxed VM.
 * Returns { success, output, error, durationMs }.
 */
export const executeCustomCode = async (tenantId, name, inputs = {}, context = {}) => {
  const { doc, version } = await getActiveCode(tenantId, name);
  const startedAt = new Date();
  let success = true;
  let output = null;
  let error = null;

  try {
    const sandbox = {
      inputs: inputs || {},
      record: context.record || null,
      ctx: context.ctx || {},
      tenantId: String(tenantId),
      console: {
        log: (...a) => logger.info(`[customCode:${name}] ${a.join(' ')}`),
        error: (...a) => logger.error(`[customCode:${name}] ${a.join(' ')}`),
        warn: (...a) => logger.warn(`[customCode:${name}] ${a.join(' ')}`),
      },
      result: undefined,
      // Controlled data access helpers (tenant-scoped)
      readRecord: async (objectApiName, id) => {
        const DynamicRecord = (await import('../models/DynamicRecord.js')).default;
        const rec = await DynamicRecord.findOne({ _id: id, tenantId, objectApiName, isDeleted: false }).lean();
        if (!rec) return null;
        return { id: rec._id, ...Object.fromEntries(rec.data instanceof Map ? rec.data : Object.entries(rec.data || {})) };
      },
      queryRecords: async (objectApiName, filter = {}, limit = 10) => {
        const DynamicRecord = (await import('../models/DynamicRecord.js')).default;
        const q = { tenantId, objectApiName, isDeleted: false };
        Object.entries(filter || {}).forEach(([k, v]) => { q[`data.${k}`] = v; });
        const recs = await DynamicRecord.find(q).limit(Math.min(parseInt(limit) || 10, 100)).lean();
        return recs.map((r) => ({ id: r._id, ...Object.fromEntries(r.data instanceof Map ? r.data : Object.entries(r.data || {})) }));
      },
      createRecord: async (objectApiName, data = {}) => {
        const DynamicRecord = (await import('../models/DynamicRecord.js')).default;
        const ObjectMeta = (await import('../models/ObjectMeta.js')).default;
        const obj = await ObjectMeta.findOne({ tenantId, apiName: objectApiName });
        if (!obj) throw new Error(`Object ${objectApiName} not found`);
        const rec = await DynamicRecord.create({ tenantId, objectId: obj._id, objectApiName, ownerId: context.userId || null, createdBy: context.userId || null, lastModifiedBy: context.userId || null, data });
        Object.entries(data || {}).forEach(([k, v]) => rec.setField(k, v));
        await rec.save();
        return { id: rec._id };
      },
      updateRecord: async (objectApiName, id, data = {}) => {
        const DynamicRecord = (await import('../models/DynamicRecord.js')).default;
        const rec = await DynamicRecord.findOne({ _id: id, tenantId, objectApiName, isDeleted: false });
        if (!rec) throw new Error('Record not found');
        Object.entries(data || {}).forEach(([k, v]) => rec.setField(k, v));
        await rec.save();
        return { id: rec._id };
      },
    };

    const script = new vm.Script(version.code, { filename: `${name}.js` });
    const ctx = vm.createContext(sandbox);
    script.runInContext(ctx, { timeout: TIMEOUT_MS });

    output = sandbox.result !== undefined ? sandbox.result : sandbox.output;
  } catch (err) {
    success = false;
    error = err.message || String(err);
    logger.error(`Custom code "${name}" execution failed: ${error}`);
  }

  const finishedAt = new Date();
  const durationMs = finishedAt - startedAt;

  // Log execution (keep last MAX_EXECUTIONS)
  try {
    doc.executions.push({ version: version.version, startedAt, finishedAt, durationMs, success, error, inputs, output });
    if (doc.executions.length > MAX_EXECUTIONS) {
      doc.executions = doc.executions.slice(-MAX_EXECUTIONS);
    }
    await doc.save();
  } catch (e) {
    logger.warn(`Failed to log custom code execution: ${e.message}`);
  }

  if (!success) throw new AppError(`Custom code "${name}" failed: ${error}`, 500);
  return { success, output, durationMs };
};

/**
 * Create a new custom code snippet (version 1, draft).
 */
export const createCustomCode = async (tenantId, { name, description, code, inputs }, user) => {
  const doc = await CustomCode.create({
    tenantId,
    name,
    description: description || '',
    versions: [{ version: 1, code, inputs: inputs || {}, createdBy: user?._id, status: 'draft' }],
    createdBy: user?._id,
    lastModifiedBy: user?._id,
  });
  return doc;
};

/**
 * Add a new version.
 */
export const addVersion = async (tenantId, name, { code, inputs, changeNote }, user) => {
  const doc = await CustomCode.findOne({ tenantId, name });
  if (!doc) throw new AppError(`Custom code "${name}" not found.`, 404);
  const nextVersion = (doc.versions.reduce((m, v) => Math.max(m, v.version), 0) || 0) + 1;
  doc.versions.push({ version: nextVersion, code, inputs: inputs || {}, createdBy: user?._id, status: 'draft', changeNote: changeNote || '' });
  doc.lastModifiedBy = user?._id;
  await doc.save();
  return doc;
};

/**
 * Activate a version (only active versions can execute).
 */
export const activateVersion = async (tenantId, name, version, user) => {
  const doc = await CustomCode.findOne({ tenantId, name });
  if (!doc) throw new AppError(`Custom code "${name}" not found.`, 404);
  const v = doc.versions.find((x) => x.version === version);
  if (!v) throw new AppError(`Version ${version} not found.`, 404);
  // Deactivate previous active
  doc.versions.forEach((x) => { if (x.status === 'active') x.status = 'archived'; });
  v.status = 'active';
  doc.activeVersion = version;
  doc.lastModifiedBy = user?._id;
  await doc.save();
  return doc;
};

/**
 * Restore a previous version as the active version.
 */
export const restoreVersion = async (tenantId, name, version, user) => {
  const doc = await CustomCode.findOne({ tenantId, name });
  if (!doc) throw new AppError(`Custom code "${name}" not found.`, 404);
  const v = doc.versions.find((x) => x.version === version);
  if (!v) throw new AppError(`Version ${version} not found.`, 404);
  // Archive current active
  doc.versions.forEach((x) => { if (x.status === 'active') x.status = 'archived'; });
  v.status = 'active';
  doc.activeVersion = version;
  doc.lastModifiedBy = user?._id;
  await doc.save();
  return doc;
};

export default { getActiveCode, executeCustomCode, createCustomCode, addVersion, activateVersion, restoreVersion };