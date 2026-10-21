import api from '../api';

/* ── Policies ──────────────────────────────────────────────────────────── */

/**
 * Policy state for servicing: { policy, allowed_actions, can_issue, parties,
 * insured_lives, acceptance, status_history }.
 */
export const getPolicyState = (policyId) =>
  api.get(`/insurance/policies/${policyId}`).then((res) => res.data.data);

/** lapse | reinstate | suspend | reactivate | cancel | close */
export const applyPolicyAction = (policyId, action, reason) =>
  api
    .post(`/insurance/policies/${policyId}/${action}`, reason ? { reason } : {})
    .then((res) => res.data.data);

export const issuePolicy = (policyId) =>
  api.post(`/insurance/policies/${policyId}/issue`).then((res) => res.data.data);

/* ── Documents & communications ────────────────────────────────────────── */

export const getPolicyDocuments = (policyId) =>
  api.get(`/insurance/policies/${policyId}/documents`).then((res) => res.data.data || []);

/** contract | schedule | certificate */
export const generatePolicyDocument = (policyId, type) =>
  api.post(`/insurance/policies/${policyId}/documents/${type}`).then((res) => res.data.data);

export const getPolicyCommunications = (policyId) =>
  api.get(`/insurance/policies/${policyId}/communications`).then((res) => res.data.data || []);

/** A stored file with its base64 `data`. */
export const getFile = (fileId) => api.get(`/files/${fileId}`).then((res) => res.data.data);
