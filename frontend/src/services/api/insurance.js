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

/* ── New business (applications) ───────────────────────────────────────── */

export const listInsuranceProducts = () =>
  api.get('/insurance/products').then((res) => res.data.data || []);

/** { product_version, limits, benefit_covers, child_benefit_rules } */
export const getProductVersionRules = (versionId) =>
  api.get(`/insurance/product-versions/${versionId}/rules`).then((res) => res.data.data);

/** body: { channel, product_version_id, lead_id?, idempotency_key? } → application state */
export const startApplication = (body) =>
  api.post('/insurance/applications', body).then((res) => res.data.data);

export const getApplication = (applicationId) =>
  api.get(`/insurance/applications/${applicationId}`).then((res) => res.data.data);

/**
 * Save one part of an application. `part` is one of: main-member,
 * premium-payer, spouse, children, extended-family, beneficiary, payment-method.
 */
export const saveApplicationPart = (applicationId, part, body) =>
  api.put(`/insurance/applications/${applicationId}/${part}`, body).then((res) => res.data.data);

/** Server-side premium: { rate_category, main, children, extended_family, totals } */
export const priceApplication = (applicationId) =>
  api.post(`/insurance/applications/${applicationId}/premium`).then((res) => res.data.data);

export const captureAcceptance = (applicationId, body) =>
  api.post(`/insurance/applications/${applicationId}/acceptance`, body).then((res) => res.data.data);

/** { valid, errors: [{ field, message }], premium } */
export const validateApplication = (applicationId) =>
  api.post(`/insurance/applications/${applicationId}/validate`).then((res) => res.data.data);

export const submitApplication = (applicationId) =>
  api.post(`/insurance/applications/${applicationId}/submit`).then((res) => res.data.data);
