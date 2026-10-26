/**
 * Initialize form data with defaults and record data
 */
const toDateStr = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };

const resolveDefault = (field) => {
  const raw = field.defaultValue;
  if (raw === undefined || raw === null) return undefined;
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
    } else if (f.type === 'picklist') {
      const pv = f.picklistValues?.find((p) => p.isDefault);
      if (pv) defaults[f.apiName] = pv.value;
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

/**
 * Validate form data against field requirements
 */
export const validateFormData = (formData, fields) => {
  const errors = {};

  fields.forEach((f) => {
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
      // datetime-local input returns "YYYY-MM-DDTHH:mm" in local time
      // new Date() interprets this as local time and stores it as UTC internally
      // toISOString() returns the correct UTC representation
      const localDate = new Date(`${localValue}:00`);
      converted[f.apiName] = localDate.toISOString();
    }
  });

  return converted;
};

// Shared with the related-list inline modals — see utils/serverErrors.js
export { extractServerErrors } from '../../../../utils/serverErrors';
