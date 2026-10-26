/**
 * Pull per-field validation messages out of a failed save.
 *
 * The API returns `fieldErrors` ({ fieldApiName: message }) for anything it can
 * attribute to a single input — a duplicate value on a unique field, a bad
 * email, a failed regex — so those can be highlighted on the field itself
 * instead of only appearing in a toast.
 *
 * @param {Error}  err     rejected request (must carry `response`)
 * @param {Array}  fields  FieldMeta for the form being submitted
 * @returns {{ fieldErrors: object, message: string }}
 */
export const extractServerErrors = (err, fields = []) => {
  // The axios response interceptor (api.js) transforms errors into plain objects
  // { message, status, data } — so err.response is absent and the response body
  // lives at err.data instead. Support both shapes.
  const data = err?.response?.data ?? err?.data;
  const fieldErrors = { ...(data?.fieldErrors || {}) };

  // Only keep keys that correspond to a field actually on this form, so an
  // unknown key can never leave behind an error the user has no way to clear.
  const known = new Set((fields || []).map((f) => f.apiName));
  Object.keys(fieldErrors).forEach((k) => {
    if (!known.has(k)) delete fieldErrors[k];
  });

  const attributed = Object.keys(fieldErrors).length;
  const total = Array.isArray(data?.validationErrors)
    ? data.validationErrors.length
    : null;

  // When every message is pinned to a field, the inputs already tell the story —
  // keep the toast short rather than repeating each message twice.
  let message = data?.message || err?.message || 'Failed to save record.';
  if (attributed > 0 && total !== null && attributed >= total) {
    message =
      attributed === 1
        ? Object.values(fieldErrors)[0]
        : `Please fix ${attributed} highlighted fields.`;
  }

  return { fieldErrors, message };
};
