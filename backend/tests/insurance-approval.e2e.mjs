/**
 * Policy approval before issue (BRD §11.2) e2e.
 *
 * Proves: a Product Version with `requires_approval=true` blocks `issuePolicy`
 * until an approval record is created on submit and explicitly approved; a
 * rejected approval keeps the policy in SUBMITTED; straight-through (no flag)
 * still works; tenant isolation holds.
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

const RUN = Date.now().toString(36);
const PASSWORD = 'Aprv123!';

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

const seedPlan = async (tenantId, userId, { requiresApproval } = {}) => {
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
    requires_approval: requiresApproval ?? false,
  });
  await mk(tenantId, userId, bcId, 'benefit_cover', {
    name: 'main only 100k',
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
    name: `ZZ_INSAPR_${label}_${RUN}`,
    slug: `zz-insapr-${label}-${RUN}`,
    hub: 'insurance',
    status: 'active',
    plan: 'enterprise',
  });
  await seedDefaultRoles(tenant._id);
  const adminRole = await Role.findOne({ tenantId: tenant._id, name: 'admin' });
  const user = await User.create({
    tenantId: tenant._id,
    firstName: 'Aprv',
    lastName: label,
    email: `insapr-${label}-${RUN}@example.com`,
    username: `insapr_${label}_${RUN}`,
    password: PASSWORD,
    role: adminRole._id,
    status: 'active',
    emailVerified: true,
  });
  await seedStandardObjects(tenant._id, user._id);
  await ensureUserObject(tenant._id, user._id);
  await seedInsuranceObjects(tenant._id, user._id);
  await seedInsuranceWorkspace(tenant._id, user._id);
  const { pv } = await seedPlan(tenant._id, user._id, { requiresApproval: label === 'a' });
  return { tenant, user, pv };
};

let server;
let tenantIds = [];

const main = async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://localhost:${server.address().port}`;

  const req = async (path, { method = 'GET', cookie, body } = {}) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    let json = null;
    try { json = await res.json(); } catch { /* no body */ }
    return { status: res.status, json };
  };

  const login = async (username) => {
    const res = await fetch(`${base}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: PASSWORD }),
    });
    return (res.headers.get('set-cookie') || '').split(';')[0];
  };

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
      body: { id_number: `APRV-${suffix}-${RUN}`, age: 30, cover_amount: 100000 },
    });
    await req(`/api/v1/insurance/applications/${id}/premium-payer`, {
      method: 'PUT',
      cookie,
      body: { id_number: `PAY-${suffix}-${RUN}`, name: 'Premium Payer' },
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

  const submitOnly = async (cookie, pvId, suffix) => {
    const started = await req('/api/v1/insurance/applications', {
      method: 'POST',
      cookie,
      body: { channel: 'website', product_version_id: String(pvId) },
    });
    const id = started.json?.data?.policy?.id;
    await req(`/api/v1/insurance/applications/${id}/main-member`, {
      method: 'PUT',
      cookie,
      body: { id_number: `APRV-${suffix}-${RUN}`, age: 30, cover_amount: 100000 },
    });
    await req(`/api/v1/insurance/applications/${id}/premium-payer`, {
      method: 'PUT',
      cookie,
      body: { id_number: `PAY-${suffix}-${RUN}`, name: 'Premium Payer' },
    });
    await req(`/api/v1/insurance/applications/${id}/acceptance`, {
      method: 'POST',
      cookie,
      body: { channel: 'website', accepted_terms_version: '1.0' },
    });
    const submitted = await req(`/api/v1/insurance/applications/${id}/submit`, { method: 'POST', cookie });
    return { policyId: id, submitRes: submitted };
  };

  try {
    // Tenant A: product requires approval. Tenant B: straight-through.
    const A = await seedTenant('a');
    const B = await seedTenant('b');
    tenantIds = [A.tenant._id, B.tenant._id];
    // Login accepts only email-format identifiers, so the suite signs in by email.
    const ca = await login(A.user.email);
    const cb = await login(B.user.email);
    check('tenant A admin authenticates', !!ca);
    check('tenant B admin authenticates', !!cb);

    // ── Tenant A: requires approval ──
    // Submit (should create approval record, stay in SUBMITTED)
    const { policyId: policyA, submitRes: subA } = await submitOnly(ca, A.pv._id, 'e1');
    check('tenant A submit → 200', subA.status === 200, `HTTP ${subA.status}`);
    check('tenant A status is application_submitted', subA.json?.data?.policy?.status === 'application_submitted', `${subA.json?.data?.policy?.status}`);

    // Approval record created
    const approvalsA = await req(`/api/v1/insurance/policies/${policyA}/approvals`, { cookie: ca });
    check('approval record exists for tenant A', (approvalsA.json?.data || []).length === 1, `${(approvalsA.json?.data || []).length}`);
    const approvalId = approvalsA.json?.data?.[0]?.id;
    check('approval status is pending', approvalsA.json?.data?.[0]?.status === 'pending');
    check('approval has auto-number APR-', String(approvalsA.json?.data?.[0]?.name || '').startsWith('APR-'));

    // Issue before approval → 409
    const issueBlocked = await req(`/api/v1/insurance/policies/${policyA}/issue`, { method: 'POST', cookie: ca });
    check('issue blocked without approval → 409', issueBlocked.status === 409, `HTTP ${issueBlocked.status}`);

    // Reject approval
    const rejectNoReason = await req(`/api/v1/insurance/approvals/${approvalId}/reject`, { method: 'POST', cookie: ca });
    check('reject without reason → 400', rejectNoReason.status === 400, `HTTP ${rejectNoReason.status}`);
    const rejected = await req(`/api/v1/insurance/approvals/${approvalId}/reject`, { method: 'POST', cookie: ca, body: { reason: 'Underwriting declined' } });
    check('reject with reason → rejected', rejected.json?.data?.[0]?.status === 'rejected');

    // Issue after rejection → still 409
    const issueAfterReject = await req(`/api/v1/insurance/policies/${policyA}/issue`, { method: 'POST', cookie: ca });
    check('issue still blocked after rejection → 409', issueAfterReject.status === 409, `HTTP ${issueAfterReject.status}`);

    // Submit again (new approval record created) → approve → issue
    const { policyId: policyA2, submitRes: subA2 } = await submitOnly(ca, A.pv._id, 'e2');
    const approvalsA2 = await req(`/api/v1/insurance/policies/${policyA2}/approvals`, { cookie: ca });
    const approvalId2 = approvalsA2.json?.data?.[0]?.id;
    await req(`/api/v1/insurance/approvals/${approvalId2}/approve`, { method: 'POST', cookie: ca });
    const issueA = await req(`/api/v1/insurance/policies/${policyA2}/issue`, { method: 'POST', cookie: ca });
    check('approve → issue succeeds', issueA.status === 200 && issueA.json?.data?.policy?.status === 'active', `HTTP ${issueA.status}`);

    // ── Tenant B: straight-through (no approval flag) ──
    const policyB = await issuePolicy(cb, B.pv._id, 'e3');
    check('tenant B straight-through issue → active', policyB !== undefined);

    // No approval record for B
    const approvalsB = await req(`/api/v1/insurance/policies/${policyB}/approvals`, { cookie: cb });
    check('no approval record for straight-through product', (approvalsB.json?.data || []).length === 0);

    // ── Isolation: B cannot touch A's approval ──
    const crossRead = await req(`/api/v1/insurance/approvals/${approvalId}`, { cookie: cb });
    check("tenant B cannot read tenant A's approval (IDOR)", crossRead.status === 404, `HTTP ${crossRead.status}`);
    const crossList = await req(`/api/v1/insurance/policies/${policyA}/approvals`, { cookie: cb });
    check("tenant B sees no approvals for tenant A's policy", (crossList.json?.data || []).length === 0);
  } catch (err) {
    check('test harness ran without error', false, `${err.message}\n${err.stack}`);
  }
};

await connectDB();
await main();
server?.close();
await Tenant.deleteMany({ slug: { $regex: '^zz-insapr-' } });
await Promise.all(
  [User, Role, ObjectMeta, FieldMeta, DynamicRecord, Session, Workspace, AutoNumberCounter].map((M) =>
    M.deleteMany({ tenantId: { $in: tenantIds } }).catch(() => {}),
  ),
);
await mongoose.connection.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);