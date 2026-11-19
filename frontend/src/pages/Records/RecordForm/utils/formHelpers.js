/**
 * Initialize form data with defaults and record data
 */
const toDateStr = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };

const resolveDefault = (field) => {
  const raw = field.defaultValue;
  // A blank default is no default. Returning '' here meant a picklist whose
  // default lives on the value itself (including one synced from a Global
  // Value Set) was treated as already resolved, and never pre-selected.
  if (raw === undefined || raw === null || raw === '') return undefined;
  const token = String(raw).trim().toUpperCase();

  if (field.type === 'date') {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    if (token === 'TODAY()' || token === 'TODAY')       return toDateStr(today);
    if (token === 'TODAY(+1)' || token === 'TOMORROW()') return toDateStr(addDays(today, 1));
    if (token === 'TODAY(+7)')                           return toDateStr(addDays(today, 7));
    if (token === 'TODAY(+30)')                          return toDateStr(addDays(today, 30));
    if (token === 'TODAY(-7)')                           return toDateStr(addDays(today, -7));
    if (token === 'TODAY(-30)')                          return toDateStr(addDays(today, -30));
    if (token === 'START_OF_MONTH()') { const d = new Date(today); d.setDate(1); return toDateStr(d); }
    if (token === 'END_OF_MONTH()')   { const d = new Date(today); d.setMonth(d.getMonth() + 1, 0); return toDateStr(d); }
  }

  if (field.type === 'datetime' && (token === 'NOW()' || token === 'NOW')) {
    const d = new Date();
    return `${toDateStr(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  return raw;
};

export const initializeFormData = (fields, record, user, isEdit) => {
  const defaults = {};

  fields.forEach((f) => {
    const resolved = resolveDefault(f);
    if (resolved !== undefined && resolved !== null) {
      defaults[f.apiName] = resolved;
    } else if (f.type === 'picklist' || f.type === 'multipicklist') {
      const flagged = (f.picklistValues || []).filter(
        (p) => p.isDefault && p.isActive !== false,
      );
      if (flagged.length > 0) {
        defaults[f.apiName] =
          f.type === 'multipicklist' ? flagged.map((p) => p.value) : flagged[0].value;
      }
    } else if (
      f.type === 'lookup' &&
      f.lookupObjectApiName === 'user' &&
      user?._id &&
      !isEdit
    ) {
      defaults[f.apiName] = user._id;
    }
  });

  if (isEdit && record) {
    return { ...defaults, ...record };
  }

  return defaults;
};

// Values that must not be copied when cloning: calculated by the system,
// required to be unique, or the record owner (the person cloning owns the copy).
const NOT_CLONED_TYPES = new Set(['auto_number', 'formula', 'rollup_summary']);

/**
 * The values a clone of `source` starts with — every field except calculated,
 * unique and owner fields (BRD 4.4 "clone" platform action).
 */
export const cloneableValues = (fields, source) => {
  const values = {};
  if (!source) return values;
  fields.forEach((f) => {
    if (NOT_CLONED_TYPES.has(f.type)) return;
    if (f.isUnique || f.validations?.unique) return;
    if (f.apiName === 'owner_id') return;
    const v = source[f.apiName];
    if (v !== undefined && v !== null && v !== '') values[f.apiName] = v;
  });
  return values;
};

/**
 * Fold a layout's per-field settings into the field definitions (BRD 4.1.3).
 *
 * A layout can make a field Required or Read-only for the people who see that
 * layout, whatever the field's own default. It can only tighten: a field that
 * is required on its own definition stays required, because that rule is also
 * enforced by the API and no layout can switch it off.
 */
export const applyLayoutOverrides = (fields, layout) => {
  const items = new Map();
  (layout?.sections || []).forEach((sec) =>
    (sec.columnData || []).forEach((col) =>
      (col.fields || []).forEach((fi) => {
        if (fi.required || fi.readonly) items.set(fi.fieldApiName, fi);
      }),
    ),
  );
  if (items.size === 0) return fields;

  return fields.map((f) => {
    const o = items.get(f.apiName);
    if (!o) return f;
    return {
      ...f,
      ...(o.required ? { isRequired: true } : {}),
      ...(o.readonly ? { isReadOnly: true } : {}),
    };
  });
};

/**
 * Validate form data against field requirements
 */
export const validateFormData = (formData, fields, hiddenFields = new Set()) => {
  const errors = {};

  fields.forEach((f) => {
    // A field the layout is hiding is not on screen; it cannot be required.
    if (hiddenFields.has(f?.apiName)) return;
    if (f?.isRequired || f?.validations?.required) {
      const val = formData[f.apiName];
      if (val === undefined || val === null || val === '') {
        errors[f.apiName] = `${f.label} is required`;
      }
    }
  });

  return errors;
};

/**
 * Clear error for a specific field
 */
export const clearFieldError = (errors, fieldApiName) => {
  if (errors[fieldApiName]) {
    return { ...errors, [fieldApiName]: '' };
  }
  return errors;
};

/**
 * Convert datetime values from local time (as received from datetime-local input)
 * to UTC ISO format for backend storage
 */
export const convertDatetimeToUTC = (formData, fields) => {
  const converted = { ...formData };

  fields.forEach((f) => {
    if (f.type === 'datetime' && converted[f.apiName]) {
      const localValue = converted[f.apiName];
      // A field the user never touched still holds the full ISO string the
      // record was loaded with (e.g. "2026-11-10T14:30:00.000Z"), not the
      // short "YYYY-MM-DDTHH:mm" a datetime-local input produces on change —
      // only append seconds for the latter, or appending ":00" to an
      // already-complete ISO string makes it unparsable.
      const isShortLocalFormat = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(localValue);
      const localDate = new Date(isShortLocalFormat ? `${localValue}:00` : localValue);
      if (!Number.isNaN(localDate.getTime())) {
        converted[f.apiName] = localDate.toISOString();
      }
    }
  });

  return converted;
};

// Shared with the related-list inline modals — see utils/serverErrors.js
export { extractServerErrors } from '../../../../utils/serverErrors';
