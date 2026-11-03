/**
 * validation-evaluation.e2e.mjs — BRD 6.2 Validation Rule evaluation.
 *
 * Boots the real Express app and verifies, through the API:
 *  - Timing: rules run on every create and update — records API, CSV import,
 *    flow steps and incoming webhooks — and never on delete
 *  - Multiple rules: every failing rule's message comes back together, two on
 *    the same field included
 *  - Cross-field: "Debit Order Day is required when Payment Method = Debit
 *    Order", and rules conditioned on the Type field
 *  - Tenant thresholds: CONFIG("deals.minimum_value") reads the tenant's own
 *    value, so the same rule blocks in one tenant and passes in another
 *
 * Run: node tests/validation-evaluation.e2e.mjs   (from backend/)
 * Exits non-zero if any check fails.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import app from '../app.js';
import Tenant from '../models/Tenant.js';
import User from '../models/User.js';
import Role from '../models/Role.js';
import Session from '../models/Session.js';
import ObjectMeta from '../models/ObjectMeta.js';
import FieldMeta from '../models/FieldMeta.js';
import DynamicRecord from '../models/DynamicRecord.js';
import Automation from '../models/Automation.js';
import TenantConfiguration from '../models/TenantConfiguration.js';
import IncomingWebhookLog from '../models/IncomingWebhookLog.js';
import AuditLog from '../models/AuditLog.js';
import Workspace from '../models/Workspace.js';
import { seedDefaultRoles } from '../services/roleService.js';
import { seedWorkspace } from './helpers/workspace.mjs';

const RUN = Date.now().toString(36);
const PASSWORD = 'EvalTest123!';

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;

const req = async (path, { method = 'GET', cookie, body, form } = {}) => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: form ? { ...(cookie ? { Cookie: cookie } : {}) } : { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: form || (body ? JSON.stringify(body) : undefined),
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
};

const loginCookie = async (username) => {
  const res = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: PASSWORD }),
  });
  const setCookie = res.headers.getSetCookie?.() || [];
  return setCookie.map((c) => c.split(';')[0]).find((c) => c.startsWith('crm.sid=')) || '';
};

const tenantIds = [];
const models = [User, Role, Session, ObjectMeta, FieldMeta, DynamicRecord, Automation, TenantConfiguration, IncomingWebhookLog, AuditLog, Workspace];

const RULES = [
  { name: 'Debit order day required', expression: 'payment_method == "debit_order" AND ISBLANK(debit_order_day)', errorMessage: 'Debit Order Day is required for debit orders.', errorField: 'debit_order_day', isActive: true },
  { name: 'Debit order day range', expression: 'payment_method == "debit_order" AND (debit_order_day < 1 OR debit_order_day > 28)', errorMessage: 'Debit Order Day must be between 1 and 28.', errorField: 'debit_order_day', isActive: true },
  { name: 'Group needs members', expression: 'type == "group" AND (ISBLANK(member_count) OR member_count < 2)', errorMessage: 'Group policies need at least 2 members.', errorField: 'member_count', isActive: true },
  { name: 'Minimum premium', expression: 'premium < CONFIG("deals.minimum_value")', errorMessage: 'Premium is below this company\'s minimum.', errorField: '', isActive: true },
  { name: 'Name required', expression: 'ISBLANK(name)', errorMessage: 'Name is required.', errorField: '', isActive: true },
];

// A tenant with an admin, a Policy object and the rules above.
const seedTenant = async (tag) => {
  const tenant = await Tenant.create({ name: `ZZ_VE_${tag}_${RUN}`, slug: `zz-ve-${tag}-${RUN}`, status: 'active', plan: 'enterprise' });
  tenantIds.push(tenant._id);
  const tenantId = tenant._id;
  await seedDefaultRoles(tenantId);
  const roleAdmin = await Role.findOne({ tenantId, name: 'admin' });
  const admin = await User.create({
    tenantId, firstName: 'Ve', lastName: tag, email: `ve-${tag}-${RUN}@example.com`,
    username: `ve_${tag}_${RUN}`, password: PASSWORD, role: roleAdmin._id, status: 'active', emailVerified: true,
  });
  await seedWorkspace(tenantId, [admin._id], ['policy']);
  const obj = await ObjectMeta.create({ tenantId, name: 'Policy', label: 'Policy', pluralLabel: 'Policies', apiName: 'policy', nameFieldApiName: 'name', isActive: true });
  const f = (apiName, label, type, extra = {}) => ({ tenantId, objectId: obj._id, objectApiName: 'policy', name: apiName, apiName, label, type, ...extra });
  const pick = (vals) => ({ picklistValues: vals.map((v) => ({ label: v, value: v, isActive: true })) });
  await FieldMeta.create([
    f('name', 'Name', 'text'),
    f('payment_method', 'Payment Method', 'picklist', pick(['cash', 'debit_order'])),
    f('debit_order_day', 'Debit Order Day', 'number'),
    f('type', 'Type', 'picklist', pick(['individual', 'group'])),
    f('member_count', 'Member Count', 'number'),
    f('premium', 'Premium', 'currency'),
  ]);
  const cookie = await loginCookie(admin.email);
  return { tenantId, admin, obj, cookie };
};

try {
  await connectDB();
  const A = await seedTenant('a');
  const B = await seedTenant('b');
  check('admins can log in', Boolean(A.cookie && B.cookie));

  let r = await req('/api/v1/objects/policy', { method: 'PUT', cookie: A.cookie, body: { validationRules: [...RULES, { name: 'Typo', expression: 'premium < CONFIG("deals.minimum_valu")', errorMessage: 'x', isActive: true }] } });
  check('a rule naming an unknown configuration key is rejected', r.status === 400 && /not a configuration setting/.test(r.json?.message || ''), r.json?.message);
  for (const t of [A, B]) {
    r = await req('/api/v1/objects/policy', { method: 'PUT', cookie: t.cookie, body: { validationRules: RULES } });
  }
  check('rules saved in both tenants', r.status === 200, `HTTP ${r.status}`);

  // ── Multiple rule handling + cross-field ─────────────────────────────────
  // Tenant A sets its minimum premium to 1000; tenant B keeps the default (0).
  r = await req('/api/v1/configuration/deals.minimum_value', { method: 'PUT', cookie: A.cookie, body: { value: 1000 } });
  check('a tenant admin sets their own minimum value', r.status === 200, `HTTP ${r.status} ${r.json?.message || ''}`);

  const create = (t, body) => req('/api/v1/records/policy', { method: 'POST', cookie: t.cookie, body });
  r = await create(A, { name: '', payment_method: 'debit_order', type: 'group', member_count: 1, premium: 50 });
  const issues = r.json?.issues || [];
  const msgs = issues.map((i) => i.message);
  check(
    'every failing rule is reported together, not just the first',
    r.status === 400 && issues.length === 5 && /5 problems/.test(r.json?.message || ''),
    `HTTP ${r.status} ${issues.length} issues: ${msgs.join(' | ')}`,
  );
  check(
    'two rules on the same field are both kept',
    /required for debit orders/.test(r.json?.fieldErrors?.debit_order_day || '') && /between 1 and 28/.test(r.json?.fieldErrors?.debit_order_day || ''),
    r.json?.fieldErrors?.debit_order_day,
  );
  check(
    'field rules are attached to their field, the rest to the top of the record',
    issues.filter((i) => i.errorField === '').map((i) => i.message).sort().join(' / ') === "Name is required. / Premium is below this company's minimum.",
    JSON.stringify(issues.map((i) => i.errorField)),
  );

  r = await create(A, { name: 'Cash cover', payment_method: 'cash', type: 'individual', premium: 1500 });
  const cashId = r.json?.data?._id || r.json?.data?.id;
  check('cross-field: no Debit Order Day needed when Payment Method is cash', r.status === 201, `HTTP ${r.status} ${r.json?.message || ''}`);

  r = await create(A, { name: 'Debit cover', payment_method: 'debit_order', debit_order_day: 15, type: 'individual', premium: 1500 });
  check('cross-field: a debit order with a valid day saves', r.status === 201, `HTTP ${r.status} ${r.json?.message || ''}`);

  // ── Tenant-configurable thresholds ───────────────────────────────────────
  r = await create(A, { name: 'Small A', payment_method: 'cash', type: 'individual', premium: 500 });
  check('tenant A (minimum 1000) blocks a premium of 500', r.status === 400 && /below this company/.test(r.json?.message || ''), `HTTP ${r.status} ${r.json?.message || ''}`);
  r = await create(B, { name: 'Small B', payment_method: 'cash', type: 'individual', premium: 500 });
  check('tenant B (platform default 0) accepts the same premium', r.status === 201, `HTTP ${r.status} ${r.json?.message || ''}`);

  await req('/api/v1/configuration/deals.minimum_value', { method: 'PUT', cookie: A.cookie, body: { value: 400 } });
  r = await create(A, { name: 'Small A again', payment_method: 'cash', type: 'individual', premium: 500 });
  check('changing the tenant value changes the rule without editing it', r.status === 201, `HTTP ${r.status} ${r.json?.message || ''}`);
  await req('/api/v1/configuration/deals.minimum_value', { method: 'PUT', cookie: A.cookie, body: { value: 1000 } });

  // ── Timing: update, delete ───────────────────────────────────────────────
  r = await req(`/api/v1/records/policy/${cashId}`, { method: 'PATCH', cookie: A.cookie, body: { payment_method: 'debit_order', type: 'group' } });
  check('rules run on update and report every problem', r.status === 400 && (r.json?.issues || []).length === 3, `HTTP ${r.status} ${(r.json?.issues || []).map((i) => i.message).join(' | ')}`);

  // Make the stored record invalid behind the rules' back, then delete it.
  await DynamicRecord.updateOne({ _id: cashId }, { $set: { 'data.premium': 1 } });
  r = await req(`/api/v1/records/policy/${cashId}`, { method: 'DELETE', cookie: A.cookie });
  check('rules are never evaluated on delete', r.status === 200, `HTTP ${r.status} ${r.json?.message || ''}`);

  // ── Timing: CSV import ───────────────────────────────────────────────────
  const csv = 'Name,Payment Method,Debit Order Day,Type,Premium\nGood row,cash,,individual,2000\nBad row,debit_order,,individual,20\n';
  const form = new FormData();
  form.append('file', new Blob([csv], { type: 'text/csv' }), 'policies.csv');
  r = await req('/api/v1/records/policy/import', { method: 'POST', cookie: A.cookie, form });
  const rowErrors = (r.json?.data?.errors || [])[0]?.errors || [];
  check(
    'rules (with the tenant threshold) run on CSV import and list every problem per row',
    r.json?.data?.created === 1 && r.json?.data?.failed === 1 && rowErrors.length === 3 && rowErrors.some((e) => /below this company/.test(e)) && rowErrors.every((e) => typeof e === 'string'),
    JSON.stringify(r.json?.data),
  );

  // ── Timing: flow steps ───────────────────────────────────────────────────
  r = await create(A, { name: 'Flow target', payment_method: 'cash', type: 'individual', premium: 1500 });
  const flowTargetId = r.json?.data?._id || r.json?.data?.id;
  const flow = await Automation.create({
    tenantId: A.tenantId, apiName: `bad_update_${RUN}`, name: 'Bad update', type: 'autolaunched',
    nodes: [
      { id: 't', type: 'trigger', label: 'Start', nextNodes: [{ nodeId: 'u' }] },
      { id: 'u', type: 'action_update_record', label: 'Switch to debit order', config: { recordMode: 'trigger', fields: { payment_method: 'debit_order' } } },
    ],
  });
  r = await req(`/api/v1/automations/${flow._id}/run-action`, { method: 'POST', cookie: A.cookie, body: { recordId: flowTargetId, objectApiName: 'policy' } });
  const afterFlow = await DynamicRecord.findById(flowTargetId).lean();
  check(
    'a flow step that would break a rule is blocked and reported',
    afterFlow?.data?.payment_method === 'cash' && (r.json?.data?.errors || []).some((e) => /blocked by validation rules.*Debit Order Day is required/.test(e)),
    JSON.stringify(r.json?.data?.errors),
  );

  // ── Timing: incoming webhooks ────────────────────────────────────────────
  r = await req('/api/v1/webhooks/incoming', {
    method: 'POST', cookie: A.cookie,
    body: { objectApiName: 'policy', action: 'create', data: { name: 'Hook', payment_method: 'debit_order', type: 'individual', premium: 1500 }, triggerFlow: false },
  });
  const hookCount = await DynamicRecord.countDocuments({ tenantId: A.tenantId, objectApiName: 'policy', 'data.name': 'Hook' });
  check('a webhook create that breaks a rule is rejected', r.status === 400 && hookCount === 0 && /Debit Order Day/.test(r.json?.message || ''), `HTTP ${r.status} ${r.json?.message || ''}`);

  r = await req('/api/v1/webhooks/incoming', {
    method: 'POST', cookie: A.cookie,
    body: { objectApiName: 'policy', action: 'create', data: { name: 'Hook ok', payment_method: 'cash', type: 'individual', premium: 1500 }, triggerFlow: false },
  });
  check('a valid webhook create still works', r.status === 200, `HTTP ${r.status} ${r.json?.message || ''}`);
} catch (err) {
  check('test harness ran without error', false, err.stack || err.message);
} finally {
  if (tenantIds.length) {
    await Tenant.deleteMany({ _id: { $in: tenantIds } });
    await Promise.all(models.map((M) => M.deleteMany({ tenantId: { $in: tenantIds } }).catch(() => {})));
  }
  server.close();
  await mongoose.connection.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
