import mongoose from 'mongoose';
import ObjectMeta from '../models/ObjectMeta.js';
import FieldMeta from '../models/FieldMeta.js';
import Automation from '../models/Automation.js';
import DynamicRecord from '../models/DynamicRecord.js';
import { buildDataAccessFilter } from '../middleware/permissions.js';
import approvalProcessService from './approvalProcessService.js';
import { convertDealToOrder } from './dealConversionService.js';
import { ruleMatches } from './layoutResolver.js';
import { AppError } from '../utils/errors.js';
import logger from '../utils/logger.js';

/**
 * Actions & Buttons (BRD 4.4).
 *
 * A record-page button is configuration on ObjectMeta.actionButtons, wired to:
 *  - 'flow'        — an autolaunched Flow (Section 7), run straight through
 *  - 'screen_flow' — a screen-based guided Flow that asks for input first
 *  - 'native'      — one of the platform actions below
 * and optionally shown only when the record matches every condition
 * (e.g. Convert to Order when Stage = closed_won).
 */

// Platform-native actions. `objects` limits where one can be used (null = any).
// `server: true` actions run through POST /action-buttons/.../run, which
// re-checks the button's conditions against the saved record.
export const NATIVE_ACTIONS = {
  clone_record: { label: 'Clone record', objects: null },
  convert_lead_to_deal: { label: 'Convert lead to deal', objects: ['lead'] },
  submit_lead_for_approval: { label: 'Submit lead for approval', objects: ['lead'] },
  convert_deal_to_order: { label: 'Convert deal to order', objects: ['deal'], server: true },
  generate_quote: { label: 'Generate quote PDF', objects: ['deal'] },
  generate_invoice: { label: 'Generate invoice PDF', objects: ['order'] },
  view_pdf: { label: 'View PDF', objects: ['quote', 'invoice'] },
  new_policy: { label: 'New policy (insurance)', objects: ['client', 'lead'] },
};

export const ACTION_TYPES = ['flow', 'screen_flow', 'native'];
export const CONDITION_OPERATORS = ['eq', 'neq', 'is_set', 'is_blank'];
const FLOW_TYPES = { flow: ['autolaunched', 'record_triggered'], screen_flow: ['screen_flow'] };
const MAX_CONDITIONS = 10;

/** True when the record meets every condition (no conditions = always). */
export const conditionsMatch = (conditions = [], data = {}) =>
  (conditions || []).every((c) => ruleMatches(c, data));

const isBlank = (v) => v === undefined || v === null || String(v).trim() === '';

/**
 * Check and normalise a button from the admin UI. Returns only the
 * behaviour-related keys; display keys are handled by the controller.
 */
export const validateActionInput = async (tenantId, objectApiName, input, existing = {}) => {
  const merged = { ...existing, ...input };
  const actionType = merged.actionType || (merged.nativeAction ? 'native' : 'flow');
  if (!ACTION_TYPES.includes(actionType)) throw new AppError('Unknown action type.', 400);

  const out = { actionType, automationId: null, nativeAction: null };

  if (actionType === 'native') {
    const def = NATIVE_ACTIONS[merged.nativeAction];
    if (!def) throw new AppError('Choose a platform action.', 400);
    if (def.objects && !def.objects.includes(objectApiName)) {
      throw new AppError(`"${def.label}" can't be used on this object.`, 400);
    }
    out.nativeAction = merged.nativeAction;
    // Platform actions act on the open record, not on a list selection.
    out.location = 'record_detail';
  } else {
    if (isBlank(merged.automationId) || !mongoose.isValidObjectId(merged.automationId)) {
      throw new AppError(actionType === 'screen_flow' ? 'Choose a screen flow.' : 'Choose a flow.', 400);
    }
    const flow = await Automation.findOne({ _id: merged.automationId, tenantId }).select('type').lean();
    if (!flow) throw new AppError('The selected flow does not exist.', 400);
    if (!FLOW_TYPES[actionType].includes(flow.type)) {
      throw new AppError(
        actionType === 'screen_flow'
          ? 'The selected flow is not a screen flow.'
          : 'The selected flow is a screen flow — choose "Screen flow" as the action type.',
        400,
      );
    }
    out.automationId = merged.automationId;
  }

  const conditions = Array.isArray(merged.conditions) ? merged.conditions : [];
  if (conditions.length > MAX_CONDITIONS) throw new AppError(`At most ${MAX_CONDITIONS} conditions.`, 400);
  if (conditions.length) {
    const fields = await FieldMeta.find({ tenantId, objectApiName }).select('apiName').lean();
    const names = new Set(fields.map((f) => f.apiName));
    out.conditions = conditions.map((c, i) => {
      const at = `Condition ${i + 1}`;
      const operator = c?.operator || 'eq';
      if (!CONDITION_OPERATORS.includes(operator)) throw new AppError(`${at}: unknown operator.`, 400);
      if (!names.has(c?.field)) throw new AppError(`${at}: unknown field.`, 400);
      const value = isBlank(c.value) ? '' : String(c.value).trim();
      if ((operator === 'eq' || operator === 'neq') && !value) throw new AppError(`${at}: a value is required.`, 400);
      return { field: c.field, operator, value };
    });
  } else {
    out.conditions = [];
  }
  return out;
};

/**
 * Run a server-side platform action for one record. The button's conditions
 * are re-checked against the saved record, so hiding the button is not the
 * only thing standing between a user and the action.
 */
export const runNativeAction = async ({ req, objectApiName, actionId, recordId }) => {
  const obj = await ObjectMeta.findOne({ tenantId: req.tenantId, apiName: objectApiName }).lean();
  if (!obj) throw new AppError(`Object "${objectApiName}" not found.`, 404);
  const button = (obj.actionButtons || []).find((b) => String(b._id) === String(actionId));
  if (!button) throw new AppError('Action not found.', 404);
  if (button.actionType !== 'native' || !NATIVE_ACTIONS[button.nativeAction]?.server) {
    throw new AppError('This action does not run on the server.', 400);
  }
  if (!mongoose.isValidObjectId(recordId)) throw new AppError('Record not found.', 404);

  const dataFilter = await buildDataAccessFilter(req.user, objectApiName);
  const record = await DynamicRecord.findOne({
    _id: recordId,
    tenantId: req.tenantId,
    objectApiName,
    isDeleted: false,
    ...dataFilter,
  });
  if (!record) throw new AppError('Record not found.', 404);

  const data = record.data instanceof Map ? Object.fromEntries(record.data) : record.data || {};
  if (!conditionsMatch(button.conditions, data)) {
    throw new AppError(`"${button.label}" isn't available for this record.`, 409);
  }
  if (await approvalProcessService.isRecordLocked(req.tenantId, objectApiName, recordId)) {
    throw new AppError('This record is locked while an approval is pending.', 423);
  }

  switch (button.nativeAction) {
    case 'convert_deal_to_order': {
      // Which stage qualifies is the button's condition (checked above), not
      // hardcoded here; converting twice is always refused.
      if (record.getField('is_converted')) throw new AppError('This deal has already been converted.', 409);
      const session = await mongoose.startSession();
      let order;
      try {
        await session.withTransaction(async () => {
          order = await convertDealToOrder(record, req.tenantId, req.user._id, session);
        });
      } finally {
        await session.endSession();
      }
      if (!order) throw new AppError('The deal could not be converted.', 409);
      return {
        message: 'Deal converted to order.',
        navigate: { objectApiName: 'order', recordId: String(order._id) },
      };
    }
    default:
      throw new AppError('Unsupported action.', 400);
  }
};

/**
 * Buttons that used to be hardcoded on record pages, now seeded as
 * configuration. Each object remembers which defaults it has received
 * (ObjectMeta.seededActionKeys), so a default an admin deletes is not re-added.
 */
const DEFAULT_ACTIONS = [
  {
    key: 'lead.submit_for_approval', objectApiName: 'lead',
    label: 'Submit for Approval', icon: 'Send', variant: 'primary', nativeAction: 'submit_lead_for_approval',
  },
  {
    key: 'lead.convert_to_deal', objectApiName: 'lead',
    label: 'Convert to Deal', icon: 'FileText', variant: 'primary', nativeAction: 'convert_lead_to_deal',
    conditions: [{ field: 'is_converted', operator: 'neq', value: 'true' }],
  },
  {
    key: 'deal.generate_quote', objectApiName: 'deal',
    label: 'Generate Quote', icon: 'FileText', variant: 'primary', nativeAction: 'generate_quote',
  },
  {
    key: 'deal.convert_to_order', objectApiName: 'deal',
    label: 'Convert to Order', icon: 'ShoppingCart', variant: 'success', nativeAction: 'convert_deal_to_order',
    conditions: [
      { field: 'stage', operator: 'eq', value: 'closed_won' },
      { field: 'is_converted', operator: 'neq', value: 'true' },
    ],
    confirmMessage: 'Convert this deal to an order? Its line items will be copied to the new order.',
  },
  {
    key: 'order.generate_invoice', objectApiName: 'order',
    label: 'Generate Invoice', icon: 'Receipt', variant: 'primary', nativeAction: 'generate_invoice',
  },
  { key: 'quote.view_pdf', objectApiName: 'quote', label: 'View PDF', icon: 'FileText', variant: 'secondary', nativeAction: 'view_pdf' },
  { key: 'invoice.view_pdf', objectApiName: 'invoice', label: 'View PDF', icon: 'FileText', variant: 'secondary', nativeAction: 'view_pdf' },
  { key: 'client.new_policy', objectApiName: 'client', label: 'New policy', icon: 'ShieldPlus', variant: 'secondary', nativeAction: 'new_policy' },
  { key: 'lead.new_policy', objectApiName: 'lead', label: 'New policy', icon: 'ShieldPlus', variant: 'secondary', nativeAction: 'new_policy' },
];

/**
 * Add any default buttons an object hasn't received yet. Idempotent; pass a
 * tenantId to limit it to one tenant. Returns the number of buttons added.
 */
export const ensureDefaultActions = async (tenantId = null) => {
  const apiNames = [...new Set(DEFAULT_ACTIONS.map((d) => d.objectApiName))];
  const objects = await ObjectMeta.find({
    ...(tenantId ? { tenantId } : {}),
    apiName: { $in: apiNames },
  });
  let added = 0;
  for (const obj of objects) {
    const seeded = new Set(obj.seededActionKeys || []);
    const missing = DEFAULT_ACTIONS.filter((d) => d.objectApiName === obj.apiName && !seeded.has(d.key));
    if (!missing.length) continue;
    let order = (obj.actionButtons || []).length;
    for (const d of missing) {
      obj.actionButtons.push({
        id: d.key,
        systemKey: d.key,
        label: d.label,
        icon: d.icon,
        variant: d.variant,
        size: 'sm',
        location: 'record_detail',
        actionType: 'native',
        nativeAction: d.nativeAction,
        conditions: d.conditions || [],
        confirmMessage: d.confirmMessage,
        order: order++,
      });
      obj.seededActionKeys = [...(obj.seededActionKeys || []), d.key];
      added++;
    }
    await obj.save();
  }
  if (added) logger.info(`Added ${added} default action button(s)${tenantId ? ` for tenant ${tenantId}` : ''}.`);
  return added;
};
