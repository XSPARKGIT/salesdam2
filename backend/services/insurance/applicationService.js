/**
 * Insurance application & policy lifecycle service (BRD §7, §10, §11, §12).
 *
 * One authoritative application engine shared by the Website, Branch and
 * Telephone channels (BRD §2): the same rules, matching, pricing and validation.
 * Records are ordinary metadata records (`policy`, `insured_life`,
 * `policy_party`, `policy_acceptance`, `policy_status_history`) so they
 * participate in the Core layout/permission/search/reporting frameworks.
 *
 * Tenant scope is always the caller-supplied `tenantId`, which the route derives
 * from the authenticated session/API key — never from the request body.
 */
import { findOne, findMany, createDynamic, updateDynamic, getObjectMeta } from './dynamicRecords.js';
import DynamicRecord from '../../models/DynamicRecord.js';
import { dataOf, priceApplication } from './pricingService.js';
import { resolveClient } from './identityMatching.js';
import * as approvalService from './approvalService.js';
import * as policyDocumentService from './policyDocumentService.js';
import * as communicationService from './communicationService.js';
import * as communicationDispatcher from './communicationDispatcher.js';
import { AppError, ValidationError } from '../../utils/errors.js';
import { audit } from '../../utils/auditLogger.js';

export const POLICY_STATUS = {
  STARTED: 'application_started',
  QUOTE: 'quote_generated',
  SUBMITTED: 'application_submitted',
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  ARREARS: 'in_arrears',
  LAPSED: 'lapsed',
  CANCELLED: 'cancelled',
  CLOSED: 'closed',
};

// Server-side enforced transitions (BRD §7.6, §12). Reject anything else.
const TRANSITIONS = {
  [POLICY_STATUS.STARTED]: [POLICY_STATUS.QUOTE, POLICY_STATUS.SUBMITTED, POLICY_STATUS.CANCELLED],
  [POLICY_STATUS.QUOTE]: [POLICY_STATUS.SUBMITTED, POLICY_STATUS.CANCELLED],
  [POLICY_STATUS.SUBMITTED]: [POLICY_STATUS.ACTIVE, POLICY_STATUS.CANCELLED, POLICY_STATUS.CLOSED],
  [POLICY_STATUS.ACTIVE]: [
    POLICY_STATUS.INACTIVE,
    POLICY_STATUS.ARREARS,
    POLICY_STATUS.LAPSED,
    POLICY_STATUS.CANCELLED,
    POLICY_STATUS.CLOSED,
  ],
  [POLICY_STATUS.INACTIVE]: [POLICY_STATUS.ACTIVE, POLICY_STATUS.CANCELLED],
  [POLICY_STATUS.ARREARS]: [POLICY_STATUS.ACTIVE, POLICY_STATUS.LAPSED, POLICY_STATUS.CANCELLED],
  [POLICY_STATUS.LAPSED]: [POLICY_STATUS.ACTIVE, POLICY_STATUS.CANCELLED, POLICY_STATUS.CLOSED],
  [POLICY_STATUS.CANCELLED]: [POLICY_STATUS.CLOSED],
  [POLICY_STATUS.CLOSED]: [],
};

export const CHANNELS = ['website', 'branch', 'telephone'];

const now = () => new Date();

const isBlank = (v) => v === undefined || v === null || v === '';

const policyId = (policy) => String(policy._id);

const loadPolicy = async (tenantId, id) => {
  const policy = await findOne(tenantId, 'policy', { _id: id });
  if (!policy) throw new AppError('Application/Policy not found.', 404);
  return policy;
};

const recordStatusHistory = async ({ tenantId, userId, policy, from, to, reason }) =>
  createDynamic({
    tenantId,
    objectApiName: 'policy_status_history',
    userId,
    data: {
      name: `${from || 'new'} → ${to}`,
      policy: policyId(policy),
      from_status: from || null,
      to_status: to,
      effective_date: now(),
      reason: reason || null,
      changed_by: String(userId),
    },
  });

const assertTransition = (from, to) => {
  const allowed = TRANSITIONS[from] || [];
  if (!allowed.includes(to)) {
    throw new AppError(`Invalid policy status transition: "${from}" → "${to}".`, 409);
  }
};

/** Apply a validated status transition and write durable history. */
const transition = async ({ tenantId, userId, policy, to, reason }) => {
  const data = dataOf(policy);
  const from = data.status || POLICY_STATUS.STARTED;
  if (from === to) return policy;
  assertTransition(from, to);
  await updateDynamic(policy, { status: to, status_effective_date: now(), status_reason: reason || null }, userId);
  await recordStatusHistory({ tenantId, userId, policy, from, to, reason });
  return policy;
};

// ── Insured lives ─────────────────────────────────────────────────────────────

const upsertInsuredLife = async ({ tenantId, userId, policy, relation, input = {}, coverAmount }) => {
  const client = await resolveClient({ tenantId, userId, input });
  const lives = await findMany(tenantId, 'insured_life', { 'data.policy': policyId(policy) });
  const existing = lives.find((l) => dataOf(l).relation === relation);

  const data = {
    name: `${input.name || client.record.getField('name') || 'Member'} (${relation})`,
    policy: policyId(policy),
    client: String(client.record._id),
    relation,
    age: input.age ?? (existing ? dataOf(existing).age : undefined),
    cover_amount: coverAmount ?? (existing ? dataOf(existing).cover_amount : undefined),
    start_date: input.start_date || now(),
    status: 'active',
  };

  if (existing) return updateDynamic(existing, data, userId);
  return createDynamic({ tenantId, objectApiName: 'insured_life', userId, data });
};

const softDelete = async (record, userId) => {
  record.isDeleted = true;
  record.deletedAt = now();
  record.deletedBy = userId;
  await record.save();
};

/** Reconcile a multi-life relation (children / extended family) to the given list. */
const syncLifeSet = async ({ tenantId, userId, policy, relation, entries = [], requireCover }) => {
  const lives = await findMany(tenantId, 'insured_life', { 'data.policy': policyId(policy) });
  const current = lives.filter((l) => dataOf(l).relation === relation && !l.isDeleted);
  const keptIds = new Set();

  for (const entry of entries) {
    if (requireCover && isBlank(entry.cover_amount)) {
      throw new ValidationError([`${relation} members require their own cover amount.`], 400, {
        fieldErrors: { [`${relation}.cover_amount`]: 'Cover amount is required.' },
      });
    }
    const client = await resolveClient({ tenantId, userId, input: entry });
    const clientId = String(client.record._id);
    let record = current.find((l) => String(dataOf(l).client) === clientId);
    const data = {
      name: `${entry.name || client.record.getField('name') || 'Member'} (${relation})`,
      policy: policyId(policy),
      client: clientId,
      relation,
      age: entry.age,
      cover_amount: entry.cover_amount,
      start_date: entry.start_date || now(),
      status: 'active',
    };
    if (record) {
      await updateDynamic(record, data, userId);
    } else {
      record = await createDynamic({ tenantId, objectApiName: 'insured_life', userId, data });
    }
    keptIds.add(String(record._id));
  }

  // End lives no longer present rather than silently dropping them (BRD §12).
  for (const live of current) {
    if (!keptIds.has(String(live._id))) {
      await updateDynamic(live, { status: 'ended', end_date: now() }, userId);
      await softDelete(live, userId);
    }
  }
  return loadPolicy(tenantId, policyId(policy));
};

// ── Application state ─────────────────────────────────────────────────────────

export const getApplicationState = async ({ tenantId, policyId: id }) => {
  const policy = await loadPolicy(tenantId, id);
  const pid = policyId(policy);
  const [parties, lives, acceptances, history] = await Promise.all([
    findMany(tenantId, 'policy_party', { 'data.policy': pid }),
    findMany(tenantId, 'insured_life', { 'data.policy': pid }),
    findMany(tenantId, 'policy_acceptance', { 'data.policy': pid }, { createdAt: -1 }),
    findMany(tenantId, 'policy_status_history', { 'data.policy': pid }),
  ]);
  const status = dataOf(policy).status || POLICY_STATUS.STARTED;
  return {
    policy: { id: pid, ...dataOf(policy) },
    // What an operator can do next from this status (servicing UI).
    allowed_actions: availablePolicyActions(status),
    can_issue: status === POLICY_STATUS.SUBMITTED,
    parties: parties.map((p) => ({ id: String(p._id), ...dataOf(p) })),
    insured_lives: lives.filter((l) => !l.isDeleted).map((l) => ({ id: String(l._id), ...dataOf(l) })),
    acceptance: acceptances.length ? { id: String(acceptances[0]._id), ...dataOf(acceptances[0]) } : null,
    status_history: history.map((h) => ({ id: String(h._id), ...dataOf(h) })),
  };
};

// ── Commands ──────────────────────────────────────────────────────────────────

export const startApplication = async ({ tenantId, userId, body = {} }) => {
  const channel = body.channel;
  if (!CHANNELS.includes(channel)) {
    throw new ValidationError([`channel must be one of: ${CHANNELS.join(', ')}`], 400, {
      fieldErrors: { channel: 'A valid application channel is required.' },
    });
  }
  if (isBlank(body.product_version_id)) {
    throw new ValidationError(['product_version_id is required.'], 400, {
      fieldErrors: { product_version_id: 'A product version is required.' },
    });
  }
  // Fail fast if the pack isn't seeded for this tenant.
  await getObjectMeta(tenantId, 'policy');

  const pv = await findOne(tenantId, 'product_version', { _id: body.product_version_id });
  if (!pv) throw new AppError('Product Version not found.', 404);

  // Idempotent retry: same key returns the same application, no duplicates (BRD §8.6).
  if (body.idempotency_key) {
    const existing = await findOne(tenantId, 'policy', { 'data.idempotency_key': body.idempotency_key });
    if (existing) return getApplicationState({ tenantId, policyId: String(existing._id) });
  }

  const pvData = dataOf(pv);
  if (pvData.status && pvData.status !== 'active') {
    throw new AppError('This Product Version is not active.', 409);
  }

  const policy = await createDynamic({
    tenantId,
    objectApiName: 'policy',
    userId,
    data: {
      // shortcut: the auto-number policy number is assigned at application start
      // (record create), not at issue as BRD §11.2 describes. Acceptable while
      // applications are cheap; switch to issue-time numbering if abandoned
      // applications must not consume numbers.
      status: POLICY_STATUS.STARTED,
      status_effective_date: now(),
      application_channel: channel,
      product_version: String(pv._id),
      product: pvData.product ? String(pvData.product) : undefined,
      underwriter: body.underwriter_id ? String(body.underwriter_id) : undefined,
      agent: body.agent_id ? String(body.agent_id) : undefined,
      branch: body.branch || undefined,
      lead: body.lead_id ? String(body.lead_id) : undefined,
      idempotency_key: body.idempotency_key || undefined,
    },
  });
  await recordStatusHistory({
    tenantId,
    userId,
    policy,
    from: null,
    to: POLICY_STATUS.STARTED,
    reason: 'Application started',
  });

  if (body.premium_payer) await setPremiumPayer({ tenantId, userId, policyId: policyId(policy), body: body.premium_payer });
  if (body.main_member) await setMainMember({ tenantId, userId, policyId: policyId(policy), body: body.main_member });

  await audit({
    tenantId,
    userId,
    action: 'create',
    resource: 'InsuranceApplication',
    resourceId: policy._id,
    objectApiName: 'policy',
    details: { channel },
  });

  return getApplicationState({ tenantId, policyId: policyId(policy) });
};

const addParty = async ({ tenantId, userId, policy, role, input }) => {
  const resolved = await resolveClient({ tenantId, userId, input });
  const clientId = String(resolved.record._id);
  const parties = await findMany(tenantId, 'policy_party', { 'data.policy': policyId(policy) });
  const existing = parties.find((p) => dataOf(p).role === role && String(dataOf(p).client) === clientId);
  const data = {
    name: `${resolved.record.getField('name') || 'Party'} (${role})`,
    policy: policyId(policy),
    client: clientId,
    role,
    effective_from: now(),
  };
  if (existing) return updateDynamic(existing, data, userId);
  return createDynamic({ tenantId, objectApiName: 'policy_party', userId, data });
};

export const setPremiumPayer = async ({ tenantId, userId, policyId: id, body = {} }) => {
  const policy = await loadPolicy(tenantId, id);
  const resolved = await resolveClient({ tenantId, userId, input: body });
  await updateDynamic(policy, { premium_payer: String(resolved.record._id) }, userId);
  await addParty({ tenantId, userId, policy, role: 'premium_payer', input: { client_id: String(resolved.record._id) } });
  return getApplicationState({ tenantId, policyId: policyId(policy) });
};

export const setMainMember = async ({ tenantId, userId, policyId: id, body = {} }) => {
  const policy = await loadPolicy(tenantId, id);
  const resolved = await resolveClient({ tenantId, userId, input: body });
  await updateDynamic(policy, { main_member: String(resolved.record._id) }, userId);
  await upsertInsuredLife({
    tenantId,
    userId,
    policy,
    relation: 'main_member',
    input: { ...body, client_id: String(resolved.record._id) },
    coverAmount: body.cover_amount,
  });
  await addParty({ tenantId, userId, policy, role: 'main_member', input: { client_id: String(resolved.record._id) } });
  return getApplicationState({ tenantId, policyId: policyId(policy) });
};

export const setSpouse = async ({ tenantId, userId, policyId: id, body = {} }) => {
  const policy = await loadPolicy(tenantId, id);
  if (body.remove === true || isBlank(body.client_id) && isBlank(body.id_number) && isBlank(body.name)) {
    const lives = await findMany(tenantId, 'insured_life', { 'data.policy': policyId(policy) });
    const spouse = lives.find((l) => dataOf(l).relation === 'spouse');
    if (spouse) {
      await updateDynamic(spouse, { status: 'ended', end_date: now() }, userId);
      await softDelete(spouse, userId);
    }
    return getApplicationState({ tenantId, policyId: policyId(policy) });
  }
  await upsertInsuredLife({ tenantId, userId, policy, relation: 'spouse', input: body });
  return getApplicationState({ tenantId, policyId: policyId(policy) });
};

export const syncChildren = async ({ tenantId, userId, policyId: id, body = {} }) => {
  const policy = await loadPolicy(tenantId, id);
  await syncLifeSet({ tenantId, userId, policy, relation: 'child', entries: body.children || [] });
  return getApplicationState({ tenantId, policyId: policyId(policy) });
};

export const syncExtendedFamily = async ({ tenantId, userId, policyId: id, body = {} }) => {
  const policy = await loadPolicy(tenantId, id);
  await syncLifeSet({
    tenantId,
    userId,
    policy,
    relation: 'extended_family',
    entries: body.members || [],
    requireCover: true,
  });
  return getApplicationState({ tenantId, policyId: policyId(policy) });
};

export const setBeneficiary = async ({ tenantId, userId, policyId: id, body = {} }) => {
  const policy = await loadPolicy(tenantId, id);
  await addParty({ tenantId, userId, policy, role: 'beneficiary', input: body });
  return getApplicationState({ tenantId, policyId: policyId(policy) });
};

export const setPaymentMethod = async ({ tenantId, userId, policyId: id, body = {} }) => {
  const policy = await loadPolicy(tenantId, id);
  await updateDynamic(
    policy,
    {
      payment_method: body.payment_method,
      payment_provider_reference: body.provider_reference,
    },
    userId,
  );
  return getApplicationState({ tenantId, policyId: policyId(policy) });
};

const buildMembers = (lives) =>
  lives
    .filter((l) => !l.isDeleted && dataOf(l).status !== 'ended')
    .map((l) => {
      const d = dataOf(l);
      return { relation: d.relation, age: d.age, cover_amount: d.cover_amount };
    });

export const calculatePremium = async ({ tenantId, policyId: id }) => {
  const policy = await loadPolicy(tenantId, id);
  const data = dataOf(policy);
  if (!data.product_version) throw new AppError('The application has no Product Version.', 409);
  const lives = await findMany(tenantId, 'insured_life', { 'data.policy': policyId(policy) });
  const members = buildMembers(lives);
  const main = lives.find((l) => dataOf(l).relation === 'main_member');
  const mainCover = main ? dataOf(main).cover_amount : undefined;

  return priceApplication({
    tenantId,
    productVersionId: String(data.product_version),
    members,
    mainCoverAmount: mainCover,
  });
};

export const captureAcceptance = async ({ tenantId, userId, policyId: id, body = {} }) => {
  const policy = await loadPolicy(tenantId, id);
  const channel = body.channel || dataOf(policy).application_channel;
  if (!CHANNELS.includes(channel)) throw new AppError('A valid acceptance channel is required.', 400);

  const fieldErrors = {};
  if (isBlank(body.accepted_terms_version)) fieldErrors.accepted_terms_version = 'The accepted terms/declaration version is required.';
  if (channel === 'branch' && isBlank(body.signature_reference)) {
    fieldErrors.signature_reference = 'Branch acceptance requires captured signature evidence.';
  }
  if (channel === 'telephone' && isBlank(body.recording_reference) && body.tenant_fallback !== true) {
    fieldErrors.recording_reference = 'Telephone acceptance requires a call-recording reference (or an approved fallback).';
  }
  if (Object.keys(fieldErrors).length) {
    throw new ValidationError(Object.values(fieldErrors), 400, { fieldErrors });
  }

  const record = await createDynamic({
    tenantId,
    objectApiName: 'policy_acceptance',
    userId,
    data: {
      name: `Acceptance (${channel})`,
      policy: policyId(policy),
      channel,
      accepted_terms_version: body.accepted_terms_version,
      accepted_at: body.accepted_at || now(),
      accepted_by: String(userId),
      signature_reference: body.signature_reference,
      recording_reference: body.recording_reference,
      call_activity: body.call_activity_id ? String(body.call_activity_id) : undefined,
      evidence_reference: body.evidence_reference,
    },
  });
  await audit({
    tenantId,
    userId,
    action: 'update',
    resource: 'PolicyAcceptance',
    resourceId: record._id,
    objectApiName: 'policy_acceptance',
    details: { channel, policy: policyId(policy) },
  });
  return { id: String(record._id), ...dataOf(record) };
};

export const validateApplication = async ({ tenantId, policyId: id }) => {
  const policy = await loadPolicy(tenantId, id);
  const data = dataOf(policy);
  const errors = [];

  if (isBlank(data.premium_payer)) errors.push({ field: 'premium_payer', message: 'Premium Payer is required.' });
  if (isBlank(data.main_member)) errors.push({ field: 'main_member', message: 'Main Member is required.' });
  if (isBlank(data.product_version)) errors.push({ field: 'product_version', message: 'Product Version is required.' });

  const lives = await findMany(tenantId, 'insured_life', { 'data.policy': policyId(policy) });
  const main = lives.find((l) => dataOf(l).relation === 'main_member' && !l.isDeleted);
  if (!main) {
    errors.push({ field: 'main_member', message: 'Main Member insured life is missing.' });
  } else {
    const md = dataOf(main);
    if (isBlank(md.age)) errors.push({ field: 'main_member.age', message: 'Main Member age is required.' });
    if (isBlank(md.cover_amount)) errors.push({ field: 'main_cover_amount', message: 'A main cover amount is required.' });
  }

  const acceptances = await findMany(tenantId, 'policy_acceptance', { 'data.policy': policyId(policy) });
  if (!acceptances.length) {
    errors.push({ field: 'acceptance', message: 'Contractual acceptance is required before submission.' });
  }

  let premium = null;
  try {
    premium = await calculatePremium({ tenantId, policyId: policyId(policy) });
  } catch (err) {
    errors.push({ field: 'premium', message: err.message });
  }

  return { valid: errors.length === 0, errors, premium };
};

export const submitApplication = async ({ tenantId, userId, policyId: id }) => {
  const policy = await loadPolicy(tenantId, id);
  const { valid, errors, premium } = await validateApplication({ tenantId, policyId: id });
  if (!valid) {
    throw new ValidationError(
      errors.map((e) => e.message),
      400,
      { fieldErrors: errors.reduce((acc, e) => ({ ...acc, [e.field]: e.message }), {}) },
    );
  }
  await updateDynamic(policy, { current_premium: premium.totals.premium }, userId);
  await transition({ tenantId, userId, policy, to: POLICY_STATUS.SUBMITTED, reason: 'Application submitted' });

  // If the product version requires approval, create a pending approval record.
  // The policy stays in SUBMITTED until the approval is approved.
  const pvId = dataOf(policy).product_version;
  if (pvId) {
    await approvalService.createApprovalIfRequired({ tenantId, userId, policy, productVersionId: pvId });
  }

  await audit({
    tenantId,
    userId,
    action: 'update',
    resource: 'InsuranceApplication',
    resourceId: policy._id,
    objectApiName: 'policy',
    details: { transition: 'submitted', premium: premium.totals.premium },
  });
  return { ...(await getApplicationState({ tenantId, policyId: policyId(policy) })), premium };
};

/**
 * Issue & activate. If the Product Version requires approval (BRD §11.2),
 * the policy must have an approved `policy_approval` record before it can
 * transition to ACTIVE.
 */
export const issuePolicy = async ({ tenantId, userId, policyId: id }) => {
  const policy = await loadPolicy(tenantId, id);
  const pData = dataOf(policy);

  if (pData.status !== POLICY_STATUS.SUBMITTED) {
    throw new AppError('Only a submitted application can be issued.', 409);
  }

  const pvId = pData.product_version;
  if (pvId && (await approvalService.requiresApproval(tenantId, pvId))) {
    const approvals = await approvalService.getApprovalState({ tenantId, policyId: id });
    const latest = approvals[0];
    if (!latest || latest.status !== approvalService.APPROVAL_STATUS.APPROVED) {
      throw new AppError('This policy requires an approved sign-off before it can be issued.', 409);
    }
  }

  await transition({ tenantId, userId, policy, to: POLICY_STATUS.ACTIVE, reason: 'Policy issued and activated' });

  // Generate policy documents on issue (BRD §11.3) — contract + schedule.
  let generatedFiles = [];
  try {
    const contractResult = await policyDocumentService.generatePolicyDocument({ tenantId, userId, policyId: id, type: 'contract' });
    const scheduleResult = await policyDocumentService.generatePolicyDocument({ tenantId, userId, policyId: id, type: 'schedule' });
    generatedFiles = [...(contractResult.files || []), ...(scheduleResult.files || [])];
  } catch (docErr) {
    // Document generation failure must not block issuance.
    console.error('Policy document generation failed:', docErr.message);
  }

  // Log policy issued communication (BRD §16.3) and dispatch with documents.
  try {
    const payer = await findOne(tenantId, 'policy_party', { 'data.policy': id, 'data.role': 'premium_payer' });
    if (payer) {
      const comm = await communicationService.logCommunication({
        tenantId,
        userId,
        policyId: id,
        client: dataOf(payer).client,
        event: 'policy_issued',
        channel: 'email',
        subject: `Policy ${pData.policy_number || ''} issued`,
        body: `Your policy ${pData.policy_number || ''} is now active. Premium: R${pData.current_premium ?? ''}`,
        // Attach generated documents
        attachments: generatedFiles.map(f => ({ fileId: f.id, name: f.name, mimeType: f.mimeType })),
      });
      // Dispatch the communication (queues for email delivery)
      try {
        await communicationDispatcher.dispatchCommunications(tenantId);
      } catch (dispErr) {
        console.error('Communication dispatch failed:', dispErr.message);
      }
    }
  } catch (commErr) {
    console.error('Communication logging failed:', commErr.message);
  }

  await audit({
    tenantId,
    userId,
    action: 'update',
    resource: 'InsurancePolicy',
    resourceId: policy._id,
    objectApiName: 'policy',
    details: { transition: 'active' },
  });
  return getApplicationState({ tenantId, policyId: policyId(policy) });
};

// ── Servicing & lifecycle (BRD §12) ───────────────────────────────────────────

/** Operator/service actions mapped to their validated target status. */
export const POLICY_ACTIONS = {
  lapse: POLICY_STATUS.LAPSED,
  reinstate: POLICY_STATUS.ACTIVE,
  cancel: POLICY_STATUS.CANCELLED,
  suspend: POLICY_STATUS.INACTIVE,
  reactivate: POLICY_STATUS.ACTIVE,
  close: POLICY_STATUS.CLOSED,
};

// Which statuses each action is meant for. Both reinstate and reactivate lead
// to ACTIVE, but they are different operations: reinstate restores a lapsed or
// in-arrears policy, reactivate resumes a suspended (inactive) one.
const ACTION_FROM = {
  lapse: [POLICY_STATUS.ACTIVE, POLICY_STATUS.ARREARS],
  reinstate: [POLICY_STATUS.LAPSED, POLICY_STATUS.ARREARS],
  suspend: [POLICY_STATUS.ACTIVE],
  reactivate: [POLICY_STATUS.INACTIVE],
  cancel: null, // wherever the state machine allows it
  close: null,
};

/**
 * Servicing actions that make sense from `status`: the action's intended
 * source statuses, intersected with the state machine's legal transitions.
 */
export const availablePolicyActions = (status) =>
  Object.entries(POLICY_ACTIONS)
    .filter(([action, to]) => {
      const from = ACTION_FROM[action];
      if (from && !from.includes(status)) return false;
      return (TRANSITIONS[status] || []).includes(to);
    })
    .map(([action]) => action);

/**
 * Apply a servicing action to a policy. The shared state machine validates the
 * transition, so an illegal action (e.g. reinstating a cancelled policy) is
 * rejected. Billing/arrears triggers are a later stage: lapse/reinstate here are
 * operator/service actions, not automatic missed-payment outcomes.
 */
export const applyPolicyAction = async ({ tenantId, userId, policyId: id, action, reason }) => {
  const to = POLICY_ACTIONS[action];
  if (!to) throw new AppError(`Unknown policy action "${action}".`, 400);
  const policy = await loadPolicy(tenantId, id);
  await transition({ tenantId, userId, policy, to, reason: reason || `Servicing action: ${action}` });

  // Log servicing communication (BRD §16.3).
  const COMM_EVENT = { lapse: 'policy_lapsed', reinstate: 'policy_reinstated', cancel: 'policy_cancelled' };
  if (COMM_EVENT[action]) {
    try {
      const payer = await findOne(tenantId, 'policy_party', { 'data.policy': id, 'data.role': 'premium_payer' });
      if (payer) {
        await communicationService.logCommunication({
          tenantId,
          userId,
          policyId: id,
          client: dataOf(payer).client,
          event: COMM_EVENT[action],
          channel: 'email',
          subject: `Policy ${dataOf(policy).policy_number || ''} ${action}d`,
          body: `Your policy has been ${action}d. Reason: ${reason || 'Servicing action'}`,
        });
      }
    } catch (commErr) {
      console.error('Communication logging failed:', commErr.message);
    }
  }

  await audit({
    tenantId,
    userId,
    action: 'update',
    resource: 'InsurancePolicy',
    resourceId: policy._id,
    objectApiName: 'policy',
    details: { servicing: action, to },
  });
  return getApplicationState({ tenantId, policyId: policyId(policy) });
};

/** Tenant-scoped policy list (newest first, capped at 200). */
export const listPolicies = async ({ tenantId, status, limit = 50, skip = 0 } = {}) => {
  const cap = Math.min(Number(limit) || 50, 200);
  const offset = Number(skip) || 0;
  const filter = status ? { 'data.status': status } : {};
  const base = { tenantId, objectApiName: 'policy', isDeleted: false, ...filter };
  const [policies, total] = await Promise.all([
    DynamicRecord.find(base).sort({ createdAt: -1 }).skip(offset).limit(cap),
    DynamicRecord.countDocuments(base),
  ]);
  return {
    data: policies.map((p) => ({ id: String(p._id), ...dataOf(p) })),
    pagination: { total, limit: cap, skip: offset },
  };
};

// ── Product catalogue (BRD §8.4) ──────────────────────────────────────────────

export const listProducts = async ({ tenantId }) => {
  const [products, versions] = await Promise.all([
    findMany(tenantId, 'product'),
    findMany(tenantId, 'product_version'),
  ]);
  return products.map((p) => ({
    id: String(p._id),
    ...dataOf(p),
    versions: versions
      .filter((v) => String(dataOf(v).product) === String(p._id))
      .map((v) => ({ id: String(v._id), ...dataOf(v) })),
  }));
};

/** Website-relevant rules for a Product Version: limits, ages, covers, rates. */
export const productVersionRules = async ({ tenantId, versionId }) => {
  const pv = await findOne(tenantId, 'product_version', { _id: versionId });
  if (!pv) throw new AppError('Product Version not found.', 404);
  const [covers, rules] = await Promise.all([
    findMany(tenantId, 'benefit_cover'),
    findMany(tenantId, 'child_benefit_rule'),
  ]);
  const pvData = dataOf(pv);
  return {
    product_version: { id: String(pv._id), ...pvData },
    limits: {
      allow_spouse: pvData.allow_spouse === true,
      allow_children: pvData.allow_children === true,
      allow_extended_family: pvData.allow_extended_family === true,
      max_spouses: pvData.max_spouses ?? null,
      max_children: pvData.max_children ?? null,
      max_extended_family: pvData.max_extended_family ?? null,
      min_entry_age: pvData.min_entry_age ?? null,
      max_entry_age: pvData.max_entry_age ?? null,
    },
    benefit_covers: covers
      .filter((c) => String(dataOf(c).product_version) === String(versionId))
      .map((c) => ({ id: String(c._id), ...dataOf(c) })),
    child_benefit_rules: rules
      .filter((r) => String(dataOf(r).product_version) === String(versionId))
      .map((r) => ({ id: String(r._id), ...dataOf(r) })),
  };
};

export default {
  POLICY_STATUS,
  CHANNELS,
  startApplication,
  getApplicationState,
  setPremiumPayer,
  setMainMember,
  setSpouse,
  syncChildren,
  syncExtendedFamily,
  setBeneficiary,
  setPaymentMethod,
  calculatePremium,
  captureAcceptance,
  validateApplication,
  submitApplication,
  issuePolicy,
  applyPolicyAction,
  listPolicies,
  listProducts,
  productVersionRules,
};
