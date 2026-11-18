import mongoose from 'mongoose';
import DuplicateRule from '../models/DuplicateRule.js';
import DynamicRecord from '../models/DynamicRecord.js';
import ObjectMeta from '../models/ObjectMeta.js';
import FieldMeta from '../models/FieldMeta.js';

/**
 * Duplicate detection & record matching (Core BRD §3.4).
 *
 * Matching is tenant-scoped and operates on the record `data` map, so it works
 * the same whether a record comes from manual capture, import, API or a flow.
 */

const MAX_MATCHES = 25;
const NON_BLOCKING_ACTIONS = new Set([
  'warn',
  'present_matches',
  'use_existing',
  'trigger_flow',
]);

const normalizeValue = (value, matchType) => {
  if (value === null || value === undefined) return null;
  let text = String(value).trim();
  if (!text) return null;
  if (matchType === 'normalized') text = text.toLowerCase().replace(/\s+/g, ' ');
  return text;
};

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A date/datetime value is stored as a BSON Date, so comparing it against the
 * caller's string ("1990-05-05") never matches. Build a query that compares
 * dates as dates: a `date` field matches anywhere in the same calendar day,
 * which is what "same date of birth" means (BRD §3.4.8); a `datetime` field
 * keeps instant precision.
 */
const dateCondition = (path, rawValue, fieldType) => {
  const parsed = rawValue instanceof Date ? rawValue : new Date(rawValue);
  if (Number.isNaN(parsed.getTime())) return null;

  if (fieldType === 'datetime') return { [path]: parsed };

  const start = new Date(Date.UTC(
    parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate(),
  ));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { [path]: { $gte: start, $lt: end } };
};

/**
 * Find records on `objectApiName` that match any active rule.
 *
 * @returns {Promise<{ matches: Array, action: 'allow'|'warn'|'block' }>}
 *   `matches` is [{ recordId, name, matchedFields }]; `action` is the strongest
 *   configured behaviour across the rules that actually matched.
 */
const check = async (tenantId, objectApiName, data, { excludeRecordId } = {}) => {
  const rules = await DuplicateRule.find({
    tenantId,
    objectApiName,
    active: true,
  }).lean();
  if (rules.length === 0) return { matches: [], action: 'allow' };

  const objMeta = await ObjectMeta.findOne({ tenantId, apiName: objectApiName })
    .select('nameFieldApiName')
    .lean();
  const nameField = objMeta?.nameFieldApiName || 'name';

  // Field types drive how a value is compared — a date cannot be matched as a
  // string. Only the fields the rules actually reference are needed.
  const referencedFields = [
    ...new Set(rules.flatMap((r) => (r.conditions || []).map((c) => c.field))),
  ];
  const fieldTypes = new Map(
    (
      await FieldMeta.find({
        tenantId,
        objectApiName,
        apiName: { $in: referencedFields },
      })
        .select('apiName type')
        .lean()
    ).map((f) => [f.apiName, f.type]),
  );

  const matchesById = new Map();
  // action priority: block > trigger_flow > use_existing > present_matches > warn > allow
  const ACTION_PRIORITY = { block: 5, trigger_flow: 4, use_existing: 3, present_matches: 2, warn: 1, allow: 0 };
  let action = 'allow';
  let matchedFlowId = null;

  for (const rule of rules) {
    const conditions = [];
    for (const cond of rule.conditions || []) {
      const raw = data?.[cond.field];
      const fieldType = fieldTypes.get(cond.field);
      const path = `data.${cond.field}`;

      if (fieldType === 'date' || fieldType === 'datetime') {
        conditions.push(
          raw === null || raw === undefined || raw === ''
            ? null
            : dateCondition(path, raw, fieldType),
        );
        continue;
      }

      const value = normalizeValue(raw, cond.matchType);
      if (value === null) {
        conditions.push(null);
        continue;
      }
      conditions.push(
        cond.matchType === 'normalized'
          ? { [path]: { $regex: `^${escapeRegex(value)}$`, $options: 'i' } }
          : { [path]: value },
      );
    }

    let clause;
    if (rule.logic === 'OR') {
      const usable = conditions.filter(Boolean);
      if (usable.length === 0) continue;
      clause = { $or: usable };
    } else {
      // AND: a condition with no incoming value can never match.
      if (conditions.some((c) => c === null)) continue;
      clause = { $and: conditions };
    }

    const query = { tenantId, objectApiName, isDeleted: false, ...clause };
    if (excludeRecordId && mongoose.isValidObjectId(excludeRecordId)) {
      query._id = { $ne: excludeRecordId };
    }

    const found = await DynamicRecord.find(query).limit(MAX_MATCHES);
    if (found.length === 0) continue;

    const ruleAction = rule.onMatch || 'warn';
    if ((ACTION_PRIORITY[ruleAction] ?? 0) > (ACTION_PRIORITY[action] ?? 0)) {
      action = ruleAction;
      if (ruleAction === 'trigger_flow') matchedFlowId = rule.flowId ?? null;
    }

    const fields = (rule.conditions || []).map((c) => c.field);
    for (const rec of found) {
      const key = String(rec._id);
      if (!matchesById.has(key)) {
        matchesById.set(key, {
          record: rec,
          recordId: key,
          name: rec.getField(nameField) ?? '',
          matchedFields: [],
        });
      }
      const entry = matchesById.get(key);
      for (const field of fields) {
        if (!entry.matchedFields.includes(field)) entry.matchedFields.push(field);
      }
    }
  }

  const matches = [...matchesById.values()];
  return { matches, action, flowId: matchedFlowId };
};

export default { check, NON_BLOCKING_ACTIONS };
