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
          Object.entries(cfg.fields).forEach(([k, v]) => {
            updates[`data.${k}`] = interp(String(v ?? ''));
          });
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
                  Object.entries(sc.fields).forEach(([k, v]) => {
                    iUpd[`data.${k}`] = interp(String(v ?? ''));
                  });
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
                `Decision step "${inlineStep.label || inlineStep.type}": ${err.message}`,
              );
            }
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
      for (const rec of bulkRecs) {
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
// Test-run with step-by-step trace. Body: { recordId?, objectApiName?, event?, dryRun? }
// dryRun=true  → evaluates logic / reads, skips writes/sends
// dryRun=false → full live execution
router.post(
  '/:id/debug',
  asyncHandler(async (req, res) => {
    const automation = await Automation.findOne({
      _id: req.params.id,
      tenantId: req.tenantId,
    });
    if (!automation) throw new AppError('Automation not found.', 404);

    const {
      recordId,
      objectApiName,
      event = 'create',
      dryRun = true,
    } = req.body;
    const objName = objectApiName || automation.trigger?.objectApiName;

    // Resolve record
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

    const flatRec = (r) => {
      if (!r) return {};
      const data =
        r.data instanceof Map ? Object.fromEntries(r.data) : r.data || {};
      return {
        _id: String(r._id),
        id: String(r._id),
        objectApiName: r.objectApiName || objName,
        ...data,
      };
    };

    const ctx = {};
    const recFlat = flatRec(record);

    const interp = (str) => {
      if (!str || typeof str !== 'string') return str ?? '';
      return str.replace(/\{(\$?[\w.]+)\}/g, (_, k) => {
        if (k.startsWith('$')) return String(ctx[k.slice(1)] ?? ctx[k] ?? '');
        const parts = k.split('.');
        if (parts.length === 2)
          return String(
            ctx[parts[0]]?.[parts[1]] ?? recFlat[parts[0]]?.[parts[1]] ?? '',
          );
        return String(recFlat[k] ?? ctx[k] ?? '');
      });
    };

    const evalConds = (conditions = []) => {
      if (!conditions.length) return true;
      return conditions.every((c) => {
        const v = String(recFlat[c.field] ?? '');
        switch (c.operator) {
          case 'equals':
            return v === String(c.value ?? '');
          case 'not_equals':
            return v !== String(c.value ?? '');
          case 'contains':
            return v.includes(String(c.value ?? ''));
          case 'starts_with':
            return v.startsWith(String(c.value ?? ''));
          case 'ends_with':
            return v.endsWith(String(c.value ?? ''));
          case 'greater_than':
            return Number(v) > Number(c.value);
          case 'less_than':
            return Number(v) < Number(c.value);
          case 'gte':
            return Number(v) >= Number(c.value);
          case 'lte':
            return Number(v) <= Number(c.value);
          case 'is_null':
            return !recFlat[c.field] && recFlat[c.field] !== 0;
          case 'is_not_null':
            return !!recFlat[c.field] || recFlat[c.field] === 0;
          default:
            return true;
        }
      });
    };

    const trace = [];
    const globalStart = Date.now();

    // Entry conditions check
    if (automation.trigger?.runWhen === 'conditions_met') {
      const pass = evalConds(automation.trigger.conditions);
      trace.push({
        id: 'trigger',
        type: 'trigger',
        label: 'Trigger',
        status: pass ? 'success' : 'skipped',
        output: pass
          ? 'Entry conditions met'
          : 'Entry conditions NOT met — flow would be skipped',
        duration: 0,
        contextSnapshot: {},
      });
      if (!pass)
        return sendSuccess(res, {
          data: {
            trace,
            context: ctx,
            duration: Date.now() - globalStart,
            record: recFlat,
            success: false,
            skipped: true,
            dryRun,
          },
        });
    } else {
      trace.push({
        id: 'trigger',
        type: 'trigger',
        label: 'Trigger',
        status: 'success',
        output: 'Runs every time',
        duration: 0,
        contextSnapshot: {},
      });
    }

    const nodeMap = Object.fromEntries(
      (automation.nodes || []).map((n) => [n.id, n]),
    );
    let cur = (automation.nodes || []).find((n) => n.type === 'trigger');
    const visited = new Set();
    if (cur) cur = nodeMap[cur.nextNodes?.[0]?.nodeId];

    while (cur && !visited.has(cur.id) && cur.type !== 'end') {
      visited.add(cur.id);
      const cfg = cur.config || {};
      const t0 = Date.now();
      const step = {
        id: cur.id,
        type: cur.type,
        label: cur.label || cur.type,
        status: 'success',
        output: '',
        error: null,
        duration: 0,
        contextSnapshot: null,
      };
      let stop = false;

      try {
        switch (cur.type) {
          case 'condition': {
            const pass = evalConds(cfg.conditions || []);
            step.output = pass
              ? `Passed (${cfg.logic || 'all'} conditions met)`
              : 'NOT met — flow stops here';
            if (!pass) {
              step.status = 'skipped';
              stop = true;
            }
            break;
          }
          case 'decision': {
            const outcomes = cfg.outcomes || [];
            let m = outcomes.find(
              (o) => !o.isDefault && evalConds(o.conditions || []),
            );
            if (!m) m = outcomes.find((o) => o.isDefault);
            step.output = m ? `Outcome: "${m.label}"` : 'No matching outcome';
            break;
          }
          case 'get_records': {
            if (!cfg.objectApiName || !cfg.variableName) {
              step.status = 'warning';
              step.output = 'Not configured';
              break;
            }
            const q = {
              tenantId: req.tenantId,
              objectApiName: cfg.objectApiName,
              isDeleted: false,
            };
            (cfg.filters || []).forEach((f) => {
              if (!f.field) return;
              q[f.field === '_id' ? '_id' : `data.${f.field}`] = interp(
                String(f.value ?? ''),
              );
            });
            const recs = await DynamicRecord.find(q)
              .limit(cfg.limit || 10)
              .lean();
            ctx[cfg.variableName] = recs.map((r) => ({
              _id: String(r._id),
              ...(r.data instanceof Map
                ? Object.fromEntries(r.data)
                : r.data || {}),
            }));
            step.output = `Found ${recs.length} record(s) → stored in {$${cfg.variableName}}`;
            break;
          }
          case 'assignment': {
            const results = [];
            (cfg.assignments || []).forEach((a) => {
              if (!a.variable) return;
              const v = interp(String(a.value ?? ''));
              ctx[a.variable] = v;
              results.push(`{$${a.variable}} = "${v}"`);
            });
            step.output = results.length
              ? results.join(' · ')
              : 'No assignments';
            break;
          }
          case 'formula':
            step.output = cfg.outputVariable
              ? `Formula → {$${cfg.outputVariable}} (not evaluated in debug)`
              : 'Not configured';
            if (!cfg.outputVariable) step.status = 'warning';
            break;
          case 'transform':
            step.output = cfg.outputVariable
              ? `→ {$${cfg.outputVariable}}`
              : 'Not configured';
            break;
          case 'collection_filter':
            step.output = `Filter {$${cfg.inputVariable || '?'}} → {$${cfg.outputVariable || '?'}}`;
            break;
          case 'collection_sort':
            step.output = `Sort {$${cfg.inputVariable || '?'}} → {$${cfg.outputVariable || '?'}}`;
            break;
          case 'loop':
            step.output = `Loop over {$${cfg.collectionVariable || '?'}} — ${Array.isArray(ctx[cfg.collectionVariable]) ? ctx[cfg.collectionVariable].length : '?'} items`;
            break;
          case 'action_update_record': {
            const pairs = Object.entries(cfg.fields || {})
              .map(([k, v]) => `${k}="${interp(String(v ?? ''))}"`)
              .join(', ');
            const mode = cfg.recordMode || 'trigger';
            let targetId;
            if (mode === 'trigger') {
              targetId = record?._id;
            } else if (mode === 'variable') {
              targetId = ctx[cfg.recordVariable]?._id;
            } else {
              targetId = interp(String(cfg.recordId || ''));
            }
            const targetLabel =
              mode === 'trigger'
                ? 'trigger record'
                : mode === 'variable'
                  ? `{$${cfg.recordVariable}}`
                  : cfg.recordId || '?';
            if (dryRun) {
              step.output = `[DRY RUN] Would update ${targetLabel}: ${pairs || '(no fields)'}`;
              break;
            }
            if (!targetId) {
              step.output = `No record to update (${targetLabel})`;
              step.status = 'warning';
              break;
            }
            const upd = {};
            Object.entries(cfg.fields || {}).forEach(([k, v]) => {
              upd[`data.${k}`] = interp(String(v ?? ''));
            });
            await DynamicRecord.updateOne(
              { _id: targetId, tenantId: req.tenantId },
              { $set: upd },
            );
            step.output = `Updated ${targetLabel}: ${pairs}`;
            break;
          }
          case 'action_create_record': {
            if (!cfg.objectApiName) {
              step.status = 'warning';
              step.output = 'Not configured';
              break;
            }
            const pairs = Object.entries(cfg.fields || {})
              .map(([k, v]) => `${k}="${interp(String(v ?? ''))}"`)
              .join(', ');
            if (dryRun) {
              step.output = `[DRY RUN] Would create ${cfg.objectApiName}: ${pairs || '(defaults)'}${cfg.outputVariable ? ` → {$${cfg.outputVariable}}` : ''}`;
              break;
            }
            const obj = await ObjectMeta.findOne({
              tenantId: req.tenantId,
              apiName: cfg.objectApiName,
            });
            if (!obj) {
              step.status = 'failed';
              step.output = `Object "${cfg.objectApiName}" not found`;
              break;
            }
            const dm = new Map();
            Object.entries(cfg.fields || {}).forEach(([k, v]) =>
              dm.set(k, interp(String(v ?? ''))),
            );
            const cr = await DynamicRecord.create({
              tenantId: req.tenantId,
              objectId: obj._id,
              objectApiName: cfg.objectApiName,
              data: dm,
              createdBy: req.user._id,
              ownerId: req.user._id,
            });
            if (cfg.outputVariable) {
              const crData =
                cr.data instanceof Map
                  ? Object.fromEntries(cr.data)
                  : cr.data || {};
              ctx[cfg.outputVariable] = {
                _id: String(cr._id),
                objectApiName: cfg.objectApiName,
                ...crData,
              };
            }
            step.output = `Created ${cfg.objectApiName} — id: ${cr._id}${cfg.outputVariable ? ` → stored in {$${cfg.outputVariable}}` : ''}`;
            break;
          }
          case 'delete_records':
            step.output = dryRun
              ? `[DRY RUN] Would delete (mode: ${cfg.mode || 'trigger_record'})`
              : `Deleted (mode: ${cfg.mode || 'trigger_record'})`;
            break;
          case 'action_send_email':
            step.output = dryRun
              ? `[DRY RUN] Email → ${cfg.toField ? `[field:${cfg.toField}]` : interp(cfg.to || '?')} | "${interp(cfg.subject || '')}"`
              : `Email sent`;
            break;
          case 'action_send_notification':
            step.output = dryRun
              ? `[DRY RUN] Notification: "${interp(cfg.title || '')}"`
              : `Notification sent`;
            break;
          case 'action_toast':
            step.output = `Toast (${cfg.type || 'success'}): "${interp(cfg.message || '')}"`;
            break;
          case 'action_wait':
            step.output = `Wait ${cfg.amount || 1} ${cfg.unit || 'minutes'} — skipped`;
            break;
          case 'action_http_request': {
            const url = interp(cfg.url || '');
            if (dryRun) {
              step.output = `[DRY RUN] ${cfg.method || 'POST'} ${url || '(no URL)'}`;
              break;
            }
            const headers = {
              'Content-Type': 'application/json',
              ...(cfg.headers || {}),
            };
            let reqUrl = url;
            if (cfg.externalObjectId) {
              const ext = await ExternalObject.findById(
                cfg.externalObjectId,
              ).select('+credentials');
              if (ext) {
                if (!reqUrl.startsWith('http'))
                  reqUrl =
                    ext.baseUrl.replace(/\/$/, '') +
                    '/' +
                    reqUrl.replace(/^\//, '');
                if (ext.authType === 'bearer' && ext.credentials?.token)
                  headers['Authorization'] = `Bearer ${ext.credentials.token}`;
              }
            }
            const resp = await axios({
              method: (cfg.method || 'POST').toUpperCase(),
              url: reqUrl,
              headers,
              data: cfg.body ? JSON.parse(interp(cfg.body)) : undefined,
              timeout: cfg.timeout || 10000,
            });
            (cfg.responseMapping || []).forEach((m) => {
              if (m.variable && m.path)
                ctx[m.variable] = m.path
                  .split('.')
                  .reduce((o, k) => o?.[k], resp.data);
            });
            step.output = `HTTP ${resp.status} · ${(cfg.method || 'POST').toUpperCase()} ${reqUrl}`;
            break;
          }
          case 'subflow':
            step.output = `[DEBUG] Would call subflow (id: ${cfg.automationId || 'not set'})`;
            break;
          case 'pause':
            step.output = `Pause (${cfg.resumeType === 'time' ? `${cfg.duration || 1} ${cfg.unit || 'hours'}` : 'condition-based'}) — skipped`;
            break;
          case 'screen':
            step.output = cfg.title ? `Screen: "${cfg.title}"` : 'Screen';
            break;
          default:
            step.output = `"${cur.type}" — not evaluated`;
            step.status = 'warning';
        }
      } catch (err) {
        step.status = 'failed';
        step.error = err.message;
        step.output = err.message;
      }

      step.duration = Date.now() - t0;
      step.contextSnapshot = { ...ctx };
      trace.push(step);
      if (stop) break;
      cur = nodeMap[cur.nextNodes?.[0]?.nodeId];
    }

    trace.push({
      id: 'end',
      type: 'end',
      label: 'End',
      status: 'success',
      output: 'Flow completed',
      duration: 0,
      contextSnapshot: { ...ctx },
    });

    sendSuccess(res, {
      data: {
        trace,
        context: ctx,
        record: recFlat,
        duration: Date.now() - globalStart,
        success: !trace.some((s) => s.status === 'failed'),
        dryRun,
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
