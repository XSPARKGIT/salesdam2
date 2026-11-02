import ObjectMeta from '../models/ObjectMeta.js';
import FieldMeta from '../models/FieldMeta.js';
import { validateFormula, configKeysIn } from './formulaParser.js';
import { buildSampleContext, buildFieldKindMap } from './validationEngine.js';
import configurationService from './configurationService.js';
import { parseCron } from './scheduledFlowService.js';
import { AppError } from '../utils/errors.js';

/**
 * Check a flow's definition before it is saved (BRD 7.1): its object, trigger
 * events, Entry Condition and schedule. Throws a 400 listing every problem.
 * `type` and `trigger` are the values the flow will have after the save.
 */
export const validateFlowDefinition = async (tenantId, { type, trigger = {} }) => {
  const problems = [];
  const objectApiName = trigger.objectApiName || '';

  let fields = [];
  if (objectApiName) {
    const obj = await ObjectMeta.exists({ tenantId, apiName: objectApiName });
    if (!obj) problems.push(`Object "${objectApiName}" does not exist.`);
    else fields = await FieldMeta.find({ tenantId, objectApiName }).lean();
  }

  if (type === 'record_triggered') {
    if (!objectApiName) problems.push('Choose the object whose records start this flow.');
    const events = trigger.events || [];
    const known = ['create', 'update', 'delete', 'all'];
    if (!events.length) problems.push('Choose when the flow runs: created, updated, or created or updated.');
    else if (events.some((e) => !known.includes(e))) problems.push('Unknown trigger event.');
  }

  // Entry Condition — same rules as a validation rule's formula.
  const expression = String(trigger.entryCondition || '').trim();
  if (expression) {
    const result = validateFormula(expression, buildSampleContext(fields), {
      asCondition: true,
      fieldKinds: buildFieldKindMap(fields),
      allowRecordState: true,
    });
    if (!result.valid) {
      problems.push(`Entry condition: ${result.error}`);
    } else {
      const keys = configKeysIn(expression);
      if (keys.length) {
        const found = await configurationService.resolveMany(keys, tenantId);
        keys.filter((k) => !(k in found)).forEach((k) => problems.push(`Entry condition: CONFIG("${k}") is not a configuration setting.`));
      }
    }
  }

  if (type === 'scheduled') {
    const s = trigger.schedule || {};
    if (s.timezone) {
      try {
        new Intl.DateTimeFormat('en-GB', { timeZone: s.timezone });
      } catch {
        problems.push(`"${s.timezone}" is not a time zone.`);
      }
    }
    if (s.mode === 'relative_date') {
      if (!objectApiName) problems.push('A time-based flow needs an object.');
      const dateField = fields.find((f) => f.apiName === s.dateField);
      if (!s.dateField) problems.push('Choose the date field the schedule counts from (e.g. Due Date).');
      else if (objectApiName && !dateField) problems.push(`"${s.dateField}" is not a field on ${objectApiName}.`);
      else if (dateField && !['date', 'datetime'].includes(dateField.type)) problems.push(`"${dateField.label || s.dateField}" is not a date field.`);
      const days = Number(s.days);
      if (!Number.isInteger(days) || days < 0 || days > 3650) problems.push('Days must be a whole number from 0 to 3650.');
      if (s.when && !['before', 'after', 'on'].includes(s.when)) problems.push('Choose before, after or on the date.');
      if (s.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.time)) problems.push('Time of day must be HH:MM (24-hour).');
    } else {
      try {
        parseCron(s.cron);
      } catch (err) {
        problems.push(`Schedule: ${err.message}.`);
      }
    }
  }

  if (problems.length) throw new AppError(problems.join('\n'), 400);
};
