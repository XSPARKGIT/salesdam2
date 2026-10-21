import api from '../api';

/* ── Process configuration (admin) ─────────────────────────────────────── */

export const getApprovalProcesses = (params) =>
  api.get('/approval-processes', { params }).then((res) => res.data.data || []);

export const getApprovalProcess = (id) =>
  api.get(`/approval-processes/${id}`).then((res) => res.data.data);

export const createApprovalProcess = (data) =>
  api.post('/approval-processes', data).then((res) => res.data.data);

export const updateApprovalProcess = (id, data) =>
  api.put(`/approval-processes/${id}`, data).then((res) => res.data.data);

export const deleteApprovalProcess = (id) => api.delete(`/approval-processes/${id}`);

/* ── Runtime ───────────────────────────────────────────────────────────── */

/**
 * Latest approval request for a record plus what the current user can do:
 * { request, canDecide, canRecall, canSubmit, eligibleProcesses }.
 */
export const getApprovalState = (objectApiName, recordId) =>
  api
    .get('/approval-processes/state', { params: { objectApiName, recordId } })
    .then((res) => ({ request: res.data.data, ...(res.data.meta || {}) }));

export const submitForApproval = (objectApiName, recordId, processId) =>
  api
    .post('/approval-processes/submit', { objectApiName, recordId, processId })
    .then((res) => res.data.data);

export const approveRequest = (id, comment) =>
  api.post(`/approval-processes/${id}/approve`, { comment }).then((res) => res.data.data);

export const rejectRequest = (id, comment) =>
  api.post(`/approval-processes/${id}/reject`, { comment }).then((res) => res.data.data);

export const recallRequest = (id) =>
  api.post(`/approval-processes/${id}/recall`).then((res) => res.data.data);

export const getMyPendingApprovals = () =>
  api.get('/approval-processes/pending/mine').then((res) => res.data.data || []);
