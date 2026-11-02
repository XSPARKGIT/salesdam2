import Layout from '../models/Layout.js';
import LayoutAssignment from '../models/LayoutAssignment.js';

/**
 * Picks the page layout a user sees for an object (BRD 4.2 Layout Assignment).
 *
 * Order:
 *  1. The user's Role assignment for the object: the first conditional rule
 *     whose condition matches the saved record, else the Role's default.
 *  2. A layout that lists the Role in assignedRoles (older configuration).
 *  3. The object's default layout, then its first layout by name.
 *
 * With no record (a new record) conditional rules are skipped, so the Role's
 * default shows until the record is saved with a matching value.
 */

const isBlank = (v) =>
  v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

/** Does a rule's condition hold for the record's values? */
export const ruleMatches = (rule, data = {}) => {
  const value = data[rule.field];
  switch (rule.operator) {
    case 'is_set':
      return !isBlank(value);
    case 'is_blank':
      return isBlank(value);
    case 'neq':
      return !valueEquals(value, rule.value);
    case 'eq':
    default:
      return valueEquals(value, rule.value);
  }
};

// Multi-select values match when any selected value equals the rule's value.
const valueEquals = (value, expected) => {
  if (isBlank(value)) return isBlank(expected);
  const wanted = String(expected ?? '').trim().toLowerCase();
  const values = Array.isArray(value) ? value : [value];
  return values.some((v) => {
    const id = v?._id ?? v;
    return String(id).trim().toLowerCase() === wanted;
  });
};

const roleIdOf = (user) => {
  const role = user?.role;
  return role ? role._id || role : null;
};

const dataOf = (record) => {
  const data = record?.data;
  if (!data) return {};
  return data instanceof Map ? Object.fromEntries(data) : data;
};

/**
 * @returns {Promise<{ layout: object|null, source: string, ruleIndex?: number }>}
 *   source: 'rule' | 'profile' | 'role' | 'default' | 'none'
 */
export const resolveLayout = async ({ tenantId, objectApiName, user, record = null, type = 'detail' }) => {
  const roleId = roleIdOf(user);
  const scope = { tenantId, objectApiName };
  const findLayout = (id) => (id ? Layout.findOne({ ...scope, _id: id }) : null);

  if (roleId) {
    const assignment = await LayoutAssignment.findOne({ ...scope, roleId }).lean();

    if (assignment && record) {
      const data = dataOf(record);
      for (let i = 0; i < (assignment.rules || []).length; i++) {
        const rule = assignment.rules[i];
        if (!ruleMatches(rule, data)) continue;
        const layout = await findLayout(rule.layoutId);
        if (layout) return { layout, source: 'rule', ruleIndex: i };
      }
    }

    if (assignment?.defaultLayoutId) {
      const layout = await findLayout(assignment.defaultLayoutId);
      if (layout) return { layout, source: 'profile' };
    }

    const roleLayout = await Layout.findOne({ ...scope, assignedRoles: roleId, type });
    if (roleLayout) return { layout: roleLayout, source: 'role' };
  }

  const fallback =
    (await Layout.findOne({ ...scope, isDefault: true, type })) ||
    (await Layout.findOne({ ...scope, isDefault: true })) ||
    (await Layout.findOne(scope).sort({ name: 1 }));

  return fallback ? { layout: fallback, source: 'default' } : { layout: null, source: 'none' };
};
