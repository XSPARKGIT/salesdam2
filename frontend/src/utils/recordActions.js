/**
 * Actions & Buttons (BRD 4.4) — shared by the record page and the button
 * editor. Keep NATIVE_ACTIONS and the condition logic in step with
 * backend/services/actionService.js and backend/services/layoutResolver.js.
 */

// Platform actions a button can run. `objects` limits where one applies
// (null = any object).
export const NATIVE_ACTIONS = {
  clone_record: { label: 'Clone record', objects: null },
  convert_lead_to_deal: { label: 'Convert lead to deal', objects: ['lead'] },
  submit_lead_for_approval: { label: 'Submit lead for approval', objects: ['lead'] },
  convert_deal_to_order: { label: 'Convert deal to order', objects: ['deal'] },
  generate_quote: { label: 'Generate quote PDF', objects: ['deal'] },
  generate_invoice: { label: 'Generate invoice PDF', objects: ['order'] },
  view_pdf: { label: 'View PDF', objects: ['quote', 'invoice'] },
  new_policy: { label: 'New policy (insurance)', objects: ['client', 'lead'] },
};

export const nativeActionsFor = (objectApiName) =>
  Object.entries(NATIVE_ACTIONS)
    .filter(([, def]) => !def.objects || def.objects.includes(objectApiName))
    .map(([value, def]) => ({ value, label: def.label }));

export const ACTION_TYPE_LABELS = {
  flow: 'Flow',
  screen_flow: 'Screen flow',
  native: 'Platform action',
};

export const CONDITION_OPERATORS = [
  { value: 'eq', label: 'equals' },
  { value: 'neq', label: 'does not equal' },
  { value: 'is_set', label: 'is set' },
  { value: 'is_blank', label: 'is blank' },
];

const isBlank = (v) =>
  v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

const valueEquals = (value, expected) => {
  if (isBlank(value)) return isBlank(expected);
  const wanted = String(expected ?? '').trim().toLowerCase();
  const values = Array.isArray(value) ? value : [value];
  return values.some((v) => String(v?._id ?? v).trim().toLowerCase() === wanted);
};

const conditionMatches = (c, record = {}) => {
  const value = record?.[c.field];
  switch (c.operator) {
    case 'is_set':
      return !isBlank(value);
    case 'is_blank':
      return isBlank(value);
    case 'neq':
      return !valueEquals(value, c.value);
    case 'eq':
    default:
      return valueEquals(value, c.value);
  }
};

/** True when the record meets every condition (no conditions = always). */
export const conditionsMatch = (conditions = [], record = {}) =>
  (conditions || []).every((c) => conditionMatches(c, record));

/** The action type of a stored button (older buttons only had a flow). */
export const actionTypeOf = (button) =>
  button?.actionType || (button?.nativeAction ? 'native' : 'flow');

/** "Stage equals closed_won and Converted does not equal true" */
export const describeConditions = (conditions = [], fields = []) => {
  if (!conditions?.length) return '';
  const label = (apiName) => fields.find((f) => f.apiName === apiName)?.label || apiName;
  return conditions
    .map((c) => {
      const op = CONDITION_OPERATORS.find((o) => o.value === c.operator)?.label || c.operator;
      return c.operator === 'is_set' || c.operator === 'is_blank'
        ? `${label(c.field)} ${op}`
        : `${label(c.field)} ${op} ${c.value}`;
    })
    .join(' and ');
};
