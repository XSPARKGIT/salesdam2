import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import CustomCode from '../models/CustomCode.js';
import logger from '../utils/logger.js';
import { AppError } from '../utils/errors.js';

const TIMEOUT_MS = 5000;
const MAX_EXECUTIONS = 50;
const _runningDepth = new Map();

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
 * Controlled operations the jailed runner may ask for. The tenant is fixed here, never
 * taken from the code, and every write goes through the platform's own checks.
 */
const SAFE_OPS = new Set(['$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$in', '$nin']);
const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const cleanFilter = (filter) => {
  const q = {};
  for (const [k, v] of Object.entries(isPlain(filter) ? filter : {})) {
    if (!/^[A-Za-z0-9_]+$/.test(k)) throw new Error(`Invalid field name "${k}" in filter`);
    if (isPlain(v)) {
      const ops = Object.keys(v);
      if (!ops.length || ops.some((o) => !SAFE_OPS.has(o))) throw new Error(`Unsupported filter operator on "${k}"`);
      q[`data.${k}`] = v;
    } else q[`data.${k}`] = v;
  }
  return q;
};
const flat = (r) => ({ id: r._id, ...Object.fromEntries(r.data instanceof Map ? r.data : Object.entries(r.data || {})) });
// The record a flow passes is a Mongoose document with a Map; hand the code a plain copy.
const plainRecord = (r) => {
  if (!r) return null;
  const o = typeof r.toObject === 'function' ? r.toObject({ flattenMaps: true }) : r;
  const data = o.data instanceof Map ? Object.fromEntries(o.data) : (o.data || {});
  const id = String(o._id || o.id || '');
  return JSON.parse(JSON.stringify({ ...data, id, _id: id, objectApiName: o.objectApiName, data }));
};
const MAX_API_BYTES = 1024 * 1024;

const hostOps = (tenantId, name, { testMode, userId }) => ({
  checkConsent: async (subjectType, subjectId, channel) => {
    const consentService = (await import('./consentService.js')).default;
    return consentService.canContact(tenantId, subjectType, subjectId, channel);
  },
  readRecord: async (objectApiName, id) => {
    const DynamicRecord = (await import('../models/DynamicRecord.js')).default;
    const rec = await DynamicRecord.findOne({ _id: id, tenantId, objectApiName: String(objectApiName), isDeleted: false }).lean();
    return rec ? flat(rec) : null;
  },
  queryRecords: async (objectApiName, filter = {}, limit = 10) => {
    const DynamicRecord = (await import('../models/DynamicRecord.js')).default;
    const q = { tenantId, objectApiName: String(objectApiName), isDeleted: false, ...cleanFilter(filter) };
    const recs = await DynamicRecord.find(q).limit(Math.min(parseInt(limit, 10) || 10, 100)).lean();
    return recs.map(flat);
  },
  createRecord: async (objectApiName, data = {}) => {
    if (testMode) throw new Error('Test mode: createRecord is disabled to prevent production changes.');
    const DynamicRecord = (await import('../models/DynamicRecord.js')).default;
    const ObjectMeta = (await import('../models/ObjectMeta.js')).default;
    const obj = await ObjectMeta.findOne({ tenantId, apiName: String(objectApiName) });
    if (!obj) throw new Error(`Object ${objectApiName} not found`);
    // BRD 6.2: a script's writes are held to the object's validation rules.
    const { checkRecordRules } = await import('./validationService.js');
    const failures = await checkRecordRules({ tenantId, objectApiName, data: data || {} });
    if (failures.length) throw new Error(`Create blocked by validation rules: ${failures.join('; ')}`);
    const rec = await DynamicRecord.create({ tenantId, objectId: obj._id, objectApiName, ownerId: userId || null, createdBy: userId || null, lastModifiedBy: userId || null, data });
    Object.entries(data || {}).forEach(([k, v]) => rec.setField(k, v));
    // Auto-number fields (e.g. CLM-00009) are filled exactly as for a record made on screen.
    const FieldMeta = (await import('../models/FieldMeta.js')).default;
    const { applyAutoNumbers } = await import('./autoNumberService.js');
    await applyAutoNumbers(rec, await FieldMeta.find({ tenantId, objectApiName: String(objectApiName) }), tenantId, objectApiName);
    await rec.save();
    return { id: rec._id };
  },
  updateRecord: async (objectApiName, id, data = {}) => {
    if (testMode) throw new Error('Test mode: updateRecord is disabled to prevent production changes.');
    const DynamicRecord = (await import('../models/DynamicRecord.js')).default;
    const rec = await DynamicRecord.findOne({ _id: id, tenantId, objectApiName: String(objectApiName), isDeleted: false });
    if (!rec) throw new Error('Record not found');
    const { checkRecordRules } = await import('./validationService.js');
    const prev = Object.fromEntries(rec.data instanceof Map ? rec.data : Object.entries(rec.data || {}));
    const failures = await checkRecordRules({ tenantId, objectApiName, data: { ...prev, ...(data || {}) }, prev });
    if (failures.length) throw new Error(`Update blocked by validation rules: ${failures.join('; ')}`);
    Object.entries(data || {}).forEach(([k, v]) => rec.setField(k, v));
    await rec.save();
    return { id: rec._id };
  },
  // 15.1.8 / 15.4.23: only the tenant's own APPROVED external systems (Setup > External
  // Objects). The code names the system; the base URL and credentials stay on the server.
  callApi: async (systemName, path = '', opts = {}) => {
    const ExternalObject = (await import('../models/ExternalObject.js')).default;
    const ext = await ExternalObject.findOne({ tenantId, name: String(systemName), isActive: true }).select('+credentials');
    if (!ext) throw new Error(`"${systemName}" is not an approved external system for this tenant.`);
    const p = String(path || '');
    if (/^[a-z][a-z0-9+.-]*:/i.test(p) || p.startsWith('//')) throw new Error('Give a path relative to the approved system, not a full URL.');
    const base = new URL(ext.baseUrl);
    const url = new URL(p ? `${base.href.replace(/\/$/, '')}/${p.replace(/^\//, '')}` : base.href);
    if (url.host !== base.host) throw new Error('Request leaves the approved host.');
    const method = String(opts.method || 'GET').toUpperCase();
    if (testMode && method !== 'GET') throw new Error('Test mode: only GET calls to external systems are allowed.');
    const headers = { 'Content-Type': 'application/json' };
    const c = ext.credentials || {};
    if (ext.authType === 'bearer' && c.token) headers.Authorization = `Bearer ${c.token}`;
    else if (ext.authType === 'basic' && c.username) headers.Authorization = `Basic ${Buffer.from(`${c.username}:${c.password || ''}`).toString('base64')}`;
    else if (ext.authType === 'api_key' && c.apiKey) headers[c.apiKeyHeader || 'X-Api-Key'] = c.apiKey;
    if (ext.defaultHeaders) for (const [k, v] of ext.defaultHeaders) headers[k] = v;
    const res = await fetch(url, {
      method, headers, redirect: 'manual',
      body: opts.body === undefined || method === 'GET' ? undefined : JSON.stringify(opts.body),
      signal: AbortSignal.timeout(Math.min(ext.defaultTimeout || 10000, 8000)),
    });
    const text = (await res.text()).slice(0, MAX_API_BYTES);
    let body = text; try { body = JSON.parse(text); } catch { /* keep text */ }
    return { status: res.status, ok: res.ok, body };
  },
});

const RUNNER = fileURLToPath(new URL('./customCodeRunner.cjs', import.meta.url));
const WALL_MS = TIMEOUT_MS + 3000;
const MAX_PER_TENANT = 5;
const _running = new Map();

const runJailed = (tenantId, name, code, payload, opts) => new Promise((resolve) => {
  const ops = hostOps(tenantId, name, opts);
  const child = spawn(process.execPath, [
    '--permission', `--allow-fs-read=${RUNNER}`, '--max-old-space-size=64', '--disallow-code-generation-from-strings', RUNNER,
  ], { env: {}, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true });
  let settled = false;
  const finish = (r) => { if (settled) return; settled = true; clearTimeout(wall); try { child.kill('SIGKILL'); } catch { /* gone */ } resolve(r); };
  const wall = setTimeout(() => finish({ ok: false, error: `Execution timed out after ${WALL_MS / 1000}s and was stopped.` }), WALL_MS);
  child.on('error', (e) => finish({ ok: false, error: `Runner failed to start: ${e.message}` }));
  child.on('exit', (c, s) => setTimeout(() => finish({ ok: false, error: s === 'SIGKILL' || c === null ? 'Execution stopped (resource limit or crash).' : `Runner exited (${c}) before returning.` }), 250));
  child.on('message', async (m) => {
    if (!m || typeof m !== 'object') return;
    if (m.type === 'log') { logger[m.level === 'error' ? 'error' : m.level === 'warn' ? 'warn' : 'info'](`[customCode:${name}] ${String(m.msg).slice(0, 2000)}`); return; }
    if (m.type === 'done') { finish({ ok: m.ok, output: m.output, error: m.error }); return; }
    if (m.type === 'rpc') {
      let reply;
      try {
        if (!Object.prototype.hasOwnProperty.call(ops, m.op)) throw new Error(`Unknown operation "${String(m.op).slice(0, 40)}"`);
        reply = { ok: true, value: JSON.parse(JSON.stringify((await ops[m.op](...(Array.isArray(m.args) ? m.args : []))) ?? null)) };
      } catch (e) { reply = { ok: false, error: String(e.message || e).slice(0, 1000) }; }
      if (!settled && child.connected) child.send({ type: 'rpc-result', id: m.id, ...reply });
    }
  });
  child.send({ type: 'run', code, name, timeoutMs: TIMEOUT_MS, ...payload });
});

/**
 * Execute a custom code snippet in the jailed runner.
 * context.version runs that specific version (any status) and is always test mode.
 * Returns { success, output, durationMs } or throws AppError.
 */
export const executeCustomCode = async (tenantId, name, inputs = {}, context = {}) => {
  const key = `${tenantId}:${name}`;
  const currentDepth = _runningDepth.get(key) || 0;
  if (currentDepth >= 1) {
    throw new AppError(`Custom code "${name}" recursion blocked (depth ${currentDepth}).`, 429);
  }
  const tenantRuns = _running.get(String(tenantId)) || 0;
  if (tenantRuns >= MAX_PER_TENANT) {
    throw new AppError(`Too many custom code runs at once for this tenant (limit ${MAX_PER_TENANT}).`, 429);
  }
  _runningDepth.set(key, currentDepth + 1);
  _running.set(String(tenantId), tenantRuns + 1);

  const startedAt = new Date();
  let success = true;
  let output = null;
  let error = null;

  const specific = context?.version !== undefined && context?.version !== null;
  const testMode = Boolean(context?.testMode) || specific;
  let doc, version, lookupError = null;
  try {
    if (specific) {
      doc = await CustomCode.findOne({ tenantId, name });
      if (!doc) throw new AppError(`Custom code "${name}" not found.`, 404);
      version = doc.versions.find((x) => x.version === Number(context.version));
      if (!version) throw new AppError(`Version ${context.version} not found.`, 404);
    } else {
      ({ doc, version } = await getActiveCode(tenantId, name));
    }
    const r = await runJailed(tenantId, name, version.code, {
      inputs: JSON.parse(JSON.stringify(inputs || {})),
      record: plainRecord(context.record),
      ctx: JSON.parse(JSON.stringify(context.ctx || {})),
      tenantId: String(tenantId),
    }, { testMode, userId: context.userId });
    if (!r.ok) throw new Error(r.error);
    output = r.output;
  } catch (err) {
    success = false;
    error = err.message || String(err);
    logger.error(`Custom code "${name}" execution failed: ${error}`);
    lookupError = !doc ? err : null;
  } finally {
    const d = (_runningDepth.get(key) || 1) - 1;
    if (d <= 0) _runningDepth.delete(key);
    else _runningDepth.set(key, d);
    const n = (_running.get(String(tenantId)) || 1) - 1;
    if (n <= 0) _running.delete(String(tenantId)); else _running.set(String(tenantId), n);
  }

  if (lookupError) throw (lookupError instanceof AppError ? lookupError : new AppError(lookupError.message, 500));
  const finishedAt = new Date();
  const durationMs = finishedAt - startedAt;

  // Log execution (keep last MAX_EXECUTIONS)
  try {
    doc.executions.push({ version: version.version, startedAt, finishedAt, durationMs, success, error, inputs, output, testMode });
    if (doc.executions.length > MAX_EXECUTIONS) {
      doc.executions = doc.executions.slice(-MAX_EXECUTIONS);
    }
    await doc.save();
  } catch (e) {
    logger.warn(`Failed to log custom code execution: ${e.message}`);
  }

  if (!success) throw new AppError(`Custom code "${name}" failed: ${error}`, 500);
  return { success, output, durationMs, version: version.version, testMode };
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
 * Move a version between Draft -> Test -> Active -> Inactive (BRD 15.4.12).
 * Activation itself goes through activateVersion; this handles Test and Inactive.
 */
const ALLOWED = { draft: ['test'], test: ['draft'], active: ['inactive'], inactive: ['test'], archived: ['test'] };
export const setVersionStatus = async (tenantId, name, version, status, user) => {
  const doc = await CustomCode.findOne({ tenantId, name });
  if (!doc) throw new AppError(`Custom code "${name}" not found.`, 404);
  const v = doc.versions.find((x) => x.version === Number(version));
  if (!v) throw new AppError(`Version ${version} not found.`, 404);
  if (!(ALLOWED[v.status] || []).includes(status)) throw new AppError(`A ${v.status} version cannot move to ${status}.`, 400);
  v.status = status;
  if (status === 'inactive' && doc.activeVersion === v.version) doc.activeVersion = null;
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

/**
 * Update snippet metadata (description).
 */
export const updateSnippet = async (tenantId, name, { description }, user) => {
  const doc = await CustomCode.findOne({ tenantId, name });
  if (!doc) throw new AppError(`Custom code "${name}" not found.`, 404);
  if (description !== undefined) doc.description = description;
  doc.lastModifiedBy = user?._id;
  await doc.save();
  return doc;
};

/**
 * Update the code/inputs of an existing draft version.
 */
export const updateVersionCode = async (tenantId, name, version, { code, inputs, changeNote }, user) => {
  const doc = await CustomCode.findOne({ tenantId, name });
  if (!doc) throw new AppError(`Custom code "${name}" not found.`, 404);
  const v = doc.versions.find((x) => x.version === version);
  if (!v) throw new AppError(`Version ${version} not found.`, 404);
  if (!['draft', 'test'].includes(v.status)) throw new AppError(`Only draft or test versions can be edited directly.`, 400);
  if (code) v.code = code;
  if (inputs !== undefined) v.inputs = inputs;
  if (changeNote !== undefined) v.changeNote = changeNote;
  doc.lastModifiedBy = user?._id;
  await doc.save();
  return doc;
};

export default { setVersionStatus, getActiveCode, executeCustomCode, createCustomCode, addVersion, activateVersion, restoreVersion, updateSnippet, updateVersionCode };