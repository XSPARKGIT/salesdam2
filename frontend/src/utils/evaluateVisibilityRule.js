/**
 * Evaluates a layout visibility rule against a record's current field values.
 * Returns true (show) when no rule is set, or when the rule's condition passes.
 *
 * Operators:
 *   eq       — field value equals rule.value (case-insensitive)
 *   neq      — field value does not equal rule.value
 *   is_set   — field has a non-empty value
 *   is_blank — field is empty / null / undefined
 */
export const evaluateVisibilityRule = (rule, data) => {
  if (!rule?.field) return true;
  const raw = data?.[rule.field];
  const val = raw === null || raw === undefined ? '' : String(raw).toLowerCase();
  switch (rule.operator) {
    case 'eq':       return val === String(rule.value ?? '').toLowerCase();
    case 'neq':      return val !== String(rule.value ?? '').toLowerCase();
    case 'is_set':   return val !== '';
    case 'is_blank': return val === '';
    default:         return true;
  }
};
