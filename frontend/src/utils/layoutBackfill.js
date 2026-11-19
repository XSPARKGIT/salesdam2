/**
 * Which fields a layout shows even though it does not list them.
 *
 * A layout decides what appears (BRD 4.1.1: a simplified Agent layout can leave
 * fields out), with two exceptions:
 *
 *  - Fields the layout builder cannot place at all (auto-number, formula and
 *    read-only fields) are shown on every layout, or they would never appear.
 *  - On a form, a required field the layout left out is still shown, otherwise
 *    the record could not be saved.
 *
 * Anything else the layout omits stays off the page.
 */
/**
 * A field is required when either flag says so: a field's own `isRequired`, or
 * a required rule set through its validations. The record form already treats
 * both as required, so everything that reasons about "required" must too.
 */
export const isFieldRequired = (f) => !!(f?.isRequired || f?.validations?.required);

export const isPlaceableField = (f) =>
  f?.type !== 'auto_number' && f?.type !== 'formula' && !f?.isReadOnly;

export const fieldsToBackfill = (fields, inLayout, { forForm = false } = {}) =>
  (fields || []).filter(
    (f) =>
      !inLayout.has(f.apiName) &&
      (!isPlaceableField(f) || (forForm && isFieldRequired(f))),
  );
