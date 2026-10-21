import api from '../api';

/**
 * Run the tenant's duplicate rules against unsaved form data.
 * Resolves to { matches: [{ recordId, name, matchedFields }], action: 'allow'|'warn'|'block' }.
 */
export const checkDuplicates = (objectApiName, data, excludeRecordId) =>
  api
    .post('/duplicate-rules/check', { objectApiName, data, excludeRecordId })
    .then((res) => res.data.data);

/* ── Rule configuration (admin) ────────────────────────────────────────── */

export const getDuplicateRules = (params) =>
  api.get('/duplicate-rules', { params }).then((res) => res.data.data || []);

export const createDuplicateRule = (data) =>
  api.post('/duplicate-rules', data).then((res) => res.data.data);

export const updateDuplicateRule = (id, data) =>
  api.put(`/duplicate-rules/${id}`, data).then((res) => res.data.data);

export const deleteDuplicateRule = (id) => api.delete(`/duplicate-rules/${id}`);
