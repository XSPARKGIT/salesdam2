/**
 * insurance-application.e2e.mjs — end-to-end test of the Insurance business API
 * (/api/v1/insurance): start → capture → price → accept → validate → submit →
 * issue, plus tenant isolation, idempotency and no-silent-default config errors.
 *
 * Run: node tests/insurance-application.e2e.mjs   (from backend/)
 * Exits non-zero if any check fails.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import app from '../app.js';
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
import { runBillingCycle } from '../services/insurance/billingRunService.js';

const RUN = Date.now().toString(36);
const PASSWORD = 'InsApp123!';

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
  const crId = await objectIdFor(tenantId, 'child_benefit_rule');

  const product = await mk(tenantId, userId, productId, 'product', { name: 'Funeral Plan' });
  const pv = await mk(tenantId, userId, pvId, 'product_version', {
    name: 'FP v1',
    product: String(product._id),
    status: 'active',
    effective_from: '2026-01-01',
    allow_spouse: true,
    allow_children: true,
    allow_extended_family: true,
    max_spouses: 1,
    max_children: 5,
    max_extended_family: 3,
    min_entry_age: 18,
    max_entry_age: 65,
    allows_manual_premium_override: false,
  });

  const cover = (rate_category, cover_amount, premium) =>
    mk(tenantId, userId, bcId, 'benefit_cover', {
      name: `${rate_category} ${cover_amount}`,
      product_version: String(pv._id),
      rate_category,
      cover_amount,
      min_age: 18,
      max_age: 65,
      premium,
      underwriter_rate: Math.round(premium * 0.8),
      markup: Math.round(premium * 0.2),
      waiting_period_months: 6,
      effective_from: '2026-01-01',
    });
  await cover('main_member_only', 100000, 250);
  await cover('main_member_spouse', 100000, 300);
  await cover('main_member_children', 100000, 350);
  await cover('main_member_spouse_children', 100000, 420);
  await cover('extended_family', 50000, 150);

  await mk(tenantId, userId, crId, 'child_benefit_rule', {
    name: 'Child 0-21',
    product_version: String(pv._id),
    min_age: 0,
    max_age: 21,
    percent_of_main_cover: 50,
    max_child_cover: 20000,
    effective_from: '2026-01-01',
  });

  return { product, pv };
};

const seedTenant = async (label, hub) => {
  const tenant = await Tenant.create({
    name: `ZZ_INSA_${label}_${RUN}`,
    slug: `zz-insa-${label}-${RUN}`,
    hub,
    status: 'active',
    plan: 'enterprise',
  });
  await seedDefaultRoles(tenant._id);
  const adminRole = await Role.findOne({ tenantId: tenant._id, name: 'admin' });
  const user = await User.create({
    tenantId: tenant._id,
    firstName: 'Ins',
    lastName: label,
    email: `insa-${label}-${RUN}@example.com`,
    username: `insa_${label}_${RUN}`,
    password: PASSWORD,
    role: adminRole._id,
    status: 'active',
    emailVerified: true,
  });
  await seedStandardObjects(tenant._id, user._id);
  await ensureUserObject(tenant._id, user._id);
  await seedInsuranceObjects(tenant._id, user._id);
  await seedInsuranceWorkspace(tenant._id, user._id);
  const plan = await seedPlan(tenant._id, user._id);
  return { tenant, user, adminRole, ...plan };
};

const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;

const req = async (path, { method = 'GET', cookie, headers = {}, body } = {}) => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json, text: JSON.stringify(json ?? '') };
};

const loginCookie = async (username) => {
  const res = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: PASSWORD }),
  });
  const setCookie = res.headers.getSetCookie?.() || [];
  const sid = setCookie.map((c) => c.split(';')[0]).find((c) => c.startsWith('crm.sid='));
  return sid;
};

let tenantIds = [];
try {
  await connectDB();
  const A = await seedTenant('a', 'insurance');
  const B = await seedTenant('b', 'insurance');
  tenantIds = [A.tenant._id, B.tenant._id];

  const ca = await loginCookie(A.user.username);
  const cb = await loginCookie(B.user.username);
  check('tenant A admin authenticates', !!ca);
  check('tenant B admin authenticates', !!cb);

  // ── Start an application (idempotent) ──────────────────────────────────────
  const startBody = { channel: 'website', product_version_id: String(A.pv._id) };
  const started = await req('/api/v1/insurance/applications', {
    method: 'POST', cookie: ca, body: startBody, headers: { 'Idempotency-Key': `k-${RUN}` },
  });
  check('start application returns 201', started.status === 201, `HTTP ${started.status}`);
  const appId = started.json?.data?.policy?.id;
  check('application has an id', !!appId);
  check('application starts in application_started', started.json?.data?.policy?.status === 'application_started');
  check('policy number assigned by auto-number', /^POL-\d+$/.test(started.json?.data?.policy?.policy_number || ''), started.json?.data?.policy?.policy_number);

  const retried = await req('/api/v1/insurance/applications', {
    method: 'POST', cookie: ca, body: startBody, headers: { 'Idempotency-Key': `k-${RUN}` },
  });
  check('retried start is idempotent (same application)', retried.json?.data?.policy?.id === appId, `${retried.status}`);

  // ── Capture parties / lives ────────────────────────────────────────────────
  const main = await req(`/api/v1/insurance/applications/${appId}/main-member`, {
    method: 'PUT', cookie: ca,
    body: { id_number: `IDM-${RUN}`, first_name: 'Main', last_name: 'Member', age: 30, cover_amount: 100000 },
  });
  check('capture main member', main.status === 200, `HTTP ${main.status}`);

  const payer = await req(`/api/v1/insurance/applications/${appId}/premium-payer`, {
    method: 'PUT', cookie: ca,
    body: { id_number: `IDP-${RUN}`, first_name: 'Premium', last_name: 'Payer', email: `payer-${RUN}@example.com` },
  });
  check('capture premium payer', payer.status === 200, `HTTP ${payer.status}`);

  // Identity matching: same ID number must reuse the client, not duplicate it.
  await req(`/api/v1/insurance/applications/${appId}/main-member`, {
    method: 'PUT', cookie: ca,
    body: { id_number: `IDM-${RUN}`, first_name: 'Main', last_name: 'Member', age: 30, cover_amount: 100000 },
  });
  const mainClients = await DynamicRecord.countDocuments({
    tenantId: A.tenant._id, objectApiName: 'client', 'data.id_number': `IDM-${RUN}`,
  });
  check('identity matching reuses the client by ID number', mainClients === 1, `${mainClients}`);

  // ── Price ──────────────────────────────────────────────────────────────────
  const priced = await req(`/api/v1/insurance/applications/${appId}/premium`, { method: 'POST', cookie: ca });
  check('premium endpoint returns 200', priced.status === 200, `HTTP ${priced.status}`);
  check('main-member-only premium is R250', priced.json?.data?.totals?.premium === 250, `${priced.json?.data?.totals?.premium}`);
  check('rate category is main_member_only', priced.json?.data?.rate_category === 'main_member_only');

  // ── Acceptance is mandatory before submit ──────────────────────────────────
  const preValidate = await req(`/api/v1/insurance/applications/${appId}/validate`, { method: 'POST', cookie: ca });
  check('validation fails before acceptance', preValidate.json?.data?.valid === false);
  check('validation names the missing acceptance', (preValidate.json?.data?.errors || []).some((e) => e.field === 'acceptance'));

  const branchNoSig = await req(`/api/v1/insurance/applications/${appId}/acceptance`, {
    method: 'POST', cookie: ca, body: { channel: 'branch', accepted_terms_version: '1.0' },
  });
  check('branch acceptance without signature is rejected', branchNoSig.status === 400, `HTTP ${branchNoSig.status}`);
  check('branch acceptance error is field-specific', !!branchNoSig.json?.fieldErrors?.signature_reference);

  const accept = await req(`/api/v1/insurance/applications/${appId}/acceptance`, {
    method: 'POST', cookie: ca, body: { channel: 'website', accepted_terms_version: '1.0' },
  });
  check('website acceptance captured', accept.status === 201, `HTTP ${accept.status}`);

  const postValidate = await req(`/api/v1/insurance/applications/${appId}/validate`, { method: 'POST', cookie: ca });
  check('validation passes after acceptance', postValidate.status === 200 && postValidate.json?.data?.valid === true, JSON.stringify(postValidate.json?.data?.errors || []));

  // ── Submit & issue ─────────────────────────────────────────────────────────
  const submitted = await req(`/api/v1/insurance/applications/${appId}/submit`, { method: 'POST', cookie: ca });
  check('submit returns 200', submitted.status === 200, `HTTP ${submitted.status}`);
  check('status becomes application_submitted', submitted.json?.data?.policy?.status === 'application_submitted');
  check('current premium persisted on submit', submitted.json?.data?.policy?.current_premium === 250);

  const issued = await req(`/api/v1/insurance/policies/${appId}/issue`, { method: 'POST', cookie: ca });
  check('issue returns 200', issued.status === 200, `HTTP ${issued.status}`);
  check('policy becomes active', issued.json?.data?.policy?.status === 'active');
  check('status history records every transition', (issued.json?.data?.status_history || []).length === 3, `${(issued.json?.data?.status_history || []).length}`);

  // ── Issue sets the policy up for billing ───────────────────────────────────
  const today = new Date().toISOString().slice(0, 10);
  const issuedPolicy = issued.json?.data?.policy || {};
  check('issue sets the first premium due on the issue date', issuedPolicy.next_billing_date === today, `next=${issuedPolicy.next_billing_date}`);
  check('issue sets monthly billing', issuedPolicy.billing_frequency === 'monthly', `freq=${issuedPolicy.billing_frequency}`);
  check('nothing is paid through yet', !issuedPolicy.paid_through_date, `paid=${issuedPolicy.paid_through_date}`);
  const premiumAccount = issuedPolicy.account
    ? await DynamicRecord.findOne({ _id: issuedPolicy.account, tenantId: A.tenant._id, objectApiName: 'account' })
    : null;
  check(
    'issue links a premium account for the payer',
    !!premiumAccount && String(premiumAccount.getField('account_number') || '').startsWith('PA-'),
    `account=${issuedPolicy.account} number=${premiumAccount?.getField('account_number')}`,
  );

  const billing = await runBillingCycle(String(A.tenant._id), String(A.user._id));
  const billedThis = (billing.results || []).find((r) => r.policyId === appId);
  check('the billing run bills the newly issued policy', billedThis?.created === true, JSON.stringify(billedThis || billing));
  const debit = await DynamicRecord.findOne({
    tenantId: A.tenant._id, objectApiName: 'premium_transaction', 'data.policy': appId, isDeleted: false,
  });
  check(
    'the first debit is for this month at the quoted premium',
    debit?.getField('billing_period') === today.slice(0, 7) && Number(debit?.getField('amount')) === 250,
    `period=${debit?.getField('billing_period')} amount=${debit?.getField('amount')}`,
  );
  const afterBilling = await DynamicRecord.findById(appId);
  const nextMonth = new Date(`${today}T00:00:00Z`);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  check(
    'next billing date moves on a month after billing',
    afterBilling.getField('next_billing_date') === nextMonth.toISOString().slice(0, 10),
    `next=${afterBilling.getField('next_billing_date')}`,
  );

  // ── Config errors must be explicit, never a silent default ─────────────────
  const badStart = await req('/api/v1/insurance/applications', { method: 'POST', cookie: ca, body: startBody });
  const badAppId = badStart.json?.data?.policy?.id;
  await req(`/api/v1/insurance/applications/${badAppId}/main-member`, {
    method: 'PUT', cookie: ca, body: { id_number: `IDX-${RUN}`, age: 30, cover_amount: 999999 },
  });
  const noRate = await req(`/api/v1/insurance/applications/${badAppId}/premium`, { method: 'POST', cookie: ca });
  check('missing rate returns 422 (no silent default)', noRate.status === 422, `HTTP ${noRate.status}`);

  // ── Spouse + children category and derived child cover ─────────────────────
  const famStart = await req('/api/v1/insurance/applications', { method: 'POST', cookie: ca, body: startBody });
  const famId = famStart.json?.data?.policy?.id;
  await req(`/api/v1/insurance/applications/${famId}/main-member`, {
    method: 'PUT', cookie: ca, body: { id_number: `IDF-${RUN}`, age: 35, cover_amount: 100000 },
  });
  await req(`/api/v1/insurance/applications/${famId}/spouse`, {
    method: 'PUT', cookie: ca, body: { id_number: `IDS-${RUN}`, age: 33 },
  });
  await req(`/api/v1/insurance/applications/${famId}/children`, {
    method: 'PUT', cookie: ca,
    body: { children: [{ id_number: `IDC1-${RUN}`, age: 5 }, { id_number: `IDC2-${RUN}`, age: 8 }] },
  });
  const famPrice = await req(`/api/v1/insurance/applications/${famId}/premium`, { method: 'POST', cookie: ca });
  check('family uses spouse+children rate category', famPrice.json?.data?.rate_category === 'main_member_spouse_children', `${famPrice.json?.data?.rate_category}`);
  check('family premium is R420', famPrice.json?.data?.totals?.premium === 420, `${famPrice.json?.data?.totals?.premium}`);
  check('child cover capped at R20000', (famPrice.json?.data?.children || []).every((c) => c.cover_amount === 20000), JSON.stringify(famPrice.json?.data?.children || []));

  // ── Isolation: B cannot touch A's application ──────────────────────────────
  const crossRead = await req(`/api/v1/insurance/applications/${appId}`, { cookie: cb });
  check('B cannot read A application (IDOR)', crossRead.status === 404, `HTTP ${crossRead.status}`);
  const crossPrice = await req(`/api/v1/insurance/applications/${appId}/premium`, { method: 'POST', cookie: cb });
  check('B cannot price A application', crossPrice.status === 404, `HTTP ${crossPrice.status}`);

  // ── Workspace seeded ───────────────────────────────────────────────────────
  const ws = await Workspace.findOne({ tenantId: A.tenant._id, apiName: 'insurance' });
  check('Insurance workspace seeded', !!ws);
  check('workspace groups the insurance objects', (ws?.objectGroups || []).some((g) => g.name === 'Policies' && g.objectApiNames.includes('policy')));
} catch (err) {
  check('test harness ran without error', false, `${err.message}\n${err.stack}`);
} finally {
  await Tenant.deleteMany({ _id: { $in: tenantIds } });
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
