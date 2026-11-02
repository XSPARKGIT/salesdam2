/**
 * validation-rules.e2e.mjs — BRD 6.1 Validation Rule definition.
 *
 * Boots the real Express app and verifies, through the API:
 *  - Scope: any number of active rules per object, each with name,
 *    description, formula, error message, error location and active toggle
 *  - the formula must be a true/false condition; TRUE blocks the save
 *  - error location: on a field (fieldErrors) or at the top of the record
 *  - expression builder: the formula-field library plus ISBLANK, ISCHANGED
 *    (true only on update, against the pre-save value) and AND/OR/NOT nesting
 *  - ISCHANGED is rejected in formula fields
 *
 * Run: node tests/validation-rules.e2e.mjs   (from backend/)
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
import AuditLog from '../models/AuditLog.js';
import Workspace from '../models/Workspace.js';
import { seedDefaultRoles } from '../services/roleService.js';
import { seedWorkspace } from './helpers/workspace.mjs';

const RUN = Date.now().toString(36);
const PASSWORD = 'RulesTest123!';

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;

const req = async (path, { method = 'GET', cookie, body } = {}) => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
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

let tenantId = null;
const models = [User, Role, Session, ObjectMeta, FieldMeta, DynamicRecord, AuditLog, Workspace];

try {
  await connectDB();

  const tenant = await Tenant.create({ name: `ZZ_VR_${RUN}`, slug: `zz-vr-${RUN}`, status: 'active', plan: 'enterprise' });
  tenantId = tenant._id;
  await seedDefaultRoles(tenantId);
  const roleAdmin = await Role.findOne({ tenantId, name: 'admin' });
  const admin = await User.create({
    tenantId, firstName: 'Vr', lastName: 'Admin', email: `vr-${RUN}@example.com`,
    username: `vr_${RUN}`, password: PASSWORD, role: roleAdmin._id, status: 'active', emailVerified: true,
  });
  await seedWorkspace(tenantId, [admin._id], ['deal']);
  const cookie = await loginCookie(admin.username);
  check('admin can log in', Boolean(cookie));

  const deal = await ObjectMeta.create({ tenantId, name: 'Deal', label: 'Deal', pluralLabel: 'Deals', apiName: 'deal', nameFieldApiName: 'name', isActive: true });
  const f = (apiName, label, type, extra = {}) => ({ tenantId, objectId: deal._id, objectApiName: 'deal', name: apiName, apiName, label, type, ...extra });
  await FieldMeta.create([
    f('name', 'Name', 'text'),
    f('stage', 'Stage', 'picklist', { picklistValues: ['open', 'closed_won', 'locked'].map((v) => ({ label: v, value: v, isActive: true })) }),
    f('amount', 'Amount', 'currency'),
    f('close_date', 'Close Date', 'date'),
    f('approver', 'Approver', 'text'),
    f('approved', 'Approved', 'boolean'),
  ]);

  const rules = [
    { name: 'Amount must be positive', description: 'Blocks zero or negative amounts', expression: 'amount <= 0', errorMessage: 'Amount must be greater than zero.', errorField: 'amount', isActive: true },
    { name: 'Close date when won', description: 'Moving to Closed Won needs a close date', expression: 'ISCHANGED(stage) AND stage == "closed_won" AND ISBLANK(close_date)', errorMessage: 'Set a close date before marking the deal Closed Won.', errorField: '', isActive: true },
    { name: 'Big deals need approval', expression: 'AND(amount > 10000, OR(ISBLANK(approver), NOT(approved)))', errorMessage: 'Deals over 10,000 need an approver who has approved.', errorField: 'approver', isActive: true },
    { name: 'Locked close date', expression: 'ISCHANGED(close_date) AND stage == "locked"', errorMessage: 'A locked deal\'s close date cannot change.', isActive: true },
    { name: 'Never enforced', expression: 'ISBLANK(name)', errorMessage: 'Name is required.', isActive: false },
  ];
  const saveRules = (list) => req('/api/v1/objects/deal', { method: 'PUT', cookie, body: { validationRules: list } });

  // ── Definition ───────────────────────────────────────────────────────────
  let r = await saveRules(rules);
  const stored = (await ObjectMeta.findOne({ tenantId, apiName: 'deal' }).lean()).validationRules;
  check(
    'an object holds several rules with name, description, formula, message, location and active flag',
    r.status === 200 && stored.length === 5 && stored[0].description === 'Blocks zero or negative amounts' && stored[0].errorField === 'amount' && stored[4].isActive === false,
    `HTTP ${r.status} ${r.json?.message || ''}`,
  );

  r = await saveRules([...rules, { name: 'Not a condition', expression: 'amount * 2', errorMessage: 'x', isActive: true }]);
  check('a formula that is not true/false is rejected', r.status === 400 && /boolean|true\/false|returns number/i.test(r.json?.message || ''), r.json?.message);

  r = await saveRules([...rules, { name: 'Bad location', expression: 'amount < 0', errorMessage: 'x', errorField: 'nope', isActive: true }]);
  check('an error location that is not a field is rejected', r.status === 400 && /not a field/.test(r.json?.message || ''), r.json?.message);

  r = await saveRules([...rules, { name: 'Bad ISCHANGED', expression: 'ISCHANGED("stage")', errorMessage: 'x', isActive: true }]);
  check('ISCHANGED must be given a field', r.status === 400, r.json?.message);

  // Live check used by the editor
  const live = (expression, context) => req('/api/v1/records/validate-formula', { method: 'POST', cookie, body: { objectApiName: 'deal', expression, context } });
  r = await live('AND(amount > 0, OR(stage == "open", NOT(approved)))', 'rule');
  check('the editor accepts nested AND/OR/NOT for a rule', r.json?.data?.valid === true, JSON.stringify(r.json?.data));
  r = await live('amount + 1', 'rule');
  check('the editor flags a rule that is not true/false', r.json?.data?.valid === false, r.json?.data?.error);
  r = await live('ISCHANGED(stage)', 'formula');
  check('the editor rejects ISCHANGED outside validation rules', r.json?.data?.valid === false && /validation rules/.test(r.json?.data?.error || ''), r.json?.data?.error);

  r = await req('/api/v1/objects/deal/fields', {
    method: 'POST', cookie,
    body: { label: 'Stage Changed', apiName: 'stage_changed', type: 'formula', formula: 'ISCHANGED(stage)', formulaReturnType: 'boolean' },
  });
  check('a formula field cannot use ISCHANGED', r.status === 400, `HTTP ${r.status} ${r.json?.message || ''}`);

  // ── Enforcement on create ────────────────────────────────────────────────
  const create = (body) => req('/api/v1/records/deal', { method: 'POST', cookie, body });
  r = await create({ name: 'Zero', amount: 0, stage: 'open' });
  check('TRUE blocks the save and the message is attached to the chosen field', r.status === 400 && r.json?.fieldErrors?.amount === 'Amount must be greater than zero.', JSON.stringify(r.json?.fieldErrors));

  r = await create({ name: 'Big', amount: 20000, stage: 'open', approver: 'Thandi', approved: false });
  check('nested AND/OR/NOT conditions are enforced', r.status === 400 && /need an approver/.test(r.json?.fieldErrors?.approver || ''), JSON.stringify(r.json?.fieldErrors));

  r = await create({ name: 'Won on create', amount: 500, stage: 'closed_won' });
  const wonId = r.json?.data?._id || r.json?.data?.id;
  check('ISCHANGED is false on create, so a new Closed Won deal saves', r.status === 201 || r.status === 200, `HTTP ${r.status} ${r.json?.message || ''}`);

  r = await create({ name: '', amount: 5, stage: 'open' });
  check('an inactive rule is not enforced', r.status === 201 || r.status === 200, `HTTP ${r.status} ${r.json?.message || ''}`);

  // ── Enforcement on update (ISCHANGED) ────────────────────────────────────
  r = await create({ name: 'Open deal', amount: 500, stage: 'open' });
  const openId = r.json?.data?._id || r.json?.data?.id;
  const patch = (id, body) => req(`/api/v1/records/deal/${id}`, { method: 'PATCH', cookie, body });

  r = await patch(openId, { stage: 'closed_won' });
  check(
    'changing Stage to closed_won without a close date is blocked, shown at the top of the record',
    r.status === 400 && /Set a close date/.test(r.json?.message || '') && !r.json?.fieldErrors?.stage,
    `HTTP ${r.status} ${r.json?.message || ''}`,
  );

  r = await patch(wonId, { amount: 600 });
  check('editing another field of an already-won deal is not blocked (stage unchanged)', r.status === 200, `HTTP ${r.status} ${r.json?.message || ''}`);

  r = await patch(openId, { stage: 'closed_won', close_date: '2026-11-30' });
  check('the same change with a close date saves', r.status === 200, `HTTP ${r.status} ${r.json?.message || ''}`);

  r = await create({ name: 'Locked', amount: 100, stage: 'locked', close_date: '2026-12-01' });
  const lockedId = r.json?.data?._id || r.json?.data?.id;
  r = await patch(lockedId, { close_date: '2026-12-01' });
  check('re-saving the same date is not a change', r.status === 200, `HTTP ${r.status} ${r.json?.message || ''}`);
  r = await patch(lockedId, { close_date: '2026-12-15' });
  check('a different date is a change and is blocked', r.status === 400 && /cannot change/.test(r.json?.message || ''), `HTTP ${r.status} ${r.json?.message || ''}`);

  // ── Several rules at once / toggling ─────────────────────────────────────
  r = await create({ name: 'Two problems', amount: -1, stage: 'open' });
  r = await patch(openId, { amount: -5 });
  check('a failing rule on update is reported on its field', r.status === 400 && Boolean(r.json?.fieldErrors?.amount), JSON.stringify(r.json?.fieldErrors));

  await saveRules(rules.map((x) => (x.name === 'Amount must be positive' ? { ...x, isActive: false } : x)));
  r = await patch(openId, { amount: -5 });
  check('switching a rule off stops it being enforced', r.status === 200, `HTTP ${r.status} ${r.json?.message || ''}`);
} catch (err) {
  check('test harness ran without error', false, err.stack || err.message);
} finally {
  if (tenantId) {
    await Tenant.deleteMany({ _id: tenantId });
    await Promise.all(models.map((M) => M.deleteMany({ tenantId }).catch(() => {})));
  }
  server.close();
  await mongoose.connection.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
