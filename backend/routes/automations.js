import express from 'express';
import axios from 'axios';
import Automation from '../models/Automation.js';
import DynamicRecord from '../models/DynamicRecord.js';
import ObjectMeta from '../models/ObjectMeta.js';
import ExternalObject from '../models/ExternalObject.js';
import FlowError from '../models/FlowError.js';
import { requireAuth } from '../middleware/auth.js';
import { enforceTenant } from '../middleware/tenant.js';
import { checkAppPermission } from '../middleware/permissions.js';
import {
  asyncHandler,
  sendSuccess,
  AppError,
  paginate,
} from '../utils/errors.js';
import { audit } from '../utils/auditLogger.js';
import mongoose from 'mongoose';
import { checkRecordRules } from '../services/validationService.js';
import {
  entryConditionMet,
  evaluateConditions,
  debugFlow,
  castFormulaValue,
  applyTransform,
  compareForSort,
  MAX_LOOP_ITERATIONS,
} from '../services/automationService.js';
import { evaluateFormula } from '../services/formulaParser.js';
import { validateFlowDefinition } from '../services/flowDefinitionService.js';
import { runScheduledFlow } from '../services/scheduledFlowService.js';

const router = express.Router();

router.use(requireAuth, enforceTenant);

// List automations
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page = 1, limit = 50, type, isActive } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const query = { tenantId: req.tenantId };
    if (type) query.type = type;
    if (isActive !== undefined) query.isActive = isActive === 'true';

    const [automations, total] = await Promise.all([
      Automation.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Automation.countDocuments(query),
    ]);
    sendSuccess(res, paginate(automations, total, page, limit));
  }),
);

// GET /automations/screen-flows?objectApiName=contact
// Returns active screen_flow automations embedded in the given object.
// Must be defined BEFORE /:id so Express doesn't treat "screen-flows" as an id.
router.get(
  '/screen-flows',
  asyncHandler(async (req, res) => {
    const { objectApiName } = req.query;
    const filter = {
      tenantId: req.tenantId,
      type: 'screen_flow',
      isActive: true,
      'trigger.entryPoint': 'embedded',
    };
    if (objectApiName) filter['trigger.objectApiName'] = objectApiName;
    const flows = await Automation.find(filter).sort({
      'trigger.order': 1,
      name: 1,
    });
    sendSuccess(res, { data: flows });
  }),
);

// Flow error log — must be before /:id or Express intercepts it
router.get(
  '/errors',
  asyncHandler(async (req, res) => {
    const { page = 1, limit = 50, automationId } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const query = { tenantId: req.tenantId };
    if (automationId) query.automationId = automationId;

    const [errors, total] = await Promise.all([
      FlowError.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      FlowError.countDocuments(query),
    ]);
    sendSuccess(res, paginate(errors, total, page, limit));
  }),
);

router.delete(
  '/errors/:id',
  asyncHandler(async (req, res) => {
    await FlowError.deleteOne({ _id: req.params.id, tenantId: req.tenantId });
    sendSuccess(res, {}, 'Error log deleted');
  }),
);

// Get single automation
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const automation = await Automation.findOne({
      _id: req.params.id,
      tenantId: req.tenantId,
    });
    if (!automation) throw new AppError('Automation not found.', 404);
    sendSuccess(res, { data: automation });
  }),
);

// Create automation
router.post(
  '/',
  checkAppPermission('canManageAutomations'),
  asyncHandler(async (req, res) => {
    const { apiName } = req.body;
    const existing = await Automation.findOne({
      tenantId: req.tenantId,
      apiName,
    });
    if (existing)
      throw new AppError(`Automation "${apiName}" already exists.`, 409);

    // BRD 7.1: object, trigger, entry condition and schedule are checked up front.
    await validateFlowDefinition(req.tenantId, {
      type: req.body.type || 'record_triggered',
      trigger: req.body.trigger || {},
    });

    const automation = await Automation.create({
      tenantId: req.tenantId,
      createdBy: req.user._id,
      ...req.body,
      isValid: false, // needs validation before activation
    });

    await audit({
      tenantId: req.tenantId,
      userId: req.user._id,
      action: 'create',
      resource: 'Automation',
      resourceId: automation._id,
      req,
    });
    sendSuccess(res, { data: automation }, 'Automation created', 201);
  }),
);

// Update automation
router.put(
  '/:id',
  checkAppPermission('canManageAutomations'),
  asyncHandler(async (req, res) => {
    const automation = await Automation.findOne({
      _id: req.params.id,
      tenantId: req.tenantId,
    });
    if (!automation) throw new AppError('Automation not found.', 404);

    // Do not deactivate on node edits — the user controls active state explicitly.

    // BRD 7.1: re-check the definition when the trigger changes.
    if (req.body.trigger !== undefined) {
      await validateFlowDefinition(req.tenantId, { type: automation.type, trigger: req.body.trigger });
    }

    const allowed = [
      'name',
      'description',
      'trigger',
      'nodes',
      'variables',
      'isActive',
      'isValid',
      'order',
      'maxDepth',
      'allowRecursion',
    ];
    allowed.forEach((k) => {
      if (req.body[k] !== undefined) automation[k] = req.body[k];
    });
    automation.lastModifiedBy = req.user._id;
    await automation.save();

    sendSuccess(res, { data: automation }, 'Automation updated');
  }),
);

// ─── runFlowUntilScreen ───────────────────────────────────────────────────────
// Executes nodes starting from startNodeId (or trigger→first if null).
// Stops when it hits a screen node and returns { status:'screen', screen, resumeNodeId, ctx, ... }.
// Runs to completion and returns { status:'complete', toasts, updatedCount, createdCount, errors, ctx }.
// BRD 6.2: records written by flow steps are held to the object's validation
// rules like any other create or update. These return the failing messages
// (empty = the write may go ahead).
async function flowUpdateRuleFailures(tenantId, targetId, fields) {
  if (!mongoose.isValidObjectId(String(targetId))) return [];
  const target = await DynamicRecord.findOne({ _id: targetId, tenantId, isDeleted: false });
  if (!target) return [];
  const prev = target.toDataObject();
  return checkRecordRules({ tenantId, objectApiName: target.objectApiName, data: { ...prev, ...fields }, prev });
}
const flowCreateRuleFailures = (tenantId, objectApiName, fields) =>
  checkRecordRules({ tenantId, objectApiName, data: fields });
const blockedMessage = (verb, failures) =>
  `${verb} blocked by validation rules: ${failures.join('; ')}`;

async function runFlowUntilScreen(
  automation,
  rec,
  ctx,
  contextData,
  startNodeId,
  tenantId,
  userId,
  userObj,
) {
  const nodeMap = Object.fromEntries(automation.nodes.map((n) => [n.id, n]));

  let cur;
  if (startNodeId) {
    cur = nodeMap[startNodeId];
  } else {
    const trigger = automation.nodes.find((n) => n.type === 'trigger');
    if (!trigger)
      return {
        status: 'complete',
        toasts: [],
        updatedCount: 0,
        createdCount: 0,
        errors: [],
        ctx,
      };
    cur = nodeMap[trigger.nextNodes?.[0]?.nodeId];
  }

  // Runs one inline step — the steps nested inside a Decision outcome or a
  // Loop body. Shared so both places support the same step types.
  const runInlineStep = async (inlineStep, ownerLabel) => {
              const sc = inlineStep.config || {};
              try {
                switch (inlineStep.type) {
                  case 'action_toast':
                    toasts.push({
                      message: interp(sc.message || 'Done'),
                      type: sc.type || 'success',
                    });
                    break;
                  case 'action_update_record': {
                    if (!sc.fields) break;
                    const iMode = sc.recordMode || 'trigger';
                    let tid;
                    if (iMode === 'trigger') {
                      if (!rec) break;
                      tid = rec._id;
                    } else if (iMode === 'variable') {
                      tid = ctx[sc.recordVariable]?._id;
                    } else {
                      tid = interp(String(sc.recordId || ''));
                    }
                    if (!tid) break;
                    const iUpd = {};
                    const iValues = {};
                    Object.entries(sc.fields).forEach(([k, v]) => {
                      iValues[k] = interp(String(v ?? ''));
                      iUpd[`data.${k}`] = iValues[k];
                    });
                    const iFailures = await flowUpdateRuleFailures(tenantId, tid, iValues);
                    if (iFailures.length) {
                      errors.push(blockedMessage('Update', iFailures));
                      break;
                    }
                    await DynamicRecord.updateOne(
                      { _id: tid, tenantId },
                      { $set: iUpd },
                    );
                    updatedCount++;
                    break;
                  }
                  case 'action_create_record': {
                    if (!sc.objectApiName) break;
                    const iObj = await ObjectMeta.findOne({
                      tenantId,
                      apiName: sc.objectApiName,
                    });
                    if (!iObj) break;
                    const iMap = new Map();
                    Object.entries(sc.fields || {}).forEach(([k, v]) =>
                      iMap.set(k, interp(String(v ?? ''))),
                    );
                    const iCreateFailures = await flowCreateRuleFailures(tenantId, sc.objectApiName, Object.fromEntries(iMap));
                    if (iCreateFailures.length) {
                      errors.push(blockedMessage('Create', iCreateFailures));
                      break;
                    }
                    const iCreated = await DynamicRecord.create({
                      tenantId,
                      objectId: iObj._id,
                      objectApiName: sc.objectApiName,
                      data: iMap,
                      createdBy: userId,
                      ownerId: userId,
                    });
                    createdCount++;
                    if (sc.outputVariable) {
                      const iD =
                        iCreated.data instanceof Map
                          ? Object.fromEntries(iCreated.data)
                          : iCreated.data || {};
                      ctx[sc.outputVariable] = {
                        _id: String(iCreated._id),
                        objectApiName: sc.objectApiName,
                        ...iD,
                      };
                    }
                    break;
                  }
                }
              } catch (err) {
                errors.push(
                  `${ownerLabel} step "${inlineStep.label || inlineStep.type}": ${err.message}`,
                );
              }
  };

  const visited = new Set();
  const toasts = [];
  let updatedCount = 0;
  let createdCount = 0;
  const errors = [];

  const recFlat = () => {
    if (!rec) return {};
    const d =
      rec.data instanceof Map ? Object.fromEntries(rec.data) : rec.data || {};
    return {
      _id: String(rec._id || ''),
      objectApiName: rec.objectApiName || '',
      ...d,
    };
  };

  // Flat user object for {user.X} and {$User.X} tokens
  const userFlat = userObj
    ? {
        _id: String(userObj._id || ''),
        id: String(userObj._id || ''),
        firstName: userObj.firstName || '',
        lastName: userObj.lastName || '',
        name: [userObj.firstName, userObj.lastName].filter(Boolean).join(' '),
        email: userObj.email || '',
        systemRole: userObj.systemRole || '',
        tenantId: String(userObj.tenantId || ''),
      }
    : {};

  const interp = (str) => {
    if (str == null) return '';
    const rf = recFlat();
    const merged = { ...rf, ...contextData, ...ctx };
    return String(str).replace(/\{(\$?[\w.]+)\}/g, (_, k) => {
      // {record.field} — page record
      if (k.startsWith('record.'))
        return String(merged[k.slice(7)] ?? rf[k.slice(7)] ?? '');
      // {user.field} or {$User.field}
      if (k.startsWith('user.')) return String(userFlat[k.slice(5)] ?? '');
      if (k.startsWith('$User.')) return String(userFlat[k.slice(6)] ?? '');
      // {varName.field} — dot access on output variables
      const dot = k.indexOf('.');
      if (dot !== -1) {
        const [varName, field] = [k.slice(0, dot), k.slice(dot + 1)];
        const varVal = ctx[varName] ?? contextData[varName];
        if (varVal && typeof varVal === 'object')
          return String(varVal[field] ?? '');
      }
      return merged[k] != null ? String(merged[k]) : '';
    });
  };

  while (cur && !visited.has(cur.id)) {
    visited.add(cur.id);
    const cfg = cur.config || {};

    // Pause at screen nodes — return config + where to resume
    if (cur.type === 'screen') {
      return {
        status: 'screen',
        screen: { ...cfg },
        resumeNodeId: cur.nextNodes?.[0]?.nodeId ?? null,
        toasts,
        updatedCount,
        createdCount,
        errors,
        ctx,
      };
    }

    // Navigate node — resolve the target and return to the client to handle
    if (cur.type === 'navigate') {
      return {
        status: 'navigate',
        navigate: {
          targetType: cfg.targetType || 'record_list',
          objectApiName: cfg.objectApiName || '',
          recordId: interp(cfg.recordId || ''),
        },
        toasts,
        updatedCount,
        createdCount,
        errors,
        ctx,
      };
    }

    try {
      switch (cur.type) {
        case 'action_toast':
          toasts.push({
            message: interp(cfg.message || 'Done'),
            type: cfg.type || 'success',
          });
          break;

        case 'action_update_record': {
          if (!cfg.fields) break;
          const mode = cfg.recordMode || 'trigger';
          let targetId;
          if (mode === 'trigger') {
            if (!rec) break;
            targetId = rec._id;
          } else if (mode === 'variable') {
            targetId = ctx[cfg.recordVariable]?._id;
          } else {
            targetId = interp(String(cfg.recordId || ''));
          }
          if (!targetId) break;
          const updates = {};
          const values = {};
          Object.entries(cfg.fields).forEach(([k, v]) => {
            values[k] = interp(String(v ?? ''));
            updates[`data.${k}`] = values[k];
          });
          const failures = await flowUpdateRuleFailures(tenantId, targetId, values);
          if (failures.length) {
            errors.push(blockedMessage('Update', failures));
            break;
          }
          await DynamicRecord.updateOne(
            { _id: targetId, tenantId },
            { $set: updates },
          );
          updatedCount++;
          break;
        }

        case 'action_create_record': {
          if (!cfg.objectApiName) break;
          const obj = await ObjectMeta.findOne({
            tenantId,
            apiName: cfg.objectApiName,
          });
          if (!obj) break;
          const dataMap = new Map();
          Object.entries(cfg.fields || {}).forEach(([k, v]) =>
            dataMap.set(k, interp(String(v ?? ''))),
          );
          const createFailures = await flowCreateRuleFailures(tenantId, cfg.objectApiName, Object.fromEntries(dataMap));
          if (createFailures.length) {
            errors.push(blockedMessage('Create', createFailures));
            break;
          }
          const created = await DynamicRecord.create({
            tenantId,
            objectId: obj._id,
            objectApiName: cfg.objectApiName,
            data: dataMap,
            createdBy: userId,
            ownerId: userId,
          });
          createdCount++;
          if (cfg.outputVariable) {
            const d =
              created.data instanceof Map
                ? Object.fromEntries(created.data)
                : created.data || {};
            ctx[cfg.outputVariable] = {
              _id: String(created._id),
              objectApiName: cfg.objectApiName,
              ...d,
            };
          }
          break;
        }

        case 'action_http_request': {
          if (!cfg.url) break;
          const headers = { 'Content-Type': 'application/json' };
          let url = interp(cfg.url);
          if (cfg.externalObjectId) {
            const ext = await ExternalObject.findById(
              cfg.externalObjectId,
            ).select('+credentials');
            if (ext) {
              if (!url.startsWith('http'))
                url =
                  ext.baseUrl.replace(/\/$/, '') + '/' + url.replace(/^\//, '');
              if (ext.authType === 'bearer' && ext.credentials?.token)
                headers['Authorization'] = `Bearer ${ext.credentials.token}`;
              else if (ext.authType === 'api_key' && ext.credentials?.apiKey)
                headers[ext.credentials.apiKeyHeader || 'X-Api-Key'] =
                  ext.credentials.apiKey;
              if (ext.defaultHeaders)
                for (const [k, v] of ext.defaultHeaders) headers[k] = v;
            }
          }
          if (cfg.headers) Object.assign(headers, cfg.headers);
          const method = (cfg.method || 'POST').toUpperCase();
          const body = cfg.body ? JSON.parse(interp(cfg.body)) : undefined;
          const resp = await axios({
            method,
            url,
            headers,
            data: body,
            timeout: cfg.timeout || 10000,
          });
          (cfg.responseMapping || []).forEach((m) => {
            if (m.variable && m.path)
              ctx[m.variable] = m.path
                .split('.')
                .reduce((o, k) => o?.[k], resp.data);
          });
          break;
        }

        case 'get_records': {
          if (!cfg.objectApiName || !cfg.variableName) break;
          const query = {
            tenantId,
            objectApiName: cfg.objectApiName,
            isDeleted: false,
          };
          (cfg.filters || []).forEach((f) => {
            if (!f.field || f.value == null) return;
            query[f.field === '_id' ? '_id' : `data.${f.field}`] = interp(
              String(f.value),
            );
          });
          const recs = await DynamicRecord.find(query)
            .limit(cfg.limit || 10)
            .lean();
          ctx[cfg.variableName] = recs.map((r) => ({
            _id: String(r._id),
            ...(r.data instanceof Map
              ? Object.fromEntries(r.data)
              : r.data || {}),
          }));
          break;
        }

        // ── Formula ─────────────────────────────────────────────────────
        case 'formula': {
          if (!cfg.formula || !cfg.outputVariable) break;
          // Screen flows keep variables flat on ctx, so the expression sees
          // the record's fields and every variable set so far.
          ctx[cfg.outputVariable] = castFormulaValue(
            evaluateFormula(cfg.formula, { ...recFlat(), ...ctx }),
            cfg.dataType,
          );
          break;
        }

        // ── Transform Data ──────────────────────────────────────────────
        case 'transform': {
          if (!cfg.inputVariable || !cfg.outputVariable) break;
          const tIn = ctx[cfg.inputVariable];
          if (tIn == null) break;
          const maps = cfg.mappings || [];
          const mapOne = (item) => {
            const src = item && typeof item === 'object' ? item : {};
            if (!maps.length) return { ...src }; // no mappings = copy as-is
            const o = {};
            for (const m of maps) {
              if (!m.target) continue;
              o[m.target] = applyTransform(src[m.source], m.transform);
            }
            return o;
          };
          ctx[cfg.outputVariable] = Array.isArray(tIn) ? tIn.map(mapOne) : mapOne(tIn);
          break;
        }

        // ── Collection Filter ───────────────────────────────────────────
        case 'collection_filter': {
          if (!cfg.inputVariable || !cfg.outputVariable) break;
          const cfIn = ctx[cfg.inputVariable];
          if (!Array.isArray(cfIn)) break;
          // evaluateConditions reads off record.data, so wrap each item.
          const kept = cfIn.filter((item) =>
            evaluateConditions(cfg.conditions || [], { data: item }, cfg.logic || 'all'),
          );
          ctx[cfg.outputVariable] = kept;
          ctx[`${cfg.outputVariable}_count`] = kept.length;
          break;
        }

        // ── Collection Sort ─────────────────────────────────────────────
        case 'collection_sort': {
          if (!cfg.inputVariable || !cfg.outputVariable) break;
          const csIn = ctx[cfg.inputVariable];
          if (!Array.isArray(csIn)) break;
          const active = (cfg.sortFields || []).filter((s) => s && s.field);
          const nullsLast = cfg.nullsLast !== false;
          ctx[cfg.outputVariable] = [...csIn].sort((a, b) => {
            for (const s of active) {
              const av = a?.[s.field];
              const bv = b?.[s.field];
              const aE = av == null || av === '';
              const bE = bv == null || bv === '';
              if (aE || bE) {
                if (aE && bE) continue;
                return (aE ? 1 : -1) * (nullsLast ? 1 : -1);
              }
              const c = compareForSort(av, bv);
              if (c !== 0) return s.direction === 'desc' ? -c : c;
            }
            return 0;
          });
          ctx[`${cfg.outputVariable}_count`] = csIn.length;
          break;
        }

        // ── Loop ────────────────────────────────────────────────────────
        case 'loop': {
          if (!cfg.collectionVariable || !cfg.iterationVariable) break;
          const coll = ctx[cfg.collectionVariable];
          if (!Array.isArray(coll)) break;
          const ordered =
            cfg.direction === 'last_to_first' ? [...coll].reverse() : coll;
          const items = ordered.slice(0, MAX_LOOP_ITERATIONS);
          for (let i = 0; i < items.length; i++) {
            ctx[cfg.iterationVariable] = items[i];
            ctx[`${cfg.iterationVariable}_index`] = i;
            for (const inner of cfg.steps || []) {
              await runInlineStep(inner, 'Loop');
            }
          }
          break;
        }

        // ── Delete Records ──────────────────────────────────────────────
        // Soft-delete, matching the rest of the app: the row stays and is
        // filtered out by isDeleted, so it stays recoverable.
        case 'delete_records': {
          const dMode = cfg.mode || 'trigger_record';
          const soft = { isDeleted: true, deletedAt: new Date() };
          let delCount = 0;
          if (dMode === 'trigger_record') {
            if (!rec?._id) break;
            const r = await DynamicRecord.updateOne(
              { _id: rec._id, tenantId, isDeleted: false },
              { $set: soft },
            );
            delCount = r.modifiedCount || 0;
          } else if (dMode === 'collection') {
            const items = ctx[cfg.collectionVariable];
            if (!Array.isArray(items)) break;
            const ids = items.map((i) => i?._id).filter(Boolean);
            if (ids.length) {
              const r = await DynamicRecord.updateMany(
                { _id: { $in: ids }, tenantId, isDeleted: false },
                { $set: soft },
              );
              delCount = r.modifiedCount || 0;
            }
          } else if (dMode === 'query') {
            const usable = (cfg.filters || []).filter((f) => f && f.field);
            // An unfiltered query would wipe the whole object — refuse it.
            if (!cfg.objectApiName || !usable.length) break;
            const q = { tenantId, objectApiName: cfg.objectApiName, isDeleted: false };
            usable.forEach((f) => {
              q[`data.${f.field}`] = interp(String(f.value ?? ''));
            });
            const r = await DynamicRecord.updateMany(q, { $set: soft });
            delCount = r.modifiedCount || 0;
          }
          ctx.deletedCount = delCount;
          break;
        }

        // ── Subflow ─────────────────────────────────────────────────────
        case 'subflow': {
          if (!cfg.automationId) break;
          const sub = await Automation.findOne({
            _id: cfg.automationId,
            tenantId,
          });
          if (!sub) break;
          // Its own variable scope; only outputMappings come back.
          const subCtx = {};
          for (const m of cfg.inputMappings || []) {
            if (!m.target) continue;
            subCtx[m.target] = interp(String(m.source ?? ''));
          }
          const subRes = await runFlowUntilScreen(
            sub, rec, subCtx, contextData, null, tenantId, userId, userObj,
          );
          toasts.push(...(subRes.toasts || []));
          errors.push(...(subRes.errors || []));
          updatedCount += subRes.updatedCount || 0;
          createdCount += subRes.createdCount || 0;
          for (const m of cfg.outputMappings || []) {
            if (!m.source || !m.target) continue;
            ctx[m.target] = subRes.ctx?.[m.source];
          }
          break;
        }

        // ── Pause ───────────────────────────────────────────────────────
        case 'pause':
          // Same limitation as Wait / Delay: suspending and resuming a run
          // needs a durable job queue, which this server doesn't have.
          // Carry on rather than stalling the user's screen.
          break;

        case 'decision': {
          const outcomes = cfg.outcomes || [];

          // Resolve a condition field value from the merged context
          const getFieldVal = (field) => {
            const merged = { ...recFlat(), ...contextData, ...ctx };
            // support dot-notation: {varName.field} style fields stored as "varName.field"
            const dot = field.indexOf('.');
            if (dot !== -1) {
              const [varName, subField] = [
                field.slice(0, dot),
                field.slice(dot + 1),
              ];
              const varVal = ctx[varName] ?? contextData[varName];
              if (varVal && typeof varVal === 'object')
                return String(varVal[subField] ?? '');
            }
            return String(merged[field] ?? '');
          };

          const evalCond = (c) => {
            const fv = getFieldVal(c.field);
            const cv = interp(String(c.value ?? ''));
            switch (c.operator) {
              case 'equals':
                return fv === cv;
              case 'not_equals':
                return fv !== cv;
              case 'contains':
                return fv.includes(cv);
              case 'starts_with':
                return fv.startsWith(cv);
              case 'ends_with':
                return fv.endsWith(cv);
              case 'greater_than':
                return Number(fv) > Number(cv);
              case 'less_than':
                return Number(fv) < Number(cv);
              case 'gte':
                return Number(fv) >= Number(cv);
              case 'lte':
                return Number(fv) <= Number(cv);
              case 'is_null':
                return fv === '' || fv === 'null' || fv === 'undefined';
              case 'is_not_null':
                return fv !== '' && fv !== 'null' && fv !== 'undefined';
              default:
                return false;
            }
          };

          const evalOutcome = (o) => {
            const conds = o.conditions || [];
            if (!conds.length) return false;
            return o.logic === 'any'
              ? conds.some(evalCond)
              : conds.every(evalCond);
          };

          const matched =
            outcomes.find((o) => !o.isDefault && evalOutcome(o)) ||
            outcomes.find((o) => o.isDefault);

          // Execute the inline steps of the matched outcome
          for (const inlineStep of matched?.steps || []) {
            await runInlineStep(inlineStep, 'Decision');
          }
          break;
        }
      }
    } catch (err) {
      errors.push(`Step "${cur.label || cur.type}": ${err.message}`);
    }

    cur = nodeMap[cur.nextNodes?.[0]?.nodeId];
  }

  return {
    status: 'complete',
    toasts,
    updatedCount,
    createdCount,
    errors,
    ctx,
  };
}

// ─── POST /:id/run-schedule ───────────────────────────────────────────────────
// "Run now" for a scheduled / time-based flow (BRD 7.1): processes the records
// due today without waiting for the time of day. Each record still runs at
// most once per day (or cron minute).
router.post(
  '/:id/run-schedule',
  checkAppPermission('canManageAutomations'),
  asyncHandler(async (req, res) => {
    const automation = await Automation.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!automation) throw new AppError('Automation not found.', 404);
    if (automation.type !== 'scheduled') throw new AppError('Only scheduled flows can be run on a schedule.', 400);
    if (!automation.isActive) throw new AppError('Activate the flow before running it.', 409);
    const result = await runScheduledFlow(automation, new Date(), { force: true });
    sendSuccess(
      res,
      { data: result },
      `Processed ${result.matched} record(s): ${result.ran} ran, ${result.alreadyRun} already ran, ${result.skipped} skipped, ${result.failed} failed.`,
    );
  }),
);

// ─── POST /:id/run-action ─────────────────────────────────────────────────────
// Executes a flow triggered by a button click.
// Stops at the first screen node and returns it for client-side rendering.
// Body: { recordId?, objectApiName?, selectedRecordIds?, contextData? }
// Returns: { status:'screen', screen, resumeNodeId, ctx, ... }
//       OR { status:'complete', toasts, updatedCount, createdCount, errors }
router.post(
  '/:id/run-action',
  asyncHandler(async (req, res) => {
    const automation = await Automation.findOne({
      _id: req.params.id,
      tenantId: req.tenantId,
    });
    if (!automation) throw new AppError('Automation not found.', 404);

    const {
      recordId,
      objectApiName,
      selectedRecordIds = [],
      contextData = {},
    } = req.body;

    let primaryRecord = null;
    if (recordId && objectApiName) {
      try {
        primaryRecord = await DynamicRecord.findOne({
          _id: recordId,
          tenantId: req.tenantId,
        });
      } catch {}
    }

    // BRD 7.1: a manually invoked flow only runs for a record that meets its
    // entry conditions.
    if (primaryRecord && !(await entryConditionMet(automation, primaryRecord, req.tenantId))) {
      throw new AppError(`"${automation.name}" can't run for this record — its entry conditions aren't met.`, 409);
    }

    // Bulk: run straight through for each selected record (no screen pause for bulk)
    if (selectedRecordIds.length > 0) {
      let updatedCount = 0,
        createdCount = 0;
      const toasts = [],
        errors = [];
      const bulkRecs = await DynamicRecord.find({
        _id: { $in: selectedRecordIds },
        tenantId: req.tenantId,
      });
      let notEligible = 0;
      for (const rec of bulkRecs) {
        if (!(await entryConditionMet(automation, rec, req.tenantId))) {
          notEligible++;
          continue;
        }
        const r = await runFlowUntilScreen(
          automation,
          rec,
          {},
          contextData,
          null,
          req.tenantId,
          req.user._id,
          req.user,
        );
        toasts.push(...(r.toasts || []));
        updatedCount += r.updatedCount || 0;
        createdCount += r.createdCount || 0;
        errors.push(...(r.errors || []));
      }
      if (notEligible)
        toasts.push({
          message: `${notEligible} record${notEligible > 1 ? 's' : ''} skipped — entry conditions not met.`,
          type: 'info',
        });
      if (toasts.length === 0 && errors.length === 0)
        toasts.push({
          message: 'Action completed successfully.',
          type: 'success',
        });
      return sendSuccess(res, {
        data: {
          status: 'complete',
          toasts,
          updatedCount,
          createdCount,
          errors,
          ctx: {},
        },
      });
    }

    const result = await runFlowUntilScreen(
      automation,
      primaryRecord,
      {},
      contextData,
      null,
      req.tenantId,
      req.user._id,
      req.user,
    );
    if (
      result.status === 'complete' &&
      result.toasts.length === 0 &&
      result.errors.length === 0
    ) {
      result.toasts.push({
        message: 'Action completed successfully.',
        type: 'success',
      });
    }
    sendSuccess(res, { data: result });
  }),
);

// ─── POST /:id/run-action/resume ──────────────────────────────────────────────
// Resumes flow execution after a screen node, injecting collected form data.
// Body: { resumeNodeId, formData, ctx, recordId?, objectApiName?, contextData? }
router.post(
  '/:id/run-action/resume',
  asyncHandler(async (req, res) => {
    const automation = await Automation.findOne({
      _id: req.params.id,
      tenantId: req.tenantId,
    });
    if (!automation) throw new AppError('Automation not found.', 404);

    const {
      resumeNodeId,
      formData = {},
      ctx: clientCtx = {},
      recordId,
      objectApiName,
      contextData = {},
    } = req.body;

    if (!resumeNodeId) {
      return sendSuccess(res, {
        data: {
          status: 'complete',
          toasts: [{ message: 'Completed successfully.', type: 'success' }],
          updatedCount: 0,
          createdCount: 0,
          errors: [],
          ctx: clientCtx,
        },
      });
    }

    let primaryRecord = null;
    if (recordId && objectApiName) {
      try {
        primaryRecord = await DynamicRecord.findOne({
          _id: recordId,
          tenantId: req.tenantId,
        });
      } catch {}
    }

    // Merge form data into ctx so {apiName} tokens resolve to user-entered values
    const mergedCtx = { ...clientCtx, ...formData };
    const mergedContextData = { ...contextData, ...formData };

    const result = await runFlowUntilScreen(
      automation,
      primaryRecord,
      mergedCtx,
      mergedContextData,
      resumeNodeId,
      req.tenantId,
      req.user._id,
      req.user,
    );
    if (
      result.status === 'complete' &&
      result.toasts.length === 0 &&
      result.errors.length === 0
    ) {
      result.toasts.push({
        message: 'Completed successfully.',
        type: 'success',
      });
    }
    sendSuccess(res, { data: result });
  }),
);

// ─── POST /:id/debug ─────────────────────────────────────────────────────────
// Test-run a flow and return a step-by-step trace.
// Body: { recordId?, objectApiName?, event?, dryRun? }
//
// This runs the flow through the production executor (debugFlow → executeFlow)
// rather than a separate simulator. An earlier version walked the nodes itself,
// which meant the panel could report a step as fine while the real runtime did
// nothing with it — the trace has to come from the code that actually runs.
//
//   dryRun=true  → reads, conditions, formulas and branches all evaluate for
//                  real; writes, sends, HTTP calls and custom code describe
//                  themselves instead of happening
//   dryRun=false → full live execution
router.post(
  '/:id/debug',
  asyncHandler(async (req, res) => {
    const automation = await Automation.findOne({
      _id: req.params.id,
      tenantId: req.tenantId,
    });
    if (!automation) throw new AppError('Automation not found.', 404);

    const { recordId, objectApiName, event = 'create', dryRun = true } = req.body;
    const objName = objectApiName || automation.trigger?.objectApiName;

    // ── Resolve the record the flow runs against ────────────────────────────
    let record = null;
    if (recordId) {
      record = await DynamicRecord.findOne({
        _id: recordId,
        tenantId: req.tenantId,
      }).lean();
      if (!record) throw new AppError('Record not found.', 404);
    } else if (objName) {
      record = await DynamicRecord.findOne({
        tenantId: req.tenantId,
        objectApiName: objName,
        isDeleted: false,
      })
        .sort({ createdAt: -1 })
        .lean();
    }

    // A scheduled flow with no object runs once against no record at all, the
    // same shape scheduledFlowService gives it.
    const usedFallbackRecord = !recordId && !!record;
    if (!record) {
      if (automation.type !== 'scheduled' && objName) {
        throw new AppError(
          `No ${objName} records exist to test against. Create one first, or pick a record.`,
          400,
        );
      }
      record = { _id: null, objectApiName: null, data: {} };
    }

    // ── Warn when the chosen event could not fire this flow in production ───
    const warnings = [];
    if (automation.type === 'record_triggered') {
      const events = automation.trigger?.events || [];
      if (events.length && !events.includes(event) && !events.includes('all')) {
        warnings.push(
          `This flow is only triggered by ${events.join(', ')} — a real "${event}" would not run it.`,
        );
      }
    }
    if (!automation.isActive) {
      warnings.push('This flow is inactive, so it would not run on its own.');
    }
    if (usedFallbackRecord) {
      warnings.push(
        `No record chosen — used the most recent ${record.objectApiName} record.`,
      );
    }
    // Only worth saying when the flow actually has a screen to step over.
    const hasScreen = (automation.nodes || []).some((n) => n.type === 'screen');
    if (hasScreen) {
      warnings.push(
        'Screen steps are stepped over in a test run — nobody is there to fill them in.',
      );
    }

    const result = await debugFlow(automation, record, req.tenantId, {
      dryRun: dryRun !== false,
      event,
      userId: req.user?._id || null,
    });

    const flatRecord =
      record._id == null
        ? {}
        : {
            _id: String(record._id),
            objectApiName: record.objectApiName,
            ...(record.data instanceof Map
              ? Object.fromEntries(record.data)
              : record.data || {}),
          };

    sendSuccess(res, {
      data: {
        ...result,
        record: flatRecord,
        warnings,
        flowType: automation.type,
        dryRun: dryRun !== false,
      },
    });
  }),
);

// Activate/deactivate
router.patch(
  '/:id/toggle',
  checkAppPermission('canManageAutomations'),
  asyncHandler(async (req, res) => {
    const automation = await Automation.findOne({
      _id: req.params.id,
      tenantId: req.tenantId,
    });
    if (!automation) throw new AppError('Automation not found.', 404);
    if (!automation.isActive && !automation.isValid) {
      throw new AppError(
        'Automation must pass validation before activation.',
        400,
      );
    }
    automation.isActive = !automation.isActive;
    await automation.save();
    sendSuccess(
      res,
      { data: { isActive: automation.isActive } },
      `Automation ${automation.isActive ? 'activated' : 'deactivated'}`,
    );
  }),
);

// Delete automation
router.delete(
  '/:id',
  checkAppPermission('canManageAutomations'),
  asyncHandler(async (req, res) => {
    const automation = await Automation.findOne({
      _id: req.params.id,
      tenantId: req.tenantId,
    });
    if (!automation) throw new AppError('Automation not found.', 404);
    await Automation.deleteOne({ _id: automation._id });
    sendSuccess(res, {}, 'Automation deleted');
  }),
);

export default router;
