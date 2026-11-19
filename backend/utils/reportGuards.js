import { getVisibleFields } from '../middleware/permissions.js';
import { AppError } from './errors.js';

// One calculation model: the same five functions Roll-Up Summary fields use (BRD 11.3).
export const REPORT_FUNCTIONS = ['count', 'sum', 'avg', 'min', 'max'];

export function assertReportFunctions(aggregations = []) {
  for (const a of aggregations) {
    if (!REPORT_FUNCTIONS.includes(a?.func)) {
      throw new AppError(
        `Unsupported function "${a?.func}". Use one of: ${REPORT_FUNCTIONS.join(', ')}.`,
        400,
      );
    }
  }
}

// Field security: a report may not group, total or filter on a field the user cannot see.
export async function assertReportFieldsVisible(user, objectApiName, fieldNames = []) {
  const wanted = [...new Set(fieldNames.filter(Boolean))].filter((f) => !['createdAt', 'updatedAt'].includes(f));
  if (!wanted.length) return;
  const visible = new Set(await getVisibleFields(user, objectApiName, wanted));
  const hidden = wanted.filter((f) => !visible.has(f));
  if (hidden.length) {
    throw new AppError(`You do not have access to the field "${hidden[0]}" on ${objectApiName}.`, 403);
  }
}
