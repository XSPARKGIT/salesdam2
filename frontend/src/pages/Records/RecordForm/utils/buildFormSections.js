import { withoutHelperFields } from '../../../../utils/fieldVisibility';
import { evaluateVisibilityRule } from '../../../../utils/evaluateVisibilityRule';
import { fieldsToBackfill } from '../../../../utils/layoutBackfill';

/**
 * Field api names the layout currently hides for this data, either because
 * their own condition fails or because the section they sit in is hidden
 * (BRD 4.1.5). Hidden fields are not on screen, so they cannot be required.
 */
export const fieldsHiddenByLayout = (layout, formData = {}) => {
  const hidden = new Set();
  (layout?.sections || []).forEach((sec) => {
    const sectionHidden = !evaluateVisibilityRule(sec.visibilityRule, formData);
    (sec.columnData || []).forEach((col) =>
      (col.fields || []).forEach((fi) => {
        if (sectionHidden || !evaluateVisibilityRule(fi.visibilityRule, formData)) {
          hidden.add(fi.fieldApiName);
        }
      }),
    );
  });
  return hidden;
};

/**
 * Build form sections from layout or field grouping.
 * Combines layout sections with any missing required fields.
 * Pass formData to apply conditional visibility rules; they apply on create as
 * well as edit, re-evaluating as the user fills the form in.
 */
export const buildFormSections = (layout, allFields, formData = {}) => {
  // Helper fields are computed feeds for other calculations — never editable
  // and never shown on a form.
  const fields = withoutHelperFields(allFields);

  let sections = [];
  const fieldsInLayout = new Set();

  // Use layout sections if available
  if (layout?.sections?.length > 0) {
    sections = layout.sections
      .filter((sec) => evaluateVisibilityRule(sec.visibilityRule, formData))
      .map((sec) => ({
        id: sec.id,
        label: sec.label,
        columns: sec.columns || 2,
        columnData: (sec.columnData || []).map((col) => ({
          fields: (col.fields || []).filter((fi) =>
            evaluateVisibilityRule(fi.visibilityRule, formData)
          ),
        })),
      }));

    // Track which fields are already in the layout (use original sections, not filtered)
    layout.sections.forEach((sec) => {
      if (sec.columnData) {
        sec.columnData.forEach((col) => {
          if (col.fields) {
            col.fields.forEach((f) => {
              fieldsInLayout.add(f.fieldApiName);
            });
          }
        });
      }
    });
  } else {
    // Fallback: group by field.section
    const grouped = {};
    fields.forEach((f) => {
      const sec = f.section || 'Information';
      if (!grouped[sec]) grouped[sec] = [];
      grouped[sec].push(f);
    });

    return Object.entries(grouped).map(([label, sFields], i) => ({
      id: `fallback_${i}`,
      label,
      columns: 2,
      columnData: [
        {
          fields: sFields
            .filter((_, idx) => idx % 2 === 0)
            .map((f) => ({ fieldApiName: f.apiName, label: f.label })),
        },
        {
          fields: sFields
            .filter((_, idx) => idx % 2 !== 0)
            .map((f) => ({ fieldApiName: f.apiName, label: f.label })),
        },
      ],
    }));
  }

  // Merge fields not in the layout into the first section's columns so they
  // appear alongside existing fields, not in a separate orphan group.
  const missingFields = fieldsToBackfill(fields, fieldsInLayout, { forForm: true });

  if (missingFields.length > 0) {
    if (sections.length > 0) {
      // Deep-clone the first section so we don't mutate cached layout data.
      const first = sections[0];
      const cols = Math.max(first.columnData?.length || 0, 1);
      const columnData = Array.from({ length: cols }, (_, c) => ({
        fields: [...(first.columnData?.[c]?.fields || [])],
      }));
      missingFields.forEach((f, idx) => {
        columnData[idx % cols].fields.push({ fieldApiName: f.apiName, label: f.label });
      });
      sections[0] = { ...first, columnData };
    } else {
      sections.push({
        id: 'auto_section',
        label: 'Information',
        columns: 2,
        columnData: [
          { fields: missingFields.filter((_, i) => i % 2 === 0).map((f) => ({ fieldApiName: f.apiName, label: f.label })) },
          { fields: missingFields.filter((_, i) => i % 2 !== 0).map((f) => ({ fieldApiName: f.apiName, label: f.label })) },
        ],
      });
    }
  }

  return sections;
};
