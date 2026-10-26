import { withoutHelperFields } from '../../../../utils/fieldVisibility';
import { evaluateVisibilityRule } from '../../../../utils/evaluateVisibilityRule';

/**
 * Build form sections from layout or field grouping.
 * Combines layout sections with any missing required fields.
 * Pass formData to apply conditional visibility rules.
 */
export const buildFormSections = (layout, allFields, formData = {}, isEdit = false) => {
  // Helper fields are computed feeds for other calculations — never editable
  // and never shown on a form.
  const fields = withoutHelperFields(allFields);

  let sections = [];
  const fieldsInLayout = new Set();

  // Use layout sections if available
  if (layout?.sections?.length > 0) {
    sections = layout.sections
      .filter((sec) => !isEdit || evaluateVisibilityRule(sec.visibilityRule, formData))
      .map((sec) => ({
        id: sec.id,
        label: sec.label,
        columns: sec.columns || 2,
        columnData: (sec.columnData || []).map((col) => ({
          fields: (col.fields || []).filter((fi) =>
            !isEdit || evaluateVisibilityRule(fi.visibilityRule, formData)
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
  const missingFields = fields.filter((f) => !fieldsInLayout.has(f.apiName));

  if (missingFields.length > 0) {
    if (sections.length > 0) {
      // Deep-clone the first section so we don't mutate cached layout data.
      const first = sections[0];
      const col0 = [...(first.columnData?.[0]?.fields || [])];
      const col1 = [...(first.columnData?.[1]?.fields || [])];
      missingFields.forEach((f, idx) => {
        const entry = { fieldApiName: f.apiName, label: f.label };
        if (idx % 2 === 0) col0.push(entry);
        else col1.push(entry);
      });
      sections[0] = {
        ...first,
        columnData: [{ fields: col0 }, { fields: col1 }],
      };
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
