import { evaluateFormula, coerceToReturnType } from './formulaParser.js';
import FieldMeta from '../models/FieldMeta.js';
import DynamicRecord from '../models/DynamicRecord.js';
import logger from '../utils/logger.js';

/**
 * Inject calculated formula field values into a record.
 * @param {object} record - DynamicRecord instance (has data map and objectId)
 * @param {array} fields - Array of FieldMeta objects for the object
 * @returns {object} - Plain object with formula values calculated and injected
 */
export async function injectFormulaValues(record, fields) {
  const dataObj = record.toDataObject();

  if (!fields || fields.length === 0) return dataObj;

  // Find all formula fields
  const formulaFields = fields.filter((f) => f.type === 'formula' && f.formula);

  if (formulaFields.length === 0) return dataObj;

  // Build evaluation context from record data
  const context = {};
  for (const [key, value] of record.data || []) {
    context[key] = value;
  }

  // FORM-002: Expand lookup/master_detail fields one hop into the context so
  // formulas can reference parent-record fields as "lookupApiName.fieldName".
  const lookupFields = fields.filter(
    (f) => (f.type === 'lookup' || f.type === 'master_detail') && context[f.apiName],
  );
  if (lookupFields.length > 0) {
    await Promise.all(
      lookupFields.map(async (lf) => {
        try {
          const parent = await DynamicRecord.findById(context[lf.apiName]).lean();
          if (parent?.data) {
            for (const [k, v] of Object.entries(parent.data)) {
              context[`${lf.apiName}.${k}`] = v;
            }
          }
        } catch {
          // Non-fatal — parent may have been deleted; formula resolves to null
        }
      }),
    );
  }

  // Evaluate each formula field
  for (const field of formulaFields) {
    try {
      const result = evaluateFormula(field.formula, context);
      dataObj[field.apiName] = coerceToReturnType(result, field.formulaReturnType);
    } catch (err) {
      logger.error(`Error evaluating formula for field ${field.apiName}:`, err);
      dataObj[field.apiName] = null;
    }
  }

  return dataObj;
}

/**
 * Inject formula values into multiple records
 * @param {array} records - Array of DynamicRecord instances
 * @param {array} fields - Array of FieldMeta objects for the object
 * @returns {array} - Array of plain objects with formulas calculated
 */
export async function injectFormulaValuesMultiple(records, fields) {
  return Promise.all(records.map((record) => injectFormulaValues(record, fields)));
}

/**
 * Compute formula values for a plain data object, without touching a record.
 *
 * Object-level validation rules have to be able to reference formula fields, but
 * they run before the record exists (on create, where the formula value would be
 * missing entirely) and must not be handed the previously stored values (on
 * update, where they would be stale relative to the incoming edit). This
 * evaluates the formulas against the data as it is about to be saved and returns
 * just the computed values, for the caller to merge into the rule context.
 *
 * @param {object} data   - field values the record is being saved with
 * @param {array}  fields - FieldMeta documents for the object
 * @returns {object} { formulaFieldApiName: value }
 */
export function computeFormulaValues(data, fields) {
  const out = {};
  const formulaFields = (fields || []).filter((f) => f.type === 'formula' && f.formula);
  if (formulaFields.length === 0) return out;

  for (const field of formulaFields) {
    try {
      const result = evaluateFormula(field.formula, data);
      out[field.apiName] = coerceToReturnType(result, field.formulaReturnType);
    } catch {
      // A formula that can't evaluate against this data yet contributes null
      // rather than failing the save — the same tolerance the persisting path
      // below applies.
      out[field.apiName] = null;
    }
  }
  return out;
}

/**
 * Compute formula field values and save them to the record.
 * This is called during record creation/update to persist formula values to the database.
 * @param {object} record - DynamicRecord instance
 * @param {array} fields - Array of FieldMeta objects for the object
 */
export async function computeAndSetFormulaValues(record, fields) {
  if (!fields || fields.length === 0) return;

  // Find all formula fields
  const formulaFields = fields.filter((f) => f.type === 'formula' && f.formula);

  if (formulaFields.length === 0) return;

  // Build evaluation context from record data
  const context = {};
  for (const [key, value] of record.data || []) {
    context[key] = value;
  }

  // FORM-002: Expand lookup fields into context (one-hop cross-object references)
  const lookupFields = fields.filter(
    (f) => (f.type === 'lookup' || f.type === 'master_detail') && context[f.apiName],
  );
  if (lookupFields.length > 0) {
    await Promise.all(
      lookupFields.map(async (lf) => {
        try {
          const parent = await DynamicRecord.findById(context[lf.apiName]).lean();
          if (parent?.data) {
            for (const [k, v] of Object.entries(parent.data)) {
              context[`${lf.apiName}.${k}`] = v;
            }
          }
        } catch { /* non-fatal */ }
      }),
    );
  }

  // Evaluate and set each formula field
  for (const field of formulaFields) {
    try {
      const result = evaluateFormula(field.formula, context);
      record.setField(
        field.apiName,
        coerceToReturnType(result, field.formulaReturnType),
      );
    } catch (err) {
      logger.error(`Error evaluating formula for field ${field.apiName}:`, err);
      record.setField(field.apiName, null);
    }
  }
}

export default {
  injectFormulaValues,
  injectFormulaValuesMultiple,
  computeAndSetFormulaValues,
  computeFormulaValues,
};
