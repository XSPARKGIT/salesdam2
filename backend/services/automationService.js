import axios from 'axios';
import Automation from '../models/Automation.js';
import Notification from '../models/Notification.js';
import DynamicRecord from '../models/DynamicRecord.js';
import ObjectMeta from '../models/ObjectMeta.js';
import FieldMeta from '../models/FieldMeta.js';
import ExternalObject from '../models/ExternalObject.js';
import FlowError from '../models/FlowError.js';
import logger from '../utils/logger.js';
import { validateRecordData, checkRecordRules } from './validationService.js';
import { evaluateFormula, configKeysIn } from './formulaParser.js';
import configurationService from './configurationService.js';
import duplicateDetectionService from './duplicateDetectionService.js';

// ─── Recursion / depth guard ──────────────────────────────────────────────────
// Maps `tenantId:automationId` → current execution depth.
// Stored in-process; resets on server restart (acceptable — transient guard).
const _runningDepth = new Map();

function _depthKey(tenantId, automationId) {
  return `${tenantId}:${automationId}`;
}

function _enter(tenantId, automationId) {
  const key = _depthKey(tenantId, automationId);
  _runningDepth.set(key, (_runningDepth.get(key) || 0) + 1);
  return _runningDepth.get(key);
}

function _exit(tenantId, automationId) {
  const key = _depthKey(tenantId, automationId);
  const d = (_runningDepth.get(key) || 1) - 1;
  if (d <= 0) _runningDepth.delete(key);
  else _runningDepth.set(key, d);
}

// ─── Public: fire record-triggered automations ────────────────────────────────
/**
 * Execution order:
 *   1. All active record_triggered automations for (tenantId, objectApiName, event)
 *      are fetched and sorted by `order ASC, createdAt ASC` — lower order fires first.
 *   2. Each automation runs sequentially (not in parallel) so side-effects
 *      of automation N are visible to automation N+1 if it re-queries.
 *   3. Within an automation, nodes execute sequentially following nextNodes.
 *   4. Recursion is blocked by a per-automation depth counter:
 *      - Default `maxDepth: 1` means the automation will not re-enter itself.
 *      - Set `allowRecursion: true` or raise `maxDepth` to allow chaining.
 */
const fireAutomations = async (event, objectApiName, record, tenantId, prev = null) => {
  try {
    const automations = await Automation.find({
      tenantId,
      isActive: true,
      type: 'record_triggered',
      'trigger.objectApiName': objectApiName,
      'trigger.events': { $in: [event, 'all'] },
    }).sort({ order: 1, createdAt: 1 }); // ← deterministic order

    for (const automation of automations) {
      const autoId = String(automation._id);
      const maxDepth = automation.maxDepth ?? 1;

      // ── Recursion guard ──────────────────────────────────────────────────
      const currentDepth = _runningDepth.get(_depthKey(tenantId, autoId)) || 0;
      if (!automation.allowRecursion && currentDepth >= maxDepth) {
        logger.warn(
          `Automation "${automation.name}" skipped — recursion depth ${currentDepth} ≥ maxDepth ${maxDepth}. ` +
            `Set allowRecursion:true or increase maxDepth to enable chaining.`,
        );
        continue;
      }

      const depth = _enter(tenantId, autoId);
      try {
        // BRD 7.1: only run for records that meet the entry conditions. On
        // update, `prev` (the values before the save) feeds ISCHANGED().
        const condMet = await entryConditionMet(automation, record, tenantId, event === 'update' ? prev : null);
        if (!condMet) {
          _exit(tenantId, autoId);
          continue;
        }

        const ctx = buildContext(record, {}, tenantId);
        ctx._automationDepth = depth;
        ctx._automationId = String(automation._id);
        ctx._automationName = automation.name;
        await executeFlow(automation, record, ctx, tenantId);

        await Automation.updateOne(
          { _id: automation._id },
          {
            $inc: { 'stats.totalRuns': 1, 'stats.successRuns': 1 },
            'stats.lastRunAt': new Date(),
            'stats.lastRunStatus': 'success',
          },
        );
      } catch (err) {
        logger.error(`Automation ${automation.name} failed:`, err);
        await Automation.updateOne(
          { _id: automation._id },
          {
            $inc: { 'stats.totalRuns': 1, 'stats.failedRuns': 1 },
            'stats.lastRunAt': new Date(),
            'stats.lastRunStatus': 'failed',
          },
        );
      } finally {
        _exit(tenantId, autoId);
      }
    }
  } catch (err) {
    logger.error('fireAutomations error:', err);
  }
};

// ─── Public: run one named automation against a record ───────────────────────
/**
 * Launch a single active automation for `record`, outside the record-trigger
 * path — used by approval processes to start a flow on submit/approve/reject.
 * `variables` are exposed to the flow as `ctx.variables` (and `{name}` merge
 * tokens). Shares the recursion guard and run stats with fireAutomations.
 *
 * Never throws: a failing flow must not undo the caller's work (e.g. a
 * recorded approval decision). Returns 'success' | 'failed' | 'skipped'.
 */
const runAutomation = async (automationId, record, tenantId, variables = {}, options = {}) => {
  try {
    const automation = await Automation.findOne({
      _id: automationId,
      tenantId,
      isActive: true,
    });
    if (!automation || !record) return 'skipped';
    if (!options.skipEntryCondition && !(await entryConditionMet(automation, record, tenantId))) {
      return 'skipped';
    }

    const autoId = String(automation._id);
    const maxDepth = automation.maxDepth ?? 1;
    const currentDepth = _runningDepth.get(_depthKey(tenantId, autoId)) || 0;
    if (!automation.allowRecursion && currentDepth >= maxDepth) {
      logger.warn(
        `Automation "${automation.name}" skipped — recursion depth ${currentDepth} ≥ maxDepth ${maxDepth}.`,
      );
      return 'skipped';
    }

    const depth = _enter(tenantId, autoId);
    try {
      const ctx = buildContext(record, variables, tenantId);
      ctx._automationDepth = depth;
      ctx._automationId = String(automation._id);
      ctx._automationName = automation.name;
      await executeFlow(automation, record, ctx, tenantId);
      await Automation.updateOne(
        { _id: automation._id },
        {
          $inc: { 'stats.totalRuns': 1, 'stats.successRuns': 1 },
          'stats.lastRunAt': new Date(),
          'stats.lastRunStatus': 'success',
        },
      );
      return 'success';
    } catch (err) {
      logger.error(`Automation ${automation.name} failed:`, err);
      await Automation.updateOne(
        { _id: automation._id },
        {
          $inc: { 'stats.totalRuns': 1, 'stats.failedRuns': 1 },
          'stats.lastRunAt': new Date(),
          'stats.lastRunStatus': 'failed',
        },
      );
      return 'failed';
    } finally {
      _exit(tenantId, autoId);
    }
  } catch (err) {
    logger.error('runAutomation error:', err);
    return 'failed';
  }
};

// ─── Entry conditions (BRD 7.1) ───────────────────────────────────────────────
const dataOfRecord = (record) =>
  record?.data instanceof Map ? Object.fromEntries(record.data) : record?.data || {};

/**
 * Does `record` meet the flow's entry conditions? Both the formula Entry
 * Condition (same language as Validation Rules — ISCHANGED compares with
 * `prev`, the values before an update; CONFIG reads tenant configuration) and
 * any older list-style conditions must pass. A formula that can't be
 * evaluated counts as not met, so a broken condition never runs a flow on
 * every record.
 */
const entryConditionMet = async (automation, record, tenantId, prev = null) => {
  const trigger = automation.trigger || {};
  if (trigger.runWhen === 'conditions_met' && (trigger.conditions || []).length) {
    if (!evaluateConditions(trigger.conditions, record, trigger.conditionLogic || 'all', prev)) return false;
  }
  const expression = String(trigger.entryCondition || '').trim();
  if (!expression) return true;
  try {
    const keys = configKeysIn(expression);
    const __config = keys.length ? await configurationService.resolveMany(keys, tenantId) : {};
    return Boolean(
      evaluateFormula(expression, { ...dataOfRecord(record), __config, ...(prev ? { __prev: prev } : {}) }),
    );
  } catch (err) {
    logger.warn(`Entry condition of flow "${automation.name}" could not be evaluated: ${err.message}`);
    return false;
  }
};

// ─── Condition evaluation ─────────────────────────────────────────────────────
// `prev` (the values before an update) makes the 'changed' operator real; with
// no previous values (create, scheduled, manual) nothing counts as changed.
const evaluateConditions = (conditions, record, logic = 'all', prev = null, vars = null) => {
  if (!conditions || conditions.length === 0) return true;

  const evalOne = (cond) => {
    let fieldValue =
      record.data instanceof Map
        ? record.data.get(cond.field)
        : record.data?.[cond.field];
    // BRD 15.1.7: a decision can branch on a value a earlier step returned, e.g. field "$review.risk".
    if (vars && typeof cond.field === 'string' && cond.field.startsWith('$')) {
      fieldValue = cond.field.slice(1).split('.').reduce((o, k) => (o == null ? undefined : o[k]), vars);
    }

    const fvStr = typeof fieldValue === 'string' ? fieldValue.toLowerCase() : fieldValue;
    const cvStr = typeof cond.value === 'string' ? cond.value.toLowerCase() : cond.value;

    switch (cond.operator) {
      case 'equals':
        return (typeof fieldValue === 'string' && typeof cond.value === 'string') ? fvStr === cvStr : fieldValue == cond.value;
      case 'not_equals':
        return (typeof fieldValue === 'string' && typeof cond.value === 'string') ? fvStr !== cvStr : fieldValue != cond.value;
      case 'contains':
        return String(fieldValue || '').toLowerCase().includes(String(cond.value || '').toLowerCase());
      case 'starts_with':
        return String(fieldValue || '').toLowerCase().startsWith(String(cond.value || '').toLowerCase());
      case 'ends_with':
        return String(fieldValue || '').toLowerCase().endsWith(String(cond.value || '').toLowerCase());
      case 'greater_than':
        return parseFloat(fieldValue) > parseFloat(cond.value);
      case 'less_than':
        return parseFloat(fieldValue) < parseFloat(cond.value);
      case 'gte':
        return parseFloat(fieldValue) >= parseFloat(cond.value);
      case 'lte':
        return parseFloat(fieldValue) <= parseFloat(cond.value);
      case 'is_null':
        return fieldValue == null || fieldValue === '';
      case 'is_not_null':
        return fieldValue != null && fieldValue !== '';
      case 'changed':
        return prev ? String(prev[cond.field] ?? '') !== String(fieldValue ?? '') : false;
      default:
        return true;
    }
  };

  return logic === 'any' ? conditions.some(evalOne) : conditions.every(evalOne);
};

// ─── Flow execution ───────────────────────────────────────────────────────────
// ─── Test & Debug instrumentation ─────────────────────────────────────────────
// The Test panel runs flows through these very executors rather than a separate
// simulator, so what it reports is what production does. Two opt-in channels on
// ctx drive it, and both are inert during a normal run:
//   ctx._trace   — an array; when present, every node appends its own entry
//   ctx._dryRun  — when true, side-effecting steps describe what they would do
//                  instead of writing, sending or calling out
const isTracing = (ctx) => Array.isArray(ctx?._trace);

/** True when the step currently running must not touch the outside world. */
const dry = (ctx) => ctx?._dryRun === true;

/**
 * Record what the step currently executing did, for the Test panel's trace.
 * Cases and action executors call this freely; outside a traced run it costs
 * one property read and returns.
 */
const say = (ctx, output, status) => {
  const step = ctx?._step;
  if (!step) return;
  if (output != null) step.output = output;
  // 'success' is the default, so only a deliberate downgrade overwrites it —
  // and an earlier 'warning' never masks a 'failed' recorded by the wrapper.
  if (status && step.status !== 'failed') step.status = status;
};

const executeFlow = async (automation, record, ctx, tenantId) => {
  const startNode = automation.nodes.find((n) => n.type === 'trigger');
  if (!startNode) return;
  await executeNode(startNode, automation.nodes, record, ctx, tenantId);
};

// ─── Helpers for the data-shaping steps ───────────────────────────────────────

// Hard ceiling on Loop iterations. A flow can build its own collection (Get
// Records → Transform → Loop), so without a cap a mis-wired flow could spin
// against the database indefinitely.
const MAX_LOOP_ITERATIONS = 1000;

/** Coerce a Formula step's result to the data type the step declares. */
const castFormulaValue = (value, dataType) => {
  if (value == null) return value;
  switch (dataType) {
    case 'number': {
      const n = Number(value);
      return Number.isNaN(n) ? null : n;
    }
    case 'boolean':
      // "false" and "0" are falsy to a user even though they're truthy strings.
      if (typeof value === 'string') return !['', 'false', '0', 'no'].includes(value.toLowerCase());
      return Boolean(value);
    case 'date': {
      const d = value instanceof Date ? value : new Date(value);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    case 'text':
      return value instanceof Date ? value.toISOString() : String(value);
    default:
      return value; // 'auto' / unset — keep whatever the formula produced
  }
};

/** Apply one Transform Data operation to a single value. */
const applyTransform = (value, op) => {
  if (op === 'none' || !op) return value;
  // Every operation below needs a value; passing null through keeps an empty
  // source field empty rather than turning it into "null" or 0.
  if (value == null) return value;
  switch (op) {
    case 'uppercase': return String(value).toUpperCase();
    case 'lowercase': return String(value).toLowerCase();
    case 'trim': return String(value).trim();
    case 'toString': return value instanceof Date ? value.toISOString() : String(value);
    case 'toNumber': { const n = Number(value); return Number.isNaN(n) ? null : n; }
    case 'toDate': { const d = value instanceof Date ? value : new Date(value); return Number.isNaN(d.getTime()) ? null : d; }
    case 'toBoolean':
      if (typeof value === 'string') return !['', 'false', '0', 'no'].includes(value.toLowerCase());
      return Boolean(value);
    case 'round': { const n = Number(value); return Number.isNaN(n) ? null : Math.round(n); }
    case 'abs': { const n = Number(value); return Number.isNaN(n) ? null : Math.abs(n); }
    default: return value;
  }
};

/**
 * Compare two values for Collection Sort. Numbers and dates compare naturally;
 * everything else compares as case-insensitive text so "Beta" doesn't sort
 * before "alpha" the way a raw string compare would.
 */
const compareForSort = (a, b) => {
  if (a instanceof Date || b instanceof Date) {
    return new Date(a).getTime() - new Date(b).getTime();
  }
  const na = Number(a);
  const nb = Number(b);
  if (a !== '' && b !== '' && !Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  return String(a).toLowerCase().localeCompare(String(b).toLowerCase());
};

// Execute an inline steps array (Decision/Loop branch steps stored in config)
const executeSteps = async (steps, allNodes, record, ctx, tenantId) => {
  // Inline steps sit inside their parent (a Decision outcome or a Loop body),
  // so a trace indents them one level under it.
  const parentDepth = ctx._depth || 0;
  ctx._depth = parentDepth + 1;
  try {
    for (const step of steps) {
      // Inline steps carry their own config — treat them as self-contained nodes
      await executeNode(step, allNodes, record, ctx, tenantId);
    }
  } finally {
    ctx._depth = parentDepth;
  }
};

const executeNodeInner = async (node, allNodes, record, ctx, tenantId) => {
  try {
  switch (node.type) {
    case 'trigger':
      say(ctx, 'Flow entered');
      break; // just start — fall through to nextNodes

    case 'condition': {
      const condFields = node.config?.conditions || [];
      const logic = node.config?.logic || 'all';
      const passed =
        logic === 'all'
          ? condFields.every((c) => evaluateConditions([c], record))
          : condFields.some((c) => evaluateConditions([c], record));

      // Follow the correct branch
      const yesNodes = (node.nextNodes || []).filter(
        (n) => n.label === 'Yes' || n.branch === 'yes',
      );
      const noNodes = (node.nextNodes || []).filter(
        (n) => n.label === 'No' || n.branch === 'no',
      );
      const branch = passed ? yesNodes : noNodes;
      say(
        ctx,
        passed
          ? `Passed (${logic === 'all' ? 'all' : 'any'} of ${condFields.length} condition(s)) - taking Yes`
          : `Not met - taking No${noNodes.length ? '' : ' (nothing wired, flow stops here)'}`,
        passed || noNodes.length ? undefined : 'skipped',
      );

      for (const next of branch) {
        const nextNode = allNodes.find((n) => n.id === next.nodeId);
        if (nextNode)
          await executeNode(nextNode, allNodes, record, ctx, tenantId);
      }
      return; // skip the default nextNodes loop below
    }

    case 'decision': {
      const outcomes = node.config?.outcomes || [];
      // Evaluate outcomes in order; first match wins; default outcome is the fallback
      let matchedOutcome = null;
      for (const outcome of outcomes) {
        if (outcome.isDefault) continue; // skip default — evaluate last
        const conditions = outcome.conditions || [];
        const logic = outcome.logic || 'all';
        const passed =
          conditions.length === 0
            ? false
            : logic === 'all'
              ? conditions.every((c) => evaluateConditions([c], record, 'all', null, ctx.variables))
              : conditions.some((c) => evaluateConditions([c], record, 'all', null, ctx.variables));
        if (passed) {
          matchedOutcome = outcome;
          break;
        }
      }
      // Fall through to default outcome if nothing matched
      if (!matchedOutcome) {
        matchedOutcome = outcomes.find((o) => o.isDefault) || null;
      }
      say(
        ctx,
        matchedOutcome
          ? // The builder writes `label`; flows built through the API carry
            // `name`. Read either so the trace names the branch it took.
            `Outcome "${matchedOutcome.label || matchedOutcome.name || '(unnamed)'}"${matchedOutcome.isDefault ? ' (default)' : ''} - ${(matchedOutcome.steps || []).length} step(s)`
          : 'No outcome matched and no default set - nothing ran',
        matchedOutcome ? undefined : 'warning',
      );
      if (matchedOutcome) {
        await executeSteps(
          matchedOutcome.steps || [],
          allNodes,
          record,
          ctx,
          tenantId,
        );
      }
      return; // skip the default nextNodes loop
    }

    case 'action_send_notification':
      await executeNotification(node.config, record, ctx, tenantId);
      break;

    case 'action_send_email':
      await executeEmail(node.config, record, ctx, tenantId);
      break;

    case 'action_send_message_template':
      await executeSendMessageTemplate(node.config, record, ctx, tenantId);
      break;

    case 'action_webhook':
    case 'action_http_request':
      await executeHttpRequest(node.config, record, ctx, tenantId);
      break;

    case 'action_update_record':
      await executeUpdateRecord(node.config, record, ctx, tenantId);
      break;

    case 'action_create_record':
      await executeCreateRecord(node.config, record, ctx, tenantId);
      break;

    case 'action_generate_pdf': {
      const { templateId, inputMappings = {}, fileName, saveToFiles = true, outputVariable } = node.config || {};
      if (!templateId) {
        say(ctx, 'No PDF template selected - nothing generated', 'warning');
        break;
      }
      if (dry(ctx)) {
        say(ctx, `[DRY RUN] Would render PDF template ${templateId}`);
        break;
      }
      try {
        const { renderPdfTemplate } = await import('./pdfRenderService.js');
        const { default: File } = await import('../models/File.js');
        // BRD 15.3.13: the template is rendered against the flow's record (it was rendered with none),
        // and any inputs the step maps ({record.x} / {$var} / literals) are passed through.
        const mapped = {};
        for (const [k, v] of Object.entries(inputMappings || {})) mapped[k] = typeof v === 'string' ? interpolate(v, record, ctx) : v;
        const buffer = await renderPdfTemplate(tenantId, templateId, record?._id || null, { inputs: mapped });
        if (saveToFiles !== false) {
          const tmpl = await (await import('../models/PdfTemplate.js')).default.findById(templateId);
          const recordData = record.data instanceof Map ? Object.fromEntries(record.data) : (record.data || {});
          const resolvedFileName = (fileName || tmpl?.apiName || 'document').replace(/\{(\w+)\.(\w+)\}/g, (_, inputName, fieldApiName) => {
            if (inputName === 'record') return recordData[fieldApiName] ?? '';
            return '';
          });
          const name = resolvedFileName + (resolvedFileName.toLowerCase().endsWith('.pdf') ? '' : '.pdf');
          const file = await File.create({
            tenantId,
            createdBy: ctx._userId || null,
            lastModifiedBy: ctx._userId || null,
            name,
            mimeType: 'application/pdf',
            data: buffer.toString('base64'),
            sizeBytes: buffer.length,
            relatedTo: { objectApiName: record.objectApiName, recordId: record._id },
            scanStatus: 'skipped',
            scanResult: 'Generated document',
            isAvailable: true,
            version: 1,
            pdfTemplateId: templateId,
          });
          if (outputVariable) ctx.variables[outputVariable] = String(file._id);
          say(ctx, `Generated ${name} (${buffer.length} bytes)`);
        } else {
          say(ctx, `Rendered PDF (${buffer.length} bytes, not saved to Files)`);
        }
      } catch (err) {
        logger.error(`PDF generation node failed: ${err.message}`);
        throw err;
      }
      break;
    }

    case 'custom_code': {
      const { name: ccName, inputs: ccInputs = {}, outputVariable } = node.config || {};
      if (!ccName) {
        say(ctx, 'No function selected - nothing ran', 'warning');
        break;
      }
      // Custom code is arbitrary tenant-authored JavaScript, so a dry run
      // cannot know whether it writes or calls out. It does not run.
      if (dry(ctx)) {
        say(ctx, `[DRY RUN] Would run custom code "${ccName}"`);
        break;
      }
      try {
        const { executeCustomCode } = await import('./customCodeService.js');
        const res = await executeCustomCode(tenantId, ccName, ccInputs, { record, ctx });
        if (outputVariable) {
          ctx.variables[outputVariable] = res.output;
          ctx.variables[`${outputVariable}__ok`] = true;
          ctx.variables[`${outputVariable}__error`] = '';
        }
        say(
          ctx,
          `Ran "${ccName}"` + (outputVariable ? ` -> {$${outputVariable}} = ${JSON.stringify(res.output)}` : ''),
        );
      } catch (err) {
        // Custom code failures are contained here rather than failing the flow,
        // so the trace has to carry the error itself.
        // BRD 15.1.10: later steps can test {$<outputVariable>__ok} / {$<outputVariable>__error}.
        if (outputVariable) {
          ctx.variables[outputVariable] = null;
          ctx.variables[`${outputVariable}__ok`] = false;
          ctx.variables[`${outputVariable}__error`] = err.message;
        }
        say(ctx, `Custom code "${ccName}" failed: ${err.message}`, 'failed');
        logger.error(`Custom code node failed: ${err.message}`);
      }
      break;
    }

    case 'action_update_related_records':
      await executeUpdateRelatedRecords(node.config, record, ctx, tenantId);
      break;

    case 'action_wait':
      // In production this would use a job queue. Here we simply log and continue.
      say(
        ctx,
        `Wait ${node.config?.amount || 0} ${node.config?.unit || 'seconds'} - not suspended, flow continues`,
        'warning',
      );
      logger.info(
        `Automation wait: ${node.config?.amount || 0} ${node.config?.unit || 'seconds'}`,
      );
      break;

    case 'get_records': {
      const {
        objectApiName: objName,
        filters: recFilters = [],
        sort = '-createdAt',
        limit = 10,
        variableName = 'records',
      } = node.config || {};
      if (!objName || !variableName) {
        say(ctx, 'Needs both an object and a variable name - skipped', 'warning');
        break;
      }

      const matchQuery = { tenantId, objectApiName: objName, isDeleted: false };
      recFilters.forEach((f) => {
        if (!f.field || f.value == null) return;
        const resolved = interpolate(String(f.value), record, ctx);
        if (f.field === '_id' || f.field === 'id') {
          matchQuery['_id'] = resolved;
        } else {
          matchQuery[`data.${f.field}`] = resolved;
        }
      });

      const sortField = sort.startsWith('-') ? sort.slice(1) : sort;
      const sortDir = sort.startsWith('-') ? -1 : 1;
      const sortObj = ['createdAt', 'updatedAt'].includes(sortField)
        ? { [sortField]: sortDir }
        : { [`data.${sortField}`]: sortDir };

      const recs = await DynamicRecord.find(matchQuery)
        .sort(sortObj)
        .limit(parseInt(limit))
        .lean();
      const flattened = recs.map((r) => ({
        _id: String(r._id),
        createdAt: r.createdAt?.toISOString(),
        ...(r.data instanceof Map ? Object.fromEntries(r.data) : r.data || {}),
      }));

      ctx.variables[variableName] = flattened;
      ctx.variables[`${variableName}_count`] = flattened.length;
      // Flatten first record fields for direct {variableName_fieldName} access
      if (flattened.length > 0) {
        Object.entries(flattened[0]).forEach(([k, v]) => {
          ctx.variables[`${variableName}_${k}`] = v;
        });
      }
      say(
        ctx,
        `Found ${flattened.length} ${objName} record(s) -> {$${variableName}}`,
        flattened.length ? undefined : 'warning',
      );
      logger.info(
        `get_records: fetched ${flattened.length} ${objName} records → ctx.variables.${variableName}`,
      );
      break;
    }

    case 'assignment': {
      // Assign variables from record fields
      const assigned = [];
      (node.config?.assignments || []).forEach((a) => {
        if (!a.variable) return;
        ctx.variables[a.variable] = interpolate(a.value, record, ctx);
        assigned.push(`{$${a.variable}} = "${ctx.variables[a.variable]}"`);
      });
      say(
        ctx,
        assigned.length ? assigned.join(' | ') : 'No assignments configured',
        assigned.length ? undefined : 'warning',
      );
      break;
    }

    // ── Formula ───────────────────────────────────────────────────────────
    // Evaluate an expression in the same language as Validation Rules and
    // store the result in a flow variable for later steps to use.
    case 'formula': {
      const { formula, outputVariable, dataType } = node.config || {};
      if (!formula || !outputVariable) {
        say(ctx, 'Needs both a formula and an output variable - skipped', 'warning');
        logger.warn('formula: needs both a formula and an output variable — skipped');
        break;
      }
      // The expression sees the record's own fields plus every variable set so
      // far, so a formula can build on an earlier Get Records or Assignment.
      const fValue = evaluateFormula(formula, {
        ...dataOfRecord(record),
        ...ctx.variables,
      });
      ctx.variables[outputVariable] = castFormulaValue(fValue, dataType);
      say(ctx, `${formula} -> {$${outputVariable}} = ${JSON.stringify(ctx.variables[outputVariable])}`);
      logger.info(`formula: ${outputVariable} = ${JSON.stringify(ctx.variables[outputVariable])}`);
      break;
    }

    // ── Transform Data ────────────────────────────────────────────────────
    // Reshape one variable into another, renaming fields and optionally
    // converting each value. Works on a single object or a whole collection.
    case 'transform': {
      const { inputVariable, outputVariable, mappings = [] } = node.config || {};
      if (!inputVariable || !outputVariable) {
        say(ctx, 'Needs both an input and an output variable - skipped', 'warning');
        logger.warn('transform: needs both an input and an output variable — skipped');
        break;
      }
      const tInput = ctx.variables[inputVariable];
      if (tInput == null) {
        say(ctx, `{$${inputVariable}} is not set - skipped`, 'warning');
        logger.warn(`transform: {$${inputVariable}} is not set — skipped`);
        break;
      }
      const mapOne = (item) => {
        const src = item && typeof item === 'object' ? item : {};
        // No mappings means "copy as-is", which is what the builder's own
        // hint promises when the mapping list is left empty.
        if (mappings.length === 0) return { ...src };
        const out = {};
        for (const m of mappings) {
          if (!m.target) continue;
          out[m.target] = applyTransform(src[m.source], m.transform);
        }
        return out;
      };
      ctx.variables[outputVariable] = Array.isArray(tInput) ? tInput.map(mapOne) : mapOne(tInput);
      say(
        ctx,
        `{$${inputVariable}} -> {$${outputVariable}} (${Array.isArray(tInput) ? `${tInput.length} item(s)` : 'single record'}, ${mappings.length || 'no'} mapping(s))`,
      );
      logger.info(
        `transform: {$${inputVariable}} → {$${outputVariable}} (${Array.isArray(tInput) ? `${tInput.length} items` : 'single record'})`,
      );
      break;
    }

    // ── Collection Filter ─────────────────────────────────────────────────
    // Narrow a collection down to the items matching a set of conditions.
    case 'collection_filter': {
      const { inputVariable, outputVariable, conditions = [], logic = 'all' } = node.config || {};
      if (!inputVariable || !outputVariable) {
        say(ctx, 'Needs both an input and an output variable - skipped', 'warning');
        logger.warn('collection_filter: needs both an input and an output variable — skipped');
        break;
      }
      const cfInput = ctx.variables[inputVariable];
      if (!Array.isArray(cfInput)) {
        say(ctx, `{$${inputVariable}} is not a collection - skipped`, 'warning');
        logger.warn(`collection_filter: {$${inputVariable}} is not a collection — skipped`);
        break;
      }
      // evaluateConditions reads fields off `record.data`, so each plain item
      // is wrapped to look like a record for the duration of the test.
      const kept = cfInput.filter((item) => evaluateConditions(conditions, { data: item }, logic));
      ctx.variables[outputVariable] = kept;
      ctx.variables[`${outputVariable}_count`] = kept.length;
      say(
        ctx,
        `${cfInput.length} -> ${kept.length} item(s) kept (${logic}) -> {$${outputVariable}}`,
      );
      logger.info(
        `collection_filter: ${cfInput.length} → ${kept.length} item(s) in {$${outputVariable}}`,
      );
      break;
    }

    // ── Collection Sort ───────────────────────────────────────────────────
    // Order a collection by one or more fields.
    case 'collection_sort': {
      const {
        inputVariable, outputVariable, sortFields = [], nullsLast = true,
      } = node.config || {};
      if (!inputVariable || !outputVariable) {
        say(ctx, 'Needs both an input and an output variable - skipped', 'warning');
        logger.warn('collection_sort: needs both an input and an output variable — skipped');
        break;
      }
      const csInput = ctx.variables[inputVariable];
      if (!Array.isArray(csInput)) {
        say(ctx, `{$${inputVariable}} is not a collection - skipped`, 'warning');
        logger.warn(`collection_sort: {$${inputVariable}} is not a collection — skipped`);
        break;
      }
      const active = sortFields.filter((s) => s && s.field);
      // Copy first: sort() mutates, and the input variable may still be needed.
      const sorted = [...csInput].sort((a, b) => {
        for (const s of active) {
          const av = a?.[s.field];
          const bv = b?.[s.field];
          const aEmpty = av == null || av === '';
          const bEmpty = bv == null || bv === '';
          // Empty values collect at one end regardless of sort direction, so
          // "nulls last" still means last when sorting descending.
          if (aEmpty || bEmpty) {
            if (aEmpty && bEmpty) continue;
            return (aEmpty ? 1 : -1) * (nullsLast ? 1 : -1);
          }
          const cmp = compareForSort(av, bv);
          if (cmp !== 0) return s.direction === 'desc' ? -cmp : cmp;
        }
        return 0;
      });
      ctx.variables[outputVariable] = sorted;
      ctx.variables[`${outputVariable}_count`] = sorted.length;
      say(
        ctx,
        `Sorted ${sorted.length} item(s) by ${active.map((f) => `${f.field} ${f.direction || 'asc'}`).join(', ') || '(nothing configured)'} -> {$${outputVariable}}`,
        active.length ? undefined : 'warning',
      );
      logger.info(
        `collection_sort: ${sorted.length} item(s) by ${active.map((s) => `${s.field} ${s.direction || 'asc'}`).join(', ') || '(nothing)'} → {$${outputVariable}}`,
      );
      break;
    }

    // ── Loop ──────────────────────────────────────────────────────────────
    // Run the loop body once per item in a collection.
    case 'loop': {
      const {
        collectionVariable, iterationVariable, direction = 'first_to_last', steps = [],
      } = node.config || {};
      if (!collectionVariable || !iterationVariable) {
        say(ctx, 'Needs both a collection and an iteration variable - skipped', 'warning');
        logger.warn('loop: needs both a collection and an iteration variable — skipped');
        break;
      }
      const coll = ctx.variables[collectionVariable];
      if (!Array.isArray(coll)) {
        say(ctx, `{$${collectionVariable}} is not a collection - skipped`, 'warning');
        logger.warn(`loop: {$${collectionVariable}} is not a collection — skipped`);
        break;
      }
      const ordered = direction === 'last_to_first' ? [...coll].reverse() : coll;
      const items = ordered.slice(0, MAX_LOOP_ITERATIONS);
      if (ordered.length > items.length) {
        logger.warn(
          `loop: {$${collectionVariable}} has ${ordered.length} items — capped at ${MAX_LOOP_ITERATIONS}`,
        );
      }
      for (let i = 0; i < items.length; i++) {
        // The body reads the current item as {$iterationVariable}; the index
        // is published too so a body step can number its output.
        ctx.variables[iterationVariable] = items[i];
        ctx.variables[`${iterationVariable}_index`] = i;
        await executeSteps(steps, allNodes, record, ctx, tenantId);
      }
      say(
        ctx,
        `Ran ${items.length} iteration(s) over {$${collectionVariable}} (${direction}), ${steps.length} step(s) each`,
      );
      logger.info(`loop: ran ${items.length} iteration(s) over {$${collectionVariable}}`);
      break;
    }

    // ── Delete Records ────────────────────────────────────────────────────
    // Soft-delete records, matching how the rest of the app deletes: the row
    // stays and is filtered out by isDeleted, so it remains recoverable.
    case 'delete_records': {
      const {
        mode = 'trigger_record', objectApiName: delObj, collectionVariable: delColl, filters = [],
      } = node.config || {};
      const softDelete = { isDeleted: true, deletedAt: new Date() };
      let deleted = 0;

      if (mode === 'trigger_record') {
        if (!record?._id) {
          say(ctx, 'No trigger record to delete - skipped', 'warning');
          logger.warn('delete_records: no trigger record to delete — skipped');
          break;
        }
        if (dry(ctx)) {
          say(ctx, `[DRY RUN] Would delete trigger record ${record._id}`);
          break;
        }
        const r = await DynamicRecord.updateOne(
          { _id: record._id, tenantId, isDeleted: false },
          { $set: softDelete },
        );
        deleted = r.modifiedCount || 0;
      } else if (mode === 'collection') {
        const items = ctx.variables[delColl];
        if (!Array.isArray(items)) {
          say(ctx, `{$${delColl}} is not a collection - skipped`, 'warning');
          logger.warn(`delete_records: {$${delColl}} is not a collection — skipped`);
          break;
        }
        const ids = items.map((i) => i?._id).filter(Boolean);
        if (dry(ctx)) {
          say(ctx, `[DRY RUN] Would delete ${ids.length} record(s) from {$${delColl}}`);
          break;
        }
        if (ids.length) {
          const r = await DynamicRecord.updateMany(
            { _id: { $in: ids }, tenantId, isDeleted: false },
            { $set: softDelete },
          );
          deleted = r.modifiedCount || 0;
        }
      } else if (mode === 'query') {
        if (!delObj) {
          say(ctx, 'Query mode needs an object - skipped', 'warning');
          logger.warn('delete_records: query mode needs an object — skipped');
          break;
        }
        // Refuse an unfiltered query: it would delete every record of the
        // object, which is never what an admin means to configure.
        const usable = filters.filter((f) => f && f.field);
        if (!usable.length) {
          say(
            ctx,
            `Query mode on ${delObj} has no filters - refused, it would delete every record`,
            'warning',
          );
          logger.warn(`delete_records: query mode on ${delObj} has no filters — skipped`);
          break;
        }
        const q = { tenantId, objectApiName: delObj, isDeleted: false };
        usable.forEach((f) => {
          q[`data.${f.field}`] = interpolate(String(f.value ?? ''), record, ctx);
        });
        if (dry(ctx)) {
          const wouldDelete = await DynamicRecord.countDocuments(q);
          say(ctx, `[DRY RUN] Would delete ${wouldDelete} ${delObj} record(s)`);
          break;
        }
        const r = await DynamicRecord.updateMany(q, { $set: softDelete });
        deleted = r.modifiedCount || 0;
      }

      ctx.variables.deletedCount = deleted;
      say(ctx, `Soft-deleted ${deleted} record(s) (mode: ${mode}) -> {$deletedCount}`);
      logger.info(`delete_records: soft-deleted ${deleted} record(s) (mode: ${mode})`);
      break;
    }

    // ── Subflow ───────────────────────────────────────────────────────────
    // Call another automation and bring its variables back.
    case 'subflow': {
      const { automationId, inputMappings = [], outputMappings = [] } = node.config || {};
      if (!automationId) {
        say(ctx, 'No automation selected - skipped', 'warning');
        logger.warn('subflow: no automation selected — skipped');
        break;
      }
      const sub = await Automation.findOne({ _id: automationId, tenantId });
      if (!sub) {
        say(ctx, `Automation ${automationId} not found in this tenant - skipped`, 'warning');
        logger.warn(`subflow: automation ${automationId} not found in this tenant — skipped`);
        break;
      }
      // A subflow gets its own variable scope so it cannot clobber the
      // caller's; only the variables named in outputMappings come back.
      // Its own variable scope, and one level deeper in the trace.
      const subCtx = { ...ctx, variables: {}, _depth: (ctx._depth || 0) + 1 };
      for (const m of inputMappings) {
        if (!m.target) continue;
        subCtx.variables[m.target] = interpolate(String(m.source ?? ''), record, ctx);
      }
      const subStart = (sub.nodes || []).find((n) => n.type === 'trigger');
      if (!subStart) {
        say(ctx, `"${sub.name}" has no trigger node - skipped`, 'warning');
        logger.warn(`subflow: "${sub.name}" has no trigger node — skipped`);
        break;
      }
      await executeNode(subStart, sub.nodes || [], record, subCtx, tenantId);
      for (const m of outputMappings) {
        if (!m.source || !m.target) continue;
        ctx.variables[m.target] = subCtx.variables[m.source];
      }
      say(
        ctx,
        `Ran "${sub.name}", returned ${outputMappings.length} variable(s)` +
          (outputMappings.length
            ? `: ${outputMappings.filter((m) => m.target).map((m) => `{$${m.target}}`).join(', ')}`
            : ''),
      );
      logger.info(`subflow: ran "${sub.name}", returned ${outputMappings.length} variable(s)`);
      break;
    }

    // ── Pause ─────────────────────────────────────────────────────────────
    case 'pause':
      // Same limitation as Wait / Delay: suspending a run and resuming it
      // later needs a durable job queue, which this server does not have.
      // Log what was configured and carry on rather than silently stalling.
      say(
        ctx,
        `Pause (${node.config?.resumeType === 'time'
          ? `${node.config?.duration || 1} ${node.config?.unit || 'hours'}`
          : 'condition-based'}) - not suspended, flow continues`,
        'warning',
      );
      logger.info(
        `Automation pause (${node.config?.resumeType === 'time'
          ? `${node.config?.duration || 1} ${node.config?.unit || 'hours'}`
          : 'condition-based'}) — continuing without pausing`,
      );
      break;

    case 'action_toast':
      say(
        ctx,
        `Toast (${node.config?.type || 'success'}): "${interpolate(node.config?.message || 'Done', record, ctx)}"` +
          ' - shown only in a button or screen flow',
      );
      break;

    case 'navigate': {
      const navTarget =
        (node.config?.targetType || 'record_list') === 'record_detail'
          ? `${node.config?.objectApiName || '?'} record ${interpolate(String(node.config?.recordId || ''), record, ctx) || '(none)'}`
          : `${node.config?.objectApiName || '?'} list`;
      say(ctx, `Navigate to ${navTarget} - applied only in a button or screen flow`);
      break;
    }

    case 'screen':
      // In a live screen flow the run suspends here until the person submits.
      // A test run has nobody to collect input from, so it steps past and says
      // so rather than reporting a screen that was never shown.
      {
        // The builder stores screen inputs under `components`.
        const comps = node.config?.components || [];
        const names = comps.map((c) => c.apiName).filter(Boolean);
        say(
          ctx,
          `Screen "${node.config?.title || node.label || 'Untitled'}" - not displayed in a test run` +
            (names.length
              ? `, so ${names.map((f) => `{${f}}`).join(', ')} stay unresolved`
              : ', no inputs defined'),
          'warning',
        );
      }
      break;

    case 'end':
      say(ctx, 'Flow completed');
      return;

    default:
      // A node type the executor has no case for does nothing at runtime. The
      // trace has to say so plainly rather than report a silent success.
      say(ctx, `"${node.type}" is not implemented by the executor - nothing ran`, 'warning');
      logger.warn(`Unknown automation node type: ${node.type}`);
  }

  // Default: follow all nextNodes (non-branching)
  for (const next of node.nextNodes || []) {
    if (next.condition && !evaluateConditions([next.condition], record))
      continue;
    const nextNode = allNodes.find((n) => n.id === next.nodeId);
    if (nextNode) await executeNode(nextNode, allNodes, record, ctx, tenantId);
  }
  } catch (err) {
    // Persist a FlowError so admins can see it in the UI, then re-throw so
    // the automation-level stats are updated as failed.
    try {
      await FlowError.create({
        tenantId,
        automationId: ctx._automationId || null,
        automationName: ctx._automationName || null,
        objectApiName: record.objectApiName || null,
        recordId: String(record._id || ''),
        stepId: node.id || null,
        stepLabel: node.label || null,
        stepType: node.type || null,
        errorMessage: err.message,
        errorStack: err.stack,
      });
    } catch (saveErr) {
      logger.warn('Failed to save FlowError:', saveErr.message);
    }
    throw err;
  }
};

/**
 * Runs one node, and when a trace is attached to ctx records how it went.
 * Branching cases (Decision, Loop, Subflow) recurse through this wrapper too,
 * so nested steps are captured in execution order at increasing depth.
 */
const executeNode = async (node, allNodes, record, ctx, tenantId) => {
  if (!isTracing(ctx))
    return executeNodeInner(node, allNodes, record, ctx, tenantId);

  const entry = {
    id: node.id || node.type,
    type: node.type,
    label: node.label || node.type,
    depth: ctx._depth || 0,
    status: 'success',
    output: '',
    error: null,
    duration: 0,
    contextSnapshot: null,
  };
  // Pushed before the node runs so steps nested inside a Loop or Decision land
  // after their parent, in the order they actually executed.
  ctx._trace.push(entry);

  const parentStep = ctx._step;
  ctx._step = entry;
  const startedAt = Date.now();
  try {
    await executeNodeInner(node, allNodes, record, ctx, tenantId);
  } catch (err) {
    entry.status = 'failed';
    entry.error = err.message;
    if (!entry.output) entry.output = err.message;
    throw err;
  } finally {
    // A container step's duration covers its children, which is what an admin
    // reading "Loop — 240ms" expects it to mean.
    entry.duration = Date.now() - startedAt;
    entry.contextSnapshot = { ...(ctx.variables || {}) };
    ctx._step = parentStep;
  }
};

// ─── Action executors ─────────────────────────────────────────────────────────

async function executeNotification(config, record, ctx, tenantId) {
  // Resolve recipient IDs based on recipientType
  let recipientIds = [];

  const rType = config.recipientType || 'owner';
  if (rType === 'owner') {
    const id = record.ownerId || record.createdBy;
    if (id) recipientIds.push(String(id));
  } else if (rType === 'creator') {
    const id = record.createdBy || record.ownerId;
    if (id) recipientIds.push(String(id));
  } else if (rType === 'field') {
    const fieldVal = config.recipientField
      ? record.data instanceof Map
        ? record.data.get(config.recipientField)
        : record.data?.[config.recipientField]
      : null;
    if (fieldVal) recipientIds.push(String(fieldVal));
  } else if (rType === 'variable') {
    const varName = config.recipientVariable;
    if (varName) {
      const varVal = ctx[varName] ?? ctx.variables?.[varName];
      if (Array.isArray(varVal)) {
        // Array of user objects or plain IDs
        varVal.forEach((v) => {
          const id = v && typeof v === 'object' ? v._id || v.id : v;
          if (id) recipientIds.push(String(id));
        });
      } else if (varVal) {
        const id =
          varVal && typeof varVal === 'object'
            ? varVal._id || varVal.id
            : varVal;
        if (id) recipientIds.push(String(id));
      }
    }
  } else {
    // Legacy: recipientId set directly
    if (config.recipientId) recipientIds.push(String(config.recipientId));
    else {
      const id = record.ownerId || record.createdBy;
      if (id) recipientIds.push(String(id));
    }
  }

  if (!recipientIds.length) {
    say(ctx, `No recipient resolved (recipientType: ${rType})`, 'warning');
    return;
  }

  const title = interpolate(
    config.title || 'Automation notification',
    record,
    ctx,
  );
  const body = interpolate(config.body || '', record, ctx);
  const link =
    config.link ||
    (record._id ? `/o/${record.objectApiName}/${record._id}` : undefined);
  const icon = config.icon || 'Zap';

  if (dry(ctx)) {
    say(ctx, `[DRY RUN] Would notify ${recipientIds.length} user(s): "${title}"`);
    return;
  }

  await Promise.all(
    recipientIds.map((userId) =>
      Notification.create({
        tenantId,
        userId,
        type: 'custom',
        title,
        body,
        link,
        icon,
      }),
    ),
  );
}

/**
 * Flow "Send Email" action (Core BRD §5, §16.7). Resolves {field}/{variable}
 * tokens with the Flow's own interpolate() (record fields, ctx variables,
 * system fields — richer than a plain record-data merge), then dispatches
 * through inboxService.sendEmailToRecord — the same consent check, channel
 * adapter and Activity logging used by every manual email and reply. This
 * used to send directly via nodemailer + EmailSender with no consent check
 * and no Activity record; that path bypassed BRD §16.6 entirely and is gone.
 */
async function executeEmail(config, record, ctx, tenantId) {
  if (!config.to) {
    say(ctx, 'No recipient configured - nothing sent', 'warning');
    return;
  }
  try {
    const inboxService = (await import('./inboxService.js')).default;
    const to = interpolate(config.to, record, ctx);
    const subject = interpolate(config.subject || 'Automation notification', record, ctx);
    const body = interpolate(config.htmlBody || config.body || '', record, ctx);

    if (dry(ctx)) {
      say(ctx, `[DRY RUN] Would email ${to} - "${subject}"`);
      return;
    }

    await inboxService.sendEmailToRecord({
      tenantId,
      objectApiName: record.objectApiName,
      recordId: record._id,
      to,
      subject,
      body,
      templateId: config.templateId,
      channelAccountId: config.channelAccountId,
      user: null, // system-triggered, not an agent action
    });
    say(ctx, `Email sent to ${to} - "${subject}"`);
  } catch (err) {
    // Consistent with every other node executor here: log and let the caller
    // (fireAutomations' per-automation try/catch) record the Flow failure
    // without taking down the rest of the run.
    logger.warn(`Automation email failed: ${err.message}`);
    throw err;
  }
}

/**
 * Flow "Send Message Template" action (Core BRD §5, §16.3) — WhatsApp,
 * Messenger, Instagram or SMS. Dispatches through inboxService.sendTemplateToRecord,
 * which enforces the exact same WhatsApp provider-approval gate used by a
 * manual Inbox send: a Flow cannot send an unapproved WhatsApp template any
 * more than an agent can.
 */
async function executeSendMessageTemplate(config, record, ctx, tenantId) {
  // A blank template falls back to the tenant's default communication template (checked at send).
  if (!config.to) {
    say(ctx, 'Needs a recipient - nothing sent', 'warning');
    return;
  }
  const toAddr = interpolate(config.to, record, ctx);
  if (dry(ctx)) {
    say(ctx, `[DRY RUN] Would send ${config.channel || 'message'} template to ${toAddr}`);
    return;
  }
  try {
    const inboxService = (await import('./inboxService.js')).default;
    await inboxService.sendTemplateToRecord({
      tenantId,
      objectApiName: record.objectApiName,
      recordId: record._id,
      channel: config.channel,
      to: toAddr,
      templateId: config.templateId,
      channelAccountId: config.channelAccountId,
      user: null,
    });
    say(ctx, `Sent ${config.channel || 'message'} template to ${toAddr}`);
  } catch (err) {
    logger.warn(`Automation template send failed: ${err.message}`);
    throw err;
  }
}

async function executeHttpRequest(config, record, ctx, tenantId) {
  let url = interpolate(config.url || '', record, ctx);
  let headers = {};
  const method = (config.method || 'POST').toUpperCase();

  // If referencing an ExternalObject, pull its base URL + auth
  if (config.externalObjectId) {
    const ext = await ExternalObject.findOne({ _id: config.externalObjectId, tenantId }).select(
      '+credentials',
    );
    if (ext && ext.isActive) {
      // prepend base URL if config.url is a path
      if (url && !url.startsWith('http'))
        url = ext.baseUrl.replace(/\/$/, '') + '/' + url.replace(/^\//, '');
      else if (!url) url = ext.baseUrl;

      // auth headers
      if (ext.authType === 'bearer' && ext.credentials?.token) {
        headers['Authorization'] = `Bearer ${ext.credentials.token}`;
      } else if (ext.authType === 'basic' && ext.credentials?.username) {
        const enc = Buffer.from(
          `${ext.credentials.username}:${ext.credentials.password || ''}`,
        ).toString('base64');
        headers['Authorization'] = `Basic ${enc}`;
      } else if (ext.authType === 'api_key' && ext.credentials?.apiKey) {
        headers[ext.credentials.apiKeyHeader || 'X-Api-Key'] =
          ext.credentials.apiKey;
      }

      if (ext.defaultHeaders) {
        for (const [k, v] of ext.defaultHeaders) headers[k] = v;
      }
    }
  }

  // Merge custom headers from step config
  if (config.headers) Object.assign(headers, config.headers);

  if (!url) {
    logger.warn('HTTP request action: no URL configured');
    return;
  }

  let body;
  if (config.body) {
    try {
      const tpl = interpolate(
        typeof config.body === 'string'
          ? config.body
          : JSON.stringify(config.body),
        record,
        ctx,
      );
      body = JSON.parse(tpl);
    } catch {
      body = interpolate(config.body, record, ctx);
    }
  } else {
    // Default payload: full record data
    body = {
      event: ctx.event,
      objectType: record.objectApiName,
      recordId: String(record._id),
      data:
        record.data instanceof Map
          ? Object.fromEntries(record.data)
          : record.data,
    };
  }

  if (dry(ctx)) {
    say(ctx, `[DRY RUN] Would call ${method} ${url}`);
    return;
  }

  const response = await axios({
    method,
    url,
    headers: { 'Content-Type': 'application/json', ...headers },
    data: ['GET', 'HEAD', 'DELETE'].includes(method) ? undefined : body,
    params: ['GET', 'HEAD'].includes(method) ? body : undefined,
    timeout: config.timeout || 10000,
  });

  // Response mapping: the builder lets an admin pull values out of the reply
  // into flow variables ({ variable, path }, where path is dot-notation into
  // the response body, e.g. "data.id"). Without this the reply is discarded
  // and every later step sees nothing.
  const maps = config.responseMapping || [];
  if (maps.length) {
    ctx.variables = ctx.variables || {};
    for (const m of maps) {
      if (!m || !m.variable) continue;
      const path = String(m.path || '').trim();
      // An empty path means "the whole body".
      const value = path
        ? path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), response.data)
        : response.data;
      ctx.variables[m.variable] = value;
    }
    logger.info(
      `http_request: mapped ${maps.length} value(s) from the response → ${maps.map((m) => `{$${m.variable}}`).join(', ')}`,
    );
  }
  say(
    ctx,
    `HTTP ${response.status} ${method} ${url}` +
      (maps.length ? ` - mapped ${maps.length} value(s)` : ''),
  );
}

// BRD 6.2: a flow's record writes are held to the object's validation rules.
// A blocked write throws, so it is recorded as a Flow Error admins can see.
async function assertRulesPass(tenantId, objectApiName, data, prev, verb) {
  const failures = await checkRecordRules({ tenantId, objectApiName, data, prev });
  if (failures.length) {
    throw new Error(`${verb} blocked by validation rules: ${failures.join('; ')}`);
  }
}

async function executeUpdateRecord(config, record, ctx, tenantId) {
  if (!config.fields || Object.keys(config.fields).length === 0) {
    say(ctx, 'No fields configured - nothing to update', 'warning');
    return;
  }

  const updates = {};
  const values = {};
  Object.entries(config.fields).forEach(([field, value]) => {
    values[field] = interpolate(String(value ?? ''), record, ctx);
    updates[`data.${field}`] = values[field];
  });

  let targetId;
  const recordMode = config.recordMode || 'trigger';
  if (recordMode === 'variable' && config.recordVariable) {
    const varRecord = ctx.variables?.[config.recordVariable];
    targetId = varRecord?._id || varRecord?.id || varRecord;
  } else if (recordMode === 'id' && config.recordId) {
    targetId = interpolate(config.recordId, record, ctx);
  } else if (config.targetRecordId) {
    targetId = interpolate(config.targetRecordId, record, ctx);
  } else {
    targetId = record._id;
  }

  const pairs = Object.entries(values)
    .map(([k, v]) => `${k}="${v}"`)
    .join(', ');
  const label =
    !config.recordMode || recordMode === 'trigger'
      ? 'trigger record'
      : recordMode === 'variable'
        ? `{$${config.recordVariable}}`
        : String(targetId || '?');

  if (!targetId) {
    say(ctx, `No record to update (${label})`, 'warning');
    return;
  }

  const target = await DynamicRecord.findOne({ _id: targetId, tenantId, isDeleted: false }).catch(() => null);
  if (target) {
    const prev = target.toDataObject();
    // Rule checking is a read, so a dry run runs it too: an admin wants the
    // Test panel to surface a validation rule that would block the save.
    await assertRulesPass(tenantId, target.objectApiName, { ...prev, ...values }, prev, 'Update');
  }

  if (dry(ctx)) {
    say(ctx, `[DRY RUN] Would update ${label}: ${pairs}`);
    return;
  }

  await DynamicRecord.updateOne({ _id: targetId, tenantId }, { $set: updates });
  say(ctx, `Updated ${label}: ${pairs}`);
}

async function executeUpdateRelatedRecords(config, record, ctx, tenantId) {
  const { objectApiName, lookupField, fields = {}, lookupDirection = 'children' } = config || {};
  if (!objectApiName || !lookupField || Object.keys(fields).length === 0) return;

  const updates = {};
  const values = {};
  Object.entries(fields).forEach(([field, value]) => {
    values[field] = interpolate(String(value ?? ''), record, ctx);
    updates[`data.${field}`] = values[field];
  });

  if (lookupDirection === 'parent') {
    // lookupField is on the triggering record — resolve the parent ID from it
    const rawId = record.data instanceof Map
      ? record.data.get(lookupField)
      : (record.data || {})[lookupField];
    const targetId = rawId ? String(rawId) : null;
    if (!targetId) return;

    const target = await DynamicRecord.findOne({ _id: targetId, tenantId, isDeleted: false }).catch(() => null);
    if (!target) return;
    const prev = target.toDataObject();
    await assertRulesPass(tenantId, target.objectApiName, { ...prev, ...values }, prev, 'Update');
    if (dry(ctx)) {
      say(ctx, `[DRY RUN] Would update parent ${objectApiName} ${targetId}`);
      return;
    }
    await DynamicRecord.updateOne({ _id: targetId, tenantId }, { $set: updates });
    say(ctx, `Updated parent ${objectApiName} ${targetId}`);
    logger.info(
      { objectApiName, lookupField, targetId },
      'action_update_related_records (parent) complete',
    );
    return;
  }

  // Default: children — find records whose lookupField points to the triggering record
  const parentId = String(record._id);
  const related = await DynamicRecord.find({
    tenantId, objectApiName, isDeleted: false, [`data.${lookupField}`]: parentId,
  });
  const allowed = [];
  const blocked = [];
  for (const rel of related) {
    const prev = rel.toDataObject();
    const failures = await checkRecordRules({ tenantId, objectApiName, data: { ...prev, ...values }, prev });
    if (failures.length) blocked.push(`${rel._id}: ${failures.join('; ')}`);
    else allowed.push(rel._id);
  }

  if (dry(ctx)) {
    say(
      ctx,
      `[DRY RUN] Would update ${allowed.length} related ${objectApiName} record(s)` +
        (blocked.length ? ` - ${blocked.length} blocked by validation rules` : ''),
      blocked.length ? 'warning' : undefined,
    );
    return;
  }

  const result = allowed.length
    ? await DynamicRecord.updateMany({ _id: { $in: allowed }, tenantId }, { $set: updates })
    : { matchedCount: 0, modifiedCount: 0 };
  say(ctx, `Updated ${result.modifiedCount} related ${objectApiName} record(s)`);
  logger.info(
    { objectApiName, lookupField, parentId, matched: result.matchedCount, modified: result.modifiedCount },
    'action_update_related_records complete',
  );
  if (blocked.length) {
    throw new Error(`Update blocked by validation rules for ${blocked.length} related record(s): ${blocked.join(' | ')}`);
  }
}

async function executeCreateRecord(config, record, ctx, tenantId) {
  const { objectApiName, fields = {} } = config;
  if (!objectApiName) return;

  const [obj, fieldDefs] = await Promise.all([
    ObjectMeta.findOne({ tenantId, apiName: objectApiName }),
    FieldMeta.find({ tenantId, objectApiName }),
  ]);
  if (!obj) return;

  const rawData = {};
  Object.entries(fields).forEach(([k, v]) => {
    rawData[k] = interpolate(String(v ?? ''), record, ctx);
  });

  // FLD-007: validate required fields and type coercions before inserting.
  const { data: validatedData, errors } = await validateRecordData(
    rawData,
    fieldDefs,
    tenantId,
    null,
  );
  if (errors.length > 0) {
    say(ctx, `Validation failed - not created: ${errors.join('; ')}`, 'failed');
    logger.warn({ objectApiName, errors }, 'Automation createRecord validation failed — record not created');
    return;
  }
  await assertRulesPass(tenantId, objectApiName, validatedData, null, 'Create');

  // DUP-017: apply configured duplicate rules before inserting.
  const dupCheck = await duplicateDetectionService.check(tenantId, objectApiName, validatedData);
  if (dupCheck.action === 'block') {
    say(ctx, `Blocked by a duplicate rule - no ${objectApiName} created`, 'warning');
    logger.warn({ objectApiName }, 'Automation createRecord blocked by duplicate rule');
    return;
  }

  const summary = Object.entries(validatedData)
    .map(([k, v]) => `${k}="${v}"`)
    .join(', ');

  if (dry(ctx)) {
    say(ctx, `[DRY RUN] Would create ${objectApiName}: ${summary || '(defaults)'}`);
    return;
  }

  const newRecord = new DynamicRecord({
    tenantId,
    objectId: obj._id,
    objectApiName,
    createdBy: record.createdBy,
    ownerId: record.ownerId,
  });
  Object.entries(validatedData).forEach(([k, v]) => newRecord.setField(k, v));
  await newRecord.save();

  // The builder offers an output variable so later steps can reference what was
  // just created; without this the new record's id was unreachable.
  if (config.outputVariable) {
    ctx.variables = ctx.variables || {};
    ctx.variables[config.outputVariable] = {
      _id: String(newRecord._id),
      objectApiName,
      ...validatedData,
    };
  }
  say(
    ctx,
    `Created ${objectApiName} ${newRecord._id}` +
      (config.outputVariable ? ` -> {$${config.outputVariable}}` : ''),
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildContext(record, extraVars, tenantId) {
  const data =
    record.data instanceof Map
      ? Object.fromEntries(record.data)
      : record.data || {};

  return {
    event: 'trigger',
    tenantId,
    variables: { ...extraVars },
    record: {
      id: String(record._id),
      objectApiName: record.objectApiName,
      ownerId: record.ownerId ? String(record.ownerId) : null,
      createdBy: record.createdBy ? String(record.createdBy) : null,
      createdAt: record.createdAt?.toISOString(),
      ...data,
    },
  };
}

function interpolate(template, record, ctx = {}) {
  if (!template) return '';
  return String(template).replace(/\{([^}]+)\}/g, (match, raw) => {
    // Strip leading $ (variable syntax: {$varName} or {$varName.prop})
    const key = raw.startsWith('$') ? raw.slice(1) : raw;

    // Helper: resolve dot-notation path on a value
    const resolvePath = (obj, path) => {
      if (obj == null) return undefined;
      const parts = path.split('.');
      let cur = obj;
      for (const p of parts) {
        if (cur == null || typeof cur !== 'object') return undefined;
        cur = cur[p];
      }
      return cur;
    };

    // 1. Variables (support dot-notation: {$leadTag.tag})
    if (ctx.variables) {
      const [varName, ...rest] = key.split('.');
      if (varName in ctx.variables) {
        const val = rest.length ? resolvePath(ctx.variables[varName], rest.join('.')) : ctx.variables[varName];
        if (val != null) return typeof val === 'object' ? JSON.stringify(val) : String(val);
      }
    }
    // 2. Try record data map
    if (record.data instanceof Map) {
      const v = record.data.get(key);
      if (v != null) return String(v);
    }
    // 3. Try flat record data object
    if (record.data && typeof record.data === 'object' && record.data[key] != null) {
      return String(record.data[key]);
    }
    // 4. System fields
    if (key === 'id' || key === '_id') return String(record._id || '');
    if (key === 'objectApiName') return record.objectApiName || '';
    if (key === 'ownerId') return String(record.ownerId || '');
    // 5. context.record
    if (ctx.record && key in ctx.record) return String(ctx.record[key] ?? '');
    return match;
  });
}

/**
 * Run a flow for the Test & Debug panel and return a step-by-step trace.
 *
 * This deliberately goes through buildContext / entryConditionMet / executeFlow
 * — the same path fireAutomations takes — so the panel reports what production
 * actually does. A dry run still reads data and evaluates every condition,
 * formula and branch; only the steps that reach outside (writes, sends, HTTP,
 * custom code) describe themselves instead of running.
 *
 * @returns {{trace: Array, context: Object, success: boolean, skipped: boolean,
 *            error: string|null, duration: number}}
 */
const debugFlow = async (automation, record, tenantId, options = {}) => {
  const { dryRun = true, event = 'create', userId = null, prev = null } = options;
  const startedAt = Date.now();
  const trace = [];

  const ctx = buildContext(record, {}, tenantId);
  ctx._trace = trace;
  ctx._dryRun = dryRun === true;
  ctx._depth = 0;
  ctx._automationId = String(automation._id);
  ctx._automationName = automation.name;
  ctx._userId = userId;
  ctx.event = event;

  // Entry conditions decide whether production would run this flow at all, so
  // the trace opens with that verdict rather than assuming the flow fires.
  let entryMet = true;
  let entryError = null;
  try {
    entryMet = await entryConditionMet(automation, record, tenantId, event === 'update' ? prev : null);
  } catch (err) {
    entryMet = false;
    entryError = err.message;
  }

  // A flow can be gated two ways: a formula in trigger.entryCondition (what the
  // builder writes today) or the older conditions array. Name whichever applies,
  // so a skipped run never reports itself as "runs every time".
  const expression = String(automation.trigger?.entryCondition || '').trim();
  const legacyConds =
    automation.trigger?.runWhen === 'conditions_met' &&
    (automation.trigger?.conditions || []).length > 0;
  const gate = expression
    ? `Entry condition: ${expression}`
    : legacyConds
      ? 'Entry conditions'
      : null;

  trace.push({
    id: '__entry__',
    type: 'trigger',
    label: 'Entry conditions',
    depth: 0,
    status: entryError ? 'failed' : entryMet ? 'success' : 'skipped',
    output: entryError
      ? `Could not evaluate: ${entryError}`
      : gate
        ? entryMet
          ? `${gate} - met, flow runs`
          : `${gate} - not met, production would skip this record`
        : 'No entry condition - runs every time',
    error: entryError,
    duration: 0,
    contextSnapshot: {},
  });

  if (!entryMet) {
    return {
      trace,
      context: ctx.variables || {},
      success: false,
      skipped: true,
      error: entryError,
      duration: Date.now() - startedAt,
    };
  }

  let error = null;
  try {
    await executeFlow(automation, record, ctx, tenantId);
  } catch (err) {
    // The failing step has already marked itself in the trace; this keeps the
    // partial trace rather than throwing the whole run away.
    error = err.message;
  }

  return {
    trace,
    context: ctx.variables || {},
    success: !error && !trace.some((t) => t.status === 'failed'),
    skipped: false,
    error,
    duration: Date.now() - startedAt,
  };
};

export {
  fireAutomations,
  runAutomation,
  debugFlow,
  evaluateConditions,
  entryConditionMet,
  executeFlow,
  buildContext,
  // Shared with the screen/button-flow executor in routes/automations.js so
  // both runtimes shape data identically.
  castFormulaValue,
  applyTransform,
  compareForSort,
  MAX_LOOP_ITERATIONS,
};
