import DynamicRecord from '../models/DynamicRecord.js';
import { validateRecord } from './validationEngine.js';
import { evaluateFormula } from './formulaParser.js';
// TYPE-003: sanitize-html strips XSS payloads from rich-text values.
import sanitizeHtml from 'sanitize-html';

// Allowed HTML tags and attributes for rich-text fields (TYPE-003 XSS prevention).
const RICHTEXT_SANITIZE_OPTIONS = {
  allowedTags: [
    'b', 'i', 'em', 'strong', 'u', 's', 'strike', 'del',
    'p', 'br', 'div', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
    'a', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
  ],
  allowedAttributes: {
    'a': ['href', 'title', 'target'],
    'img': ['src', 'alt', 'width', 'height'],
    '*': ['style'],
  },
  allowedStyles: {
    '*': {
      'color': [/.*/],
      'background-color': [/.*/],
      'font-weight': [/.*/],
      'font-style': [/.*/],
      'text-decoration': [/.*/],
      'text-align': [/.*/],
    },
  },
};

// Values of these types are compared case-insensitively when checking
// uniqueness. "Acme" and "acme" are the same value to a human, so treating them
// as distinct makes a unique field trivially bypassable.
const CASE_INSENSITIVE_UNIQUE_TYPES = new Set(['text', 'textarea', 'email', 'url']);

const escapeRegex = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Is uniqueness switched on for this field?
 *
 * The flag has two homes: the top-level `isUnique` column (what the seeds and
 * the legacy field editor write) and `validations.unique` (what the
 * ValidationBuilder UI writes). Only reading `isUnique` meant a user toggling
 * "Unique" in the UI got no enforcement at all.
 */
const isUniqueField = (field) =>
  Boolean(field?.isUnique || field?.validations?.unique);

/**
 * Find another live record in the same tenant/object that already holds
 * `value` in `field`. Returns null when the value is free to use.
 */
const findDuplicateRecord = async ({ tenantId, field, value, excludeRecordId = null }) => {
  const query = {
    tenantId,
    objectApiName: field.objectApiName,
    isDeleted: false,
  };

  if (CASE_INSENSITIVE_UNIQUE_TYPES.has(field.type) && typeof value === 'string') {
    query[`data.${field.apiName}`] = new RegExp(`^${escapeRegex(value)}$`, 'i');
  } else {
    query[`data.${field.apiName}`] = value;
  }

  if (excludeRecordId) query._id = { $ne: excludeRecordId };

  return DynamicRecord.findOne(query).select('_id').lean();
};

// FLD-009: per-(tenantId, objectApiName, field, normalisedValue) advisory lock.
// Reduces the TOCTOU race window for unique fields under concurrent writes in a
// single Node.js process. Does not protect against multi-process or multi-node
// deployments — those require a distributed lock (Redis) or a MongoDB unique index.
const _uniqueLocks = new Map();

const acquireUniqueLock = (key) => {
  if (_uniqueLocks.has(key)) return false;
  _uniqueLocks.set(key, true);
  return true;
};

const releaseUniqueLock = (key) => _uniqueLocks.delete(key);

/**
 * Acquire an advisory unique-field lock and return a release function.
 * Returns null when another write is already holding the lock for the same key.
 */
const lockUniqueField = (tenantId, field, normalisedValue) => {
  const key = `${tenantId}|${field.objectApiName}|${field.apiName}|${String(normalisedValue).toLowerCase()}`;
  if (!acquireUniqueLock(key)) return null;
  return () => releaseUniqueLock(key);
};

/**
 * Validate and sanitize record data against field metadata.
 *
 * Returns { data, errors, fieldErrors } where `errors` is the flat list of
 * messages and `fieldErrors` maps fieldApiName → message so the client can
 * highlight the offending input instead of only showing a toast.
 */
/**
 * @param {object} options
 * @param {boolean} options.partial - If true (PATCH), skip required validation
 *   for fields not present in inputData. Only validate what was sent.
 */
const validateRecordData = async (inputData, fields, tenantId, recordId = null, options = {}) => {
  const { partial = false } = options;
  const errors = [];
  const fieldErrors = {};
  const cleanedData = {};

  // Record a field-level failure in both shapes. The first message per field
  // wins — it is the most specific one, and later checks are skipped anyway.
  const fail = (field, message) => {
    errors.push(message);
    if (field?.apiName && !fieldErrors[field.apiName]) {
      fieldErrors[field.apiName] = message;
    }
  };

  for (const field of fields) {
    // Skip system-level ID fields
    if (['_id', 'tenantId', 'objectId', 'objectApiName', 'isDeleted', 'createdBy', 'lastModifiedBy'].includes(field.apiName)) {
      continue;
    }
    // auto_number fields are always system-generated — never from user input
    if (field.type === 'auto_number') continue;

    const value = inputData[field.apiName];
    const isEmpty = value === undefined || value === null || value === '';

    // For partial (PATCH) updates: if the field wasn't sent, skip it entirely —
    // the existing value on the record remains. Do NOT flag it as missing.
    if (partial && value === undefined) {
      continue;
    }

    // Required check — only for full PUT or when the field was explicitly sent
    if (field.isRequired && isEmpty) {
      fail(field, `"${field.label}" is required.`);
      continue;
    }

    if (isEmpty) {
      // Apply default value if defined, evaluating date expression tokens at
      // record-create time so the stored value is the actual current date rather
      // than the literal string "TODAY()".
      if (field.defaultValue !== undefined && field.defaultValue !== null) {
        const dv = String(field.defaultValue).trim().toUpperCase();
        const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
        const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
        if (dv === 'TODAY()' || dv === 'TODAY') {
          cleanedData[field.apiName] = today();
        } else if (dv === 'TODAY(+1)' || dv === 'TOMORROW()') {
          cleanedData[field.apiName] = addDays(today(), 1);
        } else if (dv === 'TODAY(+7)') {
          cleanedData[field.apiName] = addDays(today(), 7);
        } else if (dv === 'TODAY(+30)') {
          cleanedData[field.apiName] = addDays(today(), 30);
        } else if (dv === 'TODAY(-7)') {
          cleanedData[field.apiName] = addDays(today(), -7);
        } else if (dv === 'TODAY(-30)') {
          cleanedData[field.apiName] = addDays(today(), -30);
        } else if (dv === 'START_OF_MONTH()') {
          const d = today(); d.setDate(1); cleanedData[field.apiName] = d;
        } else if (dv === 'END_OF_MONTH()') {
          const d = today(); d.setMonth(d.getMonth() + 1, 0); cleanedData[field.apiName] = d;
        } else if (dv === 'NOW()' || dv === 'NOW') {
          cleanedData[field.apiName] = new Date();
        } else {
          cleanedData[field.apiName] = field.defaultValue;
        }
      }
      continue;
    }

    // Type-specific validation
    let cleanedValue = value;

    switch (field.type) {
      case 'text':
      case 'textarea':
        cleanedValue = String(value).trim();
        if (field.maxLength && cleanedValue.length > field.maxLength) {
          fail(field, `"${field.label}" exceeds max length of ${field.maxLength}.`);
          continue;
        }
        if (field.minLength && cleanedValue.length < field.minLength) {
          fail(field, `"${field.label}" must be at least ${field.minLength} characters.`);
          continue;
        }
        break;

      case 'richtext':
        // TYPE-003: sanitise HTML to strip XSS payloads before storage.
        cleanedValue = sanitizeHtml(String(value).trim(), RICHTEXT_SANITIZE_OPTIONS);
        if (field.maxLength && cleanedValue.length > field.maxLength) {
          fail(field, `"${field.label}" exceeds max length of ${field.maxLength}.`);
          continue;
        }
        break;

      case 'number':
      case 'currency':
      case 'percent':
        cleanedValue = parseFloat(value);
        if (isNaN(cleanedValue)) {
          fail(field, `"${field.label}" must be a number.`);
          continue;
        }
        if (field.minValue !== undefined && cleanedValue < field.minValue) {
          fail(field, `"${field.label}" must be at least ${field.minValue}.`);
          continue;
        }
        if (field.maxValue !== undefined && cleanedValue > field.maxValue) {
          fail(field, `"${field.label}" must not exceed ${field.maxValue}.`);
          continue;
        }
        break;

      case 'date':
        cleanedValue = new Date(value);
        if (isNaN(cleanedValue.getTime())) {
          fail(field, `"${field.label}" must be a valid date.`);
          continue;
        }
        break;

      case 'datetime':
        cleanedValue = new Date(value);
        if (isNaN(cleanedValue.getTime())) {
          fail(field, `"${field.label}" must be a valid datetime.`);
          continue;
        }
        break;

      case 'boolean':
        cleanedValue = Boolean(value);
        break;

      case 'email':
        cleanedValue = String(value).trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanedValue)) {
          fail(field, `"${field.label}" must be a valid email address.`);
          continue;
        }
        break;

      case 'phone':
        cleanedValue = String(value).trim();
        // TYPE-017: validate phone format when a pattern is configured or default E.164.
        if (cleanedValue) {
          const pattern = field.validations?.phoneFormat
            ? new RegExp(field.validations.phoneFormat)
            : /^\+?[0-9\s\-().]{5,20}$/;
          if (!pattern.test(cleanedValue)) {
            fail(field, `"${field.label}" must be a valid phone number.`);
            continue;
          }
        }
        break;

      case 'url':
        cleanedValue = String(value).trim();
        if (cleanedValue && !/^https?:\/\/.+/.test(cleanedValue)) {
          fail(field, `"${field.label}" must be a valid URL starting with http:// or https://.`);
          continue;
        }
        break;

      case 'picklist':
        if (field.picklistValues && field.picklistValues.length > 0) {
          const validValues = field.picklistValues.filter(pv => pv.isActive).map(pv => pv.value);
          if (!validValues.includes(String(value))) {
            fail(field, `"${field.label}" has invalid value "${value}".`);
            continue;
          }
        }
        cleanedValue = String(value);
        break;

      case 'multipicklist':
        if (!Array.isArray(value)) {
          fail(field, `"${field.label}" must be an array of values.`);
          continue;
        }
        if (field.picklistValues && field.picklistValues.length > 0) {
          const validValues = field.picklistValues.filter(pv => pv.isActive).map(pv => pv.value);
          const invalid = value.filter(v => !validValues.includes(String(v)));
          if (invalid.length > 0) {
            fail(field, `"${field.label}" has invalid values: ${invalid.join(', ')}.`);
            continue;
          }
        }
        cleanedValue = value.map(String);
        break;

      case 'lookup':
      case 'master_detail':
        // Just store the ID - referential integrity check is lightweight
        cleanedValue = value;
        break;

      case 'time':
        // TYPE-021: validate HH:MM or HH:MM:SS format.
        cleanedValue = String(value).trim();
        if (cleanedValue && !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(cleanedValue)) {
          fail(field, `"${field.label}" must be a valid time in HH:MM or HH:MM:SS format.`);
          continue;
        }
        break;

      case 'address':
        // TYPE-020: accept either a structured object or a plain string.
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          cleanedValue = {
            street:  String(value.street  || '').trim(),
            city:    String(value.city    || '').trim(),
            state:   String(value.state   || '').trim(),
            postalCode: String(value.postalCode || value.postal_code || '').trim(),
            country: String(value.country || '').trim(),
          };
        } else {
          cleanedValue = String(value).trim();
        }
        break;

      default:
        cleanedValue = value;
    }

    // Custom validation rule (regex)
    if (field.validationRule?.pattern && cleanedValue !== undefined && cleanedValue !== null) {
      try {
        const regex = new RegExp(field.validationRule.pattern);
        if (!regex.test(String(cleanedValue))) {
          fail(field, field.validationRule.message || `"${field.label}" validation failed.`);
          continue;
        }
      } catch (e) { /* ignore bad regex */ }
    }

    // Uniqueness check — with advisory lock to reduce TOCTOU race window (FLD-009).
    if (isUniqueField(field)) {
      const releaseLock = lockUniqueField(tenantId, field, cleanedValue);
      if (releaseLock === null) {
        // Another concurrent request is already writing this value; treat as conflict.
        fail(field, `"${field.label}" must be unique. A concurrent write is already using this value.`);
        continue;
      }
      try {
        const duplicate = await findDuplicateRecord({
          tenantId,
          field,
          value: cleanedValue,
          excludeRecordId: recordId,
        });
        if (duplicate) {
          fail(field, `"${field.label}" must be unique. This value already exists.`);
          continue;
        }
      } finally {
        releaseLock();
      }
    }

    cleanedData[field.apiName] = cleanedValue;
  }

  // ── Engine pass: validations{} + formulaValidation on cleaned data ──────────
  // Only run for fields that have the new-style config populated.
  //
  // The engine re-checks `required` from field.isRequired but has no notion of
  // "absent means unchanged", so on a partial (PATCH) update it must only see
  // fields that were actually sent. Otherwise it re-flags every required field
  // the caller didn't include, defeating the `partial` handling above.
  const engineFields = fields.filter(
    (f) =>
      ((f.validations && Object.keys(f.validations).length > 0) ||
        f.formulaValidation?.expression) &&
      (!partial || inputData[f.apiName] !== undefined),
  );
  if (engineFields.length > 0) {
    const { errors: engineErrors } = validateRecord(cleanedData, engineFields);
    for (const e of engineErrors) {
      // Avoid duplicating errors already caught by the legacy path
      if (!errors.find(ex => ex.includes(e.field) || e.message.includes(ex))) {
        errors.push(e.message);
        if (e.field && !fieldErrors[e.field]) fieldErrors[e.field] = e.message;
      }
    }
  }

  return { data: cleanedData, errors, fieldErrors };
};

/**
 * Evaluate object-level validation rules using the formula parser engine.
 * Supports LENGTH, ISBLANK, CONTAINS, REGEX, TODAY, NOW, UPPER, LOWER,
 * TRIM, ABS, ROUND, YEAR, MONTH, DAY, and all comparison / logical operators.
 *
 * The expression describes the ERROR condition: a rule TRIGGERS — blocking the
 * save — when its expression evaluates to a truthy value. This matches
 * Salesforce, where `ISBLANK(client_number)` means "reject a blank client
 * number" rather than "require it to be blank".
 *
 * Keep this in step with evaluateFormulaRules in validationEngine.js, which the
 * /records/validate preview endpoint uses — the preview and the real save must
 * agree on direction.
 *
 * @param {object[]} validationRules  - from ObjectMeta.validationRules
 * @param {object}   recordData       - cleaned record field values
 * @returns {string[]}                - error messages for triggered rules
 */
const runObjectValidationRules = (validationRules = [], recordData = {}) => {
  const errors = [];
  for (const rule of validationRules) {
    // `isActive` defaults to true in the schema, so only an explicit false
    // disables a rule. A rule missing the flag entirely is still active.
    if (rule.isActive === false || !rule.expression) continue;
    try {
      const triggered = evaluateFormula(rule.expression, recordData);
      if (triggered) {
        errors.push({
          message: rule.errorMessage || `Validation rule "${rule.name}" failed.`,
          errorField: rule.errorField || '',
        });
      }
    } catch (err) {
      errors.push({
        message: `Validation rule "${rule.name}" has an invalid expression: ${err.message}`,
        errorField: '',
      });
    }
  }
  return errors;
};

export {
  validateRecordData,
  runObjectValidationRules,
  isUniqueField,
  findDuplicateRecord,
  lockUniqueField,
};
