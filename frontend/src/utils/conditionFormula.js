/**
 * Older approval processes stored their entry criteria as a list of
 * { field, operator, value, valueType } conditions. Entry criteria is now a
 * true/false formula (BRD §8) — the same language as validation rules — so the
 * editor converts the old list when a process is opened.
 */
const literal = (v) => {
  if (v === true || v === false) return String(v);
  if (v !== '' && v !== null && v !== undefined && !Number.isNaN(Number(v))) return String(Number(v));
  return JSON.stringify(String(v ?? ''));
};

export const approvalConditionsToFormula = (conditions = [], logic = 'AND') => {
  const parts = conditions
    .filter((c) => c?.field)
    .map((c) => {
      const rhs = c.valueType === 'tenantConfig' ? `CONFIG(${JSON.stringify(String(c.value ?? ''))})` : literal(c.value);
      switch (c.operator) {
        case 'not_equals': return `${c.field} != ${rhs}`;
        case 'greater_than': return `${c.field} > ${rhs}`;
        case 'greater_or_equal': return `${c.field} >= ${rhs}`;
        case 'less_than': return `${c.field} < ${rhs}`;
        case 'less_or_equal': return `${c.field} <= ${rhs}`;
        case 'contains': return `CONTAINS(${c.field}, ${c.valueType === 'tenantConfig' ? rhs : JSON.stringify(String(c.value ?? ''))})`;
        case 'is_empty': return `ISBLANK(${c.field})`;
        case 'is_not_empty': return `NOT(ISBLANK(${c.field}))`;
        case 'equals':
        default: return `${c.field} == ${rhs}`;
      }
    });
  return parts.join(logic === 'OR' ? ' OR ' : ' AND ');
};
