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
const evaluateConditions = (conditions, record, logic = 'all', prev = null) => {
  if (!conditions || conditions.length === 0) return true;

  const evalOne = (cond) => {
    const fieldValue =
      record.data instanceof Map
        ? record.data.get(cond.field)
        : record.data?.[cond.field];

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
const executeFlow = async (automation, record, ctx, tenantId) => {
  const startNode = automation.nodes.find((n) => n.type === 'trigger');
  if (!startNode) return;
  await executeNode(startNode, automation.nodes, record, ctx, tenantId);
};

// Execute an inline steps array (Decision/Loop branch steps stored in config)
const executeSteps = async (steps, allNodes, record, ctx, tenantId) => {
  for (const step of steps) {
    // Inline steps carry their own config — treat them as self-contained nodes
    await executeNode(step, allNodes, record, ctx, tenantId);
  }
};

const executeNode = async (node, allNodes, record, ctx, tenantId) => {
  try {
  switch (node.type) {
    case 'trigger':
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
              ? conditions.every((c) => evaluateConditions([c], record))
              : conditions.some((c) => evaluateConditions([c], record));
        if (passed) {
          matchedOutcome = outcome;
          break;
        }
      }
      // Fall through to default outcome if nothing matched
      if (!matchedOutcome) {
        matchedOutcome = outcomes.find((o) => o.isDefault) || null;
      }
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
      if (!templateId) break;
      try {
        const { renderPdfTemplate } = await import('./pdfRenderService.js');
        const { default: File } = await import('../models/File.js');
        const buffer = await renderPdfTemplate(tenantId, templateId, null);
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
        }
      } catch (err) {
        logger.error(`PDF generation node failed: ${err.message}`);
        throw err;
      }
      break;
    }

    case 'custom_code': {
      const { name: ccName, inputs: ccInputs = {}, outputVariable } = node.config || {};
      if (ccName) {
        try {
          const { executeCustomCode } = await import('./customCodeService.js');
          const res = await executeCustomCode(tenantId, ccName, ccInputs, { record, ctx });
          if (outputVariable) ctx.variables[outputVariable] = res.output;
        } catch (err) {
          logger.error(`Custom code node failed: ${err.message}`);
        }
      }
      break;
    }

    case 'action_update_related_records':
      await executeUpdateRelatedRecords(node.config, record, ctx, tenantId);
      break;

    case 'action_wait':
      // In production this would use a job queue. Here we simply log and continue.
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
      if (!objName || !variableName) break;

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
      logger.info(
        `get_records: fetched ${flattened.length} ${objName} records → ctx.variables.${variableName}`,
      );
      break;
    }

    case 'assignment': {
      // Assign variables from record fields
      (node.config?.assignments || []).forEach((a) => {
        ctx.variables[a.variable] = interpolate(a.value, record, ctx);
      });
      break;
    }

    case 'end':
      return;

    default:
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

  if (!recipientIds.length) return;

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
  if (!config.to) return;
  try {
    const inboxService = (await import('./inboxService.js')).default;
    const to = interpolate(config.to, record, ctx);
    const subject = interpolate(config.subject || 'Automation notification', record, ctx);
    const body = interpolate(config.htmlBody || config.body || '', record, ctx);

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
  if (!config.to || !config.templateId) return;
  try {
    const inboxService = (await import('./inboxService.js')).default;
    await inboxService.sendTemplateToRecord({
      tenantId,
      objectApiName: record.objectApiName,
      recordId: record._id,
      channel: config.channel,
      to: interpolate(config.to, record, ctx),
      templateId: config.templateId,
      channelAccountId: config.channelAccountId,
      user: null,
    });
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
    const ext = await ExternalObject.findById(config.externalObjectId).select(
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

  await axios({
    method,
    url,
    headers: { 'Content-Type': 'application/json', ...headers },
    data: ['GET', 'HEAD', 'DELETE'].includes(method) ? undefined : body,
    params: ['GET', 'HEAD'].includes(method) ? body : undefined,
    timeout: config.timeout || 10000,
  });
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
  if (!config.fields || Object.keys(config.fields).length === 0) return;

  const updates = {};
  const values = {};
  Object.entries(config.fields).forEach(([field, value]) => {
    values[field] = interpolate(String(value ?? ''), record, ctx);
    updates[`data.${field}`] = values[field];
  });

  const targetId = config.targetRecordId
    ? interpolate(config.targetRecordId, record, ctx)
    : record._id;

  const target = await DynamicRecord.findOne({ _id: targetId, tenantId, isDeleted: false }).catch(() => null);
  if (target) {
    const prev = target.toDataObject();
    await assertRulesPass(tenantId, target.objectApiName, { ...prev, ...values }, prev, 'Update');
  }

  await DynamicRecord.updateOne({ _id: targetId, tenantId }, { $set: updates });
}

async function executeUpdateRelatedRecords(config, record, ctx, tenantId) {
  const { objectApiName, lookupField, fields = {} } = config || {};
  if (!objectApiName || !lookupField || Object.keys(fields).length === 0) return;

  const parentId = String(record._id);
  const updates = {};
  const values = {};
  Object.entries(fields).forEach(([field, value]) => {
    values[field] = interpolate(String(value ?? ''), record, ctx);
    updates[`data.${field}`] = values[field];
  });

  // Each related record is held to the validation rules; any that fail are
  // left unchanged and reported as one Flow Error after the rest are updated.
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

  const result = allowed.length
    ? await DynamicRecord.updateMany({ _id: { $in: allowed }, tenantId }, { $set: updates })
    : { matchedCount: 0, modifiedCount: 0 };
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
    logger.warn({ objectApiName, errors }, 'Automation createRecord validation failed — record not created');
    return;
  }
  await assertRulesPass(tenantId, objectApiName, validatedData, null, 'Create');

  // DUP-017: apply configured duplicate rules before inserting.
  const dupCheck = await duplicateDetectionService.check(tenantId, objectApiName, validatedData);
  if (dupCheck.action === 'block') {
    logger.warn({ objectApiName }, 'Automation createRecord blocked by duplicate rule');
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

export { fireAutomations, runAutomation, evaluateConditions, entryConditionMet, executeFlow, buildContext };
