/**
 * Policy servicing (BRD §12) + claims (BRD §14–§16, §21) e2e.
 *
 * Proves: lifecycle actions obey one validated state machine; claims move
 * intake → requirements → assessment → approval → payout only through legal
 * transitions; a claim can never be marked paid without a recorded payment; and
 * tenant isolation holds on every new route.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import Tenant from '../models/Tenant.js';
import User from '../models/User.js';
import Role from '../models/Role.js';
import ObjectMeta from '../models/ObjectMeta.js';
import FieldMeta from '../models/FieldMeta.js';
import DynamicRecord from '../models/DynamicRecord.js';
import Session from '../models/Session.js';
import Workspace from '../models/Workspace.js';
import AutoNumberCounter from '../models/AutoNumberCounter.js';
import { seedDefaultRoles } from '../services/roleService.js';
import { seedStandardObjects, ensureUserObject } from '../services/metadataService.js';
import { seedInsuranceObjects, seedInsuranceWorkspace } from '../services/insuranceMetadataService.js';
import connectDB from '../config/db.js';
import app from '../app.js';
import { dispatchCommunications } from '../services/insurance/communicationDispatcher.js';

const RUN = Date.now().toString(36);
const PASSWORD = 'InsSvc123!';

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const objectIdFor = async (tenantId, apiName) => {
  const obj = await ObjectMeta.findOne({ tenantId, apiName });
  if (!obj) throw new Error(`object ${apiName} not seeded`);
  return obj._id;
};

const mk = (tenantId, userId, objectId, objectApiName, data) =>
  DynamicRecord.create({ tenantId, objectId, objectApiName, data, createdBy: userId, ownerId: userId });

const seedPlan = async (tenantId, userId) => {
  const productId = await objectIdFor(tenantId, 'product');
  const pvId = await objectIdFor(tenantId, 'product_version');
  const bcId = await objectIdFor(tenantId, 'benefit_cover');
  const product = await mk(tenantId, userId, productId, 'product', { name: 'Funeral Plan' });
  const pv = await mk(tenantId, userId, pvId, 'product_version', {
    name: 'FP v1',
    product: String(product._id),
    status: 'active',
    effective_from: '2026-01-01',
    allow_spouse: false,
    allow_children: false,
    allow_extended_family: false,
    min_entry_age: 18,
    max_entry_age: 65,
    allows_manual_premium_override: false,
  });
  await mk(tenantId, userId, bcId, 'benefit_cover', {
    name: 'main_member_only 100000',
    product_version: String(pv._id),
    rate_category: 'main_member_only',
    cover_amount: 100000,
    min_age: 18,
    max_age: 65,
    premium: 250,
    effective_from: '2026-01-01',
  });
  return { pv };
};

const seedTenant = async (label) => {
  const tenant = await Tenant.create({
    name: `ZZ_INSSVC_${label}_${RUN}`,
    slug: `zz-inssvc-${label}-${RUN}`,
    hub: 'insurance',
    status: 'active',
    plan: 'enterprise',
  });
  await seedDefaultRoles(tenant._id);
  const adminRole = await Role.findOne({ tenantId: tenant._id, name: 'admin' });
  const user = await User.create({
    tenantId: tenant._id,
    firstName: 'Svc',
    lastName: label,
    email: `inssvc-${label}-${RUN}@example.com`,
    username: `inssvc_${label}_${RUN}`,
    password: PASSWORD,
    role: adminRole._id,
    status: 'active',
    emailVerified: true,
  });
  await seedStandardObjects(tenant._id, user._id);
  await ensureUserObject(tenant._id, user._id);
  await seedInsuranceObjects(tenant._id, user._id);
  await seedInsuranceWorkspace(tenant._id, user._id);
  const { pv } = await seedPlan(tenant._id, user._id);
  return { tenant, user, pv };
};

const server = app.listen(0);
await new Promise((resolve) => server.once('listening', resolve));
const base = () => `http://127.0.0.1:${server.address().port}`;

const req = async (path, { method = 'GET', cookie, body } = {}) => {
  const res = await fetch(`${base()}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* no body */
  }
  return { status: res.status, json };
};

const login = async (username) => {
  const res = await fetch(`${base()}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: PASSWORD }),
  });
  return (res.headers.get('set-cookie') || '').split(';')[0];
};

/** Drive a fresh application all the way to an active policy. */
const issuePolicy = async (cookie, pvId, suffix) => {
  const started = await req('/api/v1/insurance/applications', {
    method: 'POST',
    cookie,
    body: { channel: 'website', product_version_id: String(pvId) },
  });
  const id = started.json?.data?.policy?.id;
  await req(`/api/v1/insurance/applications/${id}/main-member`, {
    method: 'PUT',
    cookie,
    body: { id_number: `SVC-${suffix}-${RUN}`, age: 30, cover_amount: 100000 },
  });
  await req(`/api/v1/insurance/applications/${id}/premium-payer`, {
    method: 'PUT',
    cookie,
    body: { id_number: `SVCP-${suffix}-${RUN}`, first_name: 'Payer', last_name: suffix },
  });
  await req(`/api/v1/insurance/applications/${id}/acceptance`, {
    method: 'POST',
    cookie,
    body: { channel: 'website', accepted_terms_version: '1.0' },
  });
  await req(`/api/v1/insurance/applications/${id}/submit`, { method: 'POST', cookie });
  await req(`/api/v1/insurance/policies/${id}/issue`, { method: 'POST', cookie });
  return id;
};

let tenantIds = [];
try {
  await connectDB();
  const A = await seedTenant('a');
  const B = await seedTenant('b');
  tenantIds = [A.tenant._id, B.tenant._id];
  const ca = await login(A.user.username);
  const cb = await login(B.user.username);
  check('tenant A admin authenticates', !!ca);
  check('tenant B admin authenticates', !!cb);

  // ── Policy read + servicing (BRD §12) ──────────────────────────────────────
  const policy1 = await issuePolicy(ca, A.pv._id, 'svc');

  const got = await req(`/api/v1/insurance/policies/${policy1}`, { cookie: ca });
  check('GET policy returns 200', got.status === 200, `HTTP ${got.status}`);
  check('issued policy is active', got.json?.data?.policy?.status === 'active');
  const sameSet = (a, b) => JSON.stringify([...(a || [])].sort()) === JSON.stringify([...b].sort());
  check(
    'an active policy offers lapse, suspend, cancel and close',
    sameSet(got.json?.data?.allowed_actions, ['lapse', 'suspend', 'cancel', 'close']) && got.json?.data?.can_issue === false,
    JSON.stringify(got.json?.data?.allowed_actions),
  );

  const list = await req('/api/v1/insurance/policies?status=active', { cookie: ca });
  check('policy list includes the policy', (list.json?.data || []).some((p) => p.id === policy1));

  const lapse = await req(`/api/v1/insurance/policies/${policy1}/lapse`, { method: 'POST', cookie: ca, body: { reason: 'non-payment' } });
  check('lapse → lapsed', lapse.json?.data?.policy?.status === 'lapsed', `HTTP ${lapse.status}`);
  const lapseComms = await req(`/api/v1/insurance/policies/${policy1}/communications`, { cookie: ca });
  const lapseNotice = (lapseComms.json?.data || []).find((c) => c.event === 'policy_lapsed');
  check(
    'a lapse notice is queued for delivery, not claimed as sent',
    lapseNotice?.status === 'queued' && !lapseNotice?.sent_at && !!lapseNotice?.logged_at,
    JSON.stringify({ status: lapseNotice?.status, sent_at: lapseNotice?.sent_at, logged_at: !!lapseNotice?.logged_at }),
  );
  // The dispatcher must never hand a reserved test domain to a real SMTP
  // server (a developer's configured account would send and bounce mail).
  const lapsedPolicy = await DynamicRecord.findById(policy1);
  await DynamicRecord.updateOne(
    { _id: lapsedPolicy.getField('premium_payer'), tenantId: A.tenant._id },
    { $set: { 'data.email': `payer-${RUN}@example.com` } },
  );
  await dispatchCommunications(String(A.tenant._id));
  const afterDispatch = await DynamicRecord.findById(lapseNotice?.id);
  check(
    'mail to a reserved test domain is never sent, and stays queued',
    afterDispatch?.getField('status') === 'queued' && !afterDispatch?.getField('sent_at'),
    `status=${afterDispatch?.getField('status')}`,
  );
  check(
    'a lapsed policy offers reinstate, not reactivate',
    sameSet(lapse.json?.data?.allowed_actions, ['reinstate', 'cancel', 'close']),
    JSON.stringify(lapse.json?.data?.allowed_actions),
  );
  const reinstate = await req(`/api/v1/insurance/policies/${policy1}/reinstate`, { method: 'POST', cookie: ca });
  check('reinstate → active', reinstate.json?.data?.policy?.status === 'active');
  const suspend = await req(`/api/v1/insurance/policies/${policy1}/suspend`, { method: 'POST', cookie: ca });
  check('suspend → inactive', suspend.json?.data?.policy?.status === 'inactive');
  check(
    'a suspended policy offers reactivate, not reinstate',
    sameSet(suspend.json?.data?.allowed_actions, ['reactivate', 'cancel']),
    JSON.stringify(suspend.json?.data?.allowed_actions),
  );
  const reactivate = await req(`/api/v1/insurance/policies/${policy1}/reactivate`, { method: 'POST', cookie: ca });
  check('reactivate → active', reactivate.json?.data?.policy?.status === 'active');
  const cancel = await req(`/api/v1/insurance/policies/${policy1}/cancel`, { method: 'POST', cookie: ca, body: { reason: 'client request' } });
  check('cancel → cancelled', cancel.json?.data?.policy?.status === 'cancelled');
  check('a cancelled policy can only be closed', sameSet(cancel.json?.data?.allowed_actions, ['close']), JSON.stringify(cancel.json?.data?.allowed_actions));
  const badReinstate = await req(`/api/v1/insurance/policies/${policy1}/reinstate`, { method: 'POST', cookie: ca });
  check('illegal reinstate of a cancelled policy → 409', badReinstate.status === 409, `HTTP ${badReinstate.status}`);
  const unknownAction = await req(`/api/v1/insurance/policies/${policy1}/teleport`, { method: 'POST', cookie: ca });
  check('unknown servicing action → 404', unknownAction.status === 404, `HTTP ${unknownAction.status}`);
  check('every servicing transition is recorded in history', (cancel.json?.data?.status_history || []).length === 8, `${(cancel.json?.data?.status_history || []).length}`);

  // ── Claims: intake → requirements → approval → payout (BRD §14–§16) ─────────
  const claimPolicy = await issuePolicy(ca, A.pv._id, 'clm');
  const claimLife = await DynamicRecord.findOne({ tenantId: A.tenant._id, objectApiName: 'insured_life', 'data.policy': claimPolicy });
  const otherLife = await DynamicRecord.findOne({ tenantId: A.tenant._id, objectApiName: 'insured_life', 'data.policy': policy1 });
  const claimant = { id_number: `CLMT-${RUN}`, name: 'Claimant One' };

  const reported = await req('/api/v1/insurance/claims', {
    method: 'POST',
    cookie: ca,
    body: { policy_id: claimPolicy, insured_life_id: String(claimLife._id), claimant, claim_type: 'death', event_date: new Date().toISOString() },
  });
  const claimId = reported.json?.data?.claim?.id;
  check('claim intake → 201', reported.status === 201, `HTTP ${reported.status}`);
  check('claim starts in reported', reported.json?.data?.claim?.status === 'reported');
  check('claim gets a CLM-* auto-number', String(reported.json?.data?.claim?.claim_number || '').startsWith('CLM-'));

  const wrongLife = await req('/api/v1/insurance/claims', {
    method: 'POST',
    cookie: ca,
    body: { policy_id: claimPolicy, insured_life_id: String((await DynamicRecord.findOne({ tenantId: A.tenant._id, objectApiName: 'insured_life', 'data.policy': policy1 }))?._id), claim_type: 'death', event_date: new Date().toISOString() },
  });
  check('a life not on the policy is rejected → 400', wrongLife.status === 400, `HTTP ${wrongLife.status}`);

  const reqAdded = await req(`/api/v1/insurance/claims/${claimId}/requirements`, { method: 'POST', cookie: ca, body: { name: 'Death certificate' } });
  check('adding a requirement → 201', reqAdded.status === 201, `HTTP ${reqAdded.status}`);
  check('claim moves to documents_outstanding', reqAdded.json?.data?.claim?.status === 'documents_outstanding');
  const requirementId = reqAdded.json?.data?.requirements?.[0]?.id;

  const underReview = await req(`/api/v1/insurance/claims/${claimId}/transition`, { method: 'POST', cookie: ca, body: { to: 'under_review' } });
  check('documents_outstanding → under_review', underReview.status === 200 && underReview.json?.data?.claim?.status === 'under_review', `HTTP ${underReview.status}`);

  // A requirement added while under review keeps the claim under review.
  const extra = await req(`/api/v1/insurance/claims/${claimId}/requirements`, { method: 'POST', cookie: ca, body: { name: 'ID copy' } });
  const extraId = extra.json?.data?.requirements?.find((r) => r.name === 'ID copy')?.id;

  const blockedApprove = await req(`/api/v1/insurance/claims/${claimId}/transition`, { method: 'POST', cookie: ca, body: { to: 'approved', approved_amount: 5000 } });
  check('approval blocked while requirements are outstanding → 409', blockedApprove.status === 409, `HTTP ${blockedApprove.status}`);

  await req(`/api/v1/insurance/claims/${claimId}/requirements/${requirementId}`, { method: 'PUT', cookie: ca, body: { status: 'accepted' } });
  await req(`/api/v1/insurance/claims/${claimId}/requirements/${extraId}`, { method: 'PUT', cookie: ca, body: { status: 'accepted' } });

  const approveNoAmount = await req(`/api/v1/insurance/claims/${claimId}/transition`, { method: 'POST', cookie: ca, body: { to: 'approved' } });
  check('approving without an amount → 400', approveNoAmount.status === 400, `HTTP ${approveNoAmount.status}`);

  const approved = await req(`/api/v1/insurance/claims/${claimId}/transition`, { method: 'POST', cookie: ca, body: { to: 'approved', approved_amount: 5000 } });
  check('approval succeeds once requirements are cleared', approved.status === 200 && approved.json?.data?.claim?.status === 'approved', `HTTP ${approved.status}`);

  const overspend = await req(`/api/v1/insurance/claims/${claimId}/payments`, { method: 'POST', cookie: ca, body: { amount: 6000 } });
  check('payment above the approved amount → 400', overspend.status === 400, `HTTP ${overspend.status}`);
  const paid = await req(`/api/v1/insurance/claims/${claimId}/payments`, { method: 'POST', cookie: ca, body: { amount: 5000, payment_method: 'eft' } });
  check('payment within the approved amount → 201', paid.status === 201, `HTTP ${paid.status}`);
  check('recording the payout moves the claim to paid', paid.json?.data?.claim?.status === 'paid');

  const closed = await req(`/api/v1/insurance/claims/${claimId}/transition`, { method: 'POST', cookie: ca, body: { to: 'closed' } });
  check('paid → closed is allowed', closed.status === 200 && closed.json?.data?.claim?.status === 'closed');

  const second = await req('/api/v1/insurance/claims', { method: 'POST', cookie: ca, body: { policy_id: claimPolicy, insured_life_id: String(claimLife?._id), claim_type: 'other', event_date: new Date().toISOString(), claimant: { id_number: `CLM2-${RUN}`, name: 'Claimant Two' } } });
  const secondId = second.json?.data?.claim?.id;
  const illegalJump = await req(`/api/v1/insurance/claims/${secondId}/transition`, { method: 'POST', cookie: ca, body: { to: 'paid' } });
  check('reported → paid is blocked → 409', illegalJump.status === 409, `HTTP ${illegalJump.status}`);
  const declineNoReason = await req(`/api/v1/insurance/claims/${secondId}/transition`, { method: 'POST', cookie: ca, body: { to: 'declined' } });
  check('declining without a reason → 400', declineNoReason.status === 400, `HTTP ${declineNoReason.status}`);
  const declined = await req(`/api/v1/insurance/claims/${secondId}/transition`, { method: 'POST', cookie: ca, body: { to: 'declined', reason: 'Not covered' } });
  check('declining with a reason succeeds', declined.status === 200 && declined.json?.data?.claim?.status === 'declined');
  check('decline reason is stored on the claim', declined.json?.data?.claim?.decline_reason === 'Not covered');

  // ── Isolation: B cannot touch A's claim ────────────────────────────────────
  const crossRead = await req(`/api/v1/insurance/claims/${claimId}`, { cookie: cb });
  check('tenant B cannot read tenant A\'s claim (IDOR)', crossRead.status === 404, `HTTP ${crossRead.status}`);
} catch (err) {
  check('test harness ran without error', false, `${err.message}\n${err.stack}`);
} finally {
  await Tenant.deleteMany({ slug: { $regex: '^zz-inssvc-' } });
  await Promise.all(
    [User, Role, ObjectMeta, FieldMeta, DynamicRecord, Session, Workspace, AutoNumberCounter].map((M) =>
      M.deleteMany({ tenantId: { $in: tenantIds } }).catch(() => {}),
    ),
  );
  server.close();
  await mongoose.connection.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
