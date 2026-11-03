/**
 * flow-definition.e2e.mjs — BRD 7.1 Flow Definition.
 *
 * Boots the real Express app and verifies, through the API:
 *  - attributes: name, description, object, trigger type, entry condition
 *    (a true/false formula, same builder as validation rules), active toggle
 *  - trigger types: Record Created, Record Updated, Record Created or
 *    Updated, Scheduled / time-based ("3 days before Due Date", and cron),
 *    and Manually Invoked (from a button)
 *  - entry conditions gate every trigger type, including ISCHANGED on update
 *  - invalid definitions are rejected when saved
 *
 * Run: node tests/flow-definition.e2e.mjs   (from backend/)
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
import FlowScheduleRun from '../models/FlowScheduleRun.js';
import FlowError from '../models/FlowError.js';
import AuditLog from '../models/AuditLog.js';
import Workspace from '../models/Workspace.js';
import { seedDefaultRoles } from '../services/roleService.js';
import { runScheduledFlows } from '../services/scheduledFlowService.js';
import { seedWorkspace } from './helpers/workspace.mjs';

const RUN = Date.now().toString(36);
const PASSWORD = 'FlowDef123!';

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isoDay = (offset) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

let tenantId = null;
const models = [User, Role, Session, ObjectMeta, FieldMeta, DynamicRecord, Automation, FlowScheduleRun, FlowError, AuditLog, Workspace];

try {
  await connectDB();

  const tenant = await Tenant.create({ name: `ZZ_FLOW_${RUN}`, slug: `zz-flow-${RUN}`, status: 'active', plan: 'enterprise' });
  tenantId = tenant._id;
  await seedDefaultRoles(tenantId);
  const roleAdmin = await Role.findOne({ tenantId, name: 'admin' });
  const admin = await User.create({
    tenantId, firstName: 'Flow', lastName: 'Admin', email: `flow-${RUN}@example.com`,
    username: `flow_${RUN}`, password: PASSWORD, role: roleAdmin._id, status: 'active', emailVerified: true,
  });
  await seedWorkspace(tenantId, [admin._id], ['bill']);
  const cookie = await loginCookie(admin.email);
  check('admin can log in', Boolean(cookie));

  const inv = await ObjectMeta.create({ tenantId, name: 'Invoice', label: 'Invoice', pluralLabel: 'Invoices', apiName: 'bill', nameFieldApiName: 'name', isActive: true });
  const f = (apiName, label, type, extra = {}) => ({ tenantId, objectId: inv._id, objectApiName: 'bill', name: apiName, apiName, label, type, ...extra });
  await FieldMeta.create([
    f('name', 'Name', 'text'),
    f('status', 'Status', 'picklist', { picklistValues: ['draft', 'sent', 'paid'].map((v) => ({ label: v, value: v, isActive: true })) }),
    f('due_date', 'Due Date', 'date'),
    f('amount', 'Amount', 'currency'),
    f('big_flag', 'Big Flag', 'text'),
    f('sent_flag', 'Sent Flag', 'text'),
    f('touched', 'Touched', 'text'),
    f('reminder', 'Reminder', 'text'),
    f('manual_flag', 'Manual Flag', 'text'),
  ]);

  // trigger → update the record's `field` to `value`
  const nodes = (field, value) => [
    { id: 't', type: 'trigger', label: 'Start', nextNodes: [{ nodeId: 'u' }] },
    { id: 'u', type: 'action_update_record', label: `Set ${field}`, config: { recordMode: 'trigger', fields: { [field]: value } } },
  ];
  let n = 0;
  const createFlow = (body) => req('/api/v1/automations', {
    method: 'POST', cookie,
    body: { apiName: `flow_${RUN}_${n++}`, isActive: true, ...body },
  });

  // ── Definition checks ────────────────────────────────────────────────────
  const bad = async (label, body) => {
    const r = await createFlow({ name: 'Bad', ...body });
    check(`rejects ${label}`, r.status === 400, `HTTP ${r.status} ${r.json?.message || ''}`);
  };
  await bad('a record-triggered flow with no object', { type: 'record_triggered', trigger: { events: ['create'] }, nodes: nodes('touched', 'x') });
  await bad('an entry condition that is not true/false', { type: 'record_triggered', trigger: { objectApiName: 'bill', events: ['create'], entryCondition: 'amount * 2' }, nodes: nodes('touched', 'x') });
  await bad('an entry condition with an unknown CONFIG key', { type: 'record_triggered', trigger: { objectApiName: 'bill', events: ['create'], entryCondition: 'amount > CONFIG("nope.key")' }, nodes: nodes('touched', 'x') });
  await bad('a time-based schedule on a non-date field', { type: 'scheduled', trigger: { objectApiName: 'bill', schedule: { mode: 'relative_date', dateField: 'amount', days: 3, when: 'before' } }, nodes: nodes('touched', 'x') });
  await bad('an invalid cron schedule', { type: 'scheduled', trigger: { objectApiName: 'bill', schedule: { mode: 'cron', cron: '61 * * * *' } }, nodes: nodes('touched', 'x') });

  // ── Record Created / Updated / Created or Updated ────────────────────────
  let r = await createFlow({
    name: 'Flag big invoices', description: 'Marks invoices over 1000', type: 'record_triggered',
    trigger: { objectApiName: 'bill', events: ['create'], entryCondition: 'amount > 1000' }, nodes: nodes('big_flag', 'big'),
  });
  const createdFlow = r.json?.data;
  check(
    'a flow stores name, description, object, trigger type, entry condition and active flag',
    r.status === 201 && createdFlow?.description === 'Marks invoices over 1000' && createdFlow?.trigger?.objectApiName === 'bill' &&
      createdFlow?.triggerType === 'record_created' && createdFlow?.trigger?.entryCondition === 'amount > 1000' && createdFlow?.isActive === true,
    `HTTP ${r.status} ${r.json?.message || ''} triggerType=${createdFlow?.triggerType}`,
  );

  r = await createFlow({
    name: 'Note when sent', type: 'record_triggered',
    trigger: { objectApiName: 'bill', events: ['update'], entryCondition: 'ISCHANGED(status) AND status == "sent"' }, nodes: nodes('sent_flag', 'sent'),
  });
  check('Record Updated trigger type', r.json?.data?.triggerType === 'record_updated', r.json?.data?.triggerType);

  r = await createFlow({
    name: 'Touch on any save', type: 'record_triggered',
    trigger: { objectApiName: 'bill', events: ['create', 'update'], entryCondition: 'NOT(ISBLANK(name))' }, nodes: nodes('touched', 'yes'),
  });
  const touchFlowId = r.json?.data?._id;
  check('Record Created or Updated trigger type', r.json?.data?.triggerType === 'record_created_or_updated', r.json?.data?.triggerType);

  const data = async (id) => (await DynamicRecord.findById(id).lean())?.data || {};
  const create = async (body) => {
    const res = await req('/api/v1/records/bill', { method: 'POST', cookie, body });
    if (!res.json?.data) throw new Error(`create failed: HTTP ${res.status} ${res.json?.message}`);
    return { ...res.json.data, _id: res.json.data._id || res.json.data.id };
  };

  const big = await create({ name: 'Big', status: 'draft', amount: 5000 });
  const small = await create({ name: 'Small', status: 'draft', amount: 10 });
  await sleep(1500);
  check('Record Created runs when the entry condition is true', (await data(big._id)).big_flag === 'big');
  check('…and not when it is false', !(await data(small._id)).big_flag);
  check('Created or Updated runs on create', (await data(small._id)).touched === 'yes');

  await DynamicRecord.updateOne({ _id: small._id }, { $unset: { 'data.touched': 1 } });
  await req(`/api/v1/records/bill/${small._id}`, { method: 'PATCH', cookie, body: { status: 'sent' } });
  await sleep(1500);
  let d = await data(small._id);
  check('Record Updated with ISCHANGED runs when the status changes to sent', d.sent_flag === 'sent', JSON.stringify(d));
  check('Created or Updated runs on update', d.touched === 'yes');

  await DynamicRecord.updateOne({ _id: small._id }, { $unset: { 'data.sent_flag': 1 } });
  await req(`/api/v1/records/bill/${small._id}`, { method: 'PATCH', cookie, body: { amount: 20 } });
  await sleep(1500);
  check('…and not when the status did not change', !(await data(small._id)).sent_flag);

  // Inactive
  await req(`/api/v1/automations/${touchFlowId}`, { method: 'PUT', cookie, body: { isActive: false } });
  const quiet = await create({ name: 'Quiet', status: 'draft', amount: 5 });
  await sleep(1500);
  check('an inactive flow does not run', !(await data(quiet._id)).touched);

  // ── Scheduled: 3 days before Due Date ────────────────────────────────────
  r = await createFlow({
    name: 'Payment reminder', type: 'scheduled',
    trigger: { objectApiName: 'bill', entryCondition: 'status != "paid"', schedule: { mode: 'relative_date', dateField: 'due_date', days: 3, when: 'before', time: '00:00' } },
    nodes: nodes('reminder', 'due soon'),
  });
  const reminderId = r.json?.data?._id;
  check('a time-based flow saves with trigger type scheduled', r.status === 201 && r.json?.data?.triggerType === 'scheduled', `HTTP ${r.status} ${r.json?.message || ''}`);

  const dueIn3 = await create({ name: 'Due in 3', status: 'sent', amount: 100, due_date: isoDay(3) });
  const dueIn5 = await create({ name: 'Due in 5', status: 'sent', amount: 100, due_date: isoDay(5) });
  const paidIn3 = await create({ name: 'Paid, due in 3', status: 'paid', amount: 100, due_date: isoDay(3) });
  await sleep(500);

  r = await req(`/api/v1/automations/${reminderId}/run-schedule`, { method: 'POST', cookie });
  check(
    '"3 days before Due Date" runs for the invoice due in 3 days, skipping the paid one',
    r.status === 200 && r.json?.data?.matched === 2 && r.json?.data?.ran === 1 && r.json?.data?.skipped === 1,
    `HTTP ${r.status} ${r.json?.message || ''}`,
  );
  check('the due invoice got its reminder', (await data(dueIn3._id)).reminder === 'due soon');
  check('the invoice due in 5 days and the paid one did not', !(await data(dueIn5._id)).reminder && !(await data(paidIn3._id)).reminder);

  r = await req(`/api/v1/automations/${reminderId}/run-schedule`, { method: 'POST', cookie });
  check('running again the same day does not repeat it', r.json?.data?.ran === 0 && r.json?.data?.alreadyRun === 1, r.json?.message);

  // ── Scheduled: cron, via the scheduler tick ──────────────────────────────
  const now = new Date();
  const cron = `${now.getUTCMinutes()} ${now.getUTCHours()} * * *`;
  r = await createFlow({
    name: 'Daily sweep', type: 'scheduled',
    trigger: { objectApiName: 'bill', entryCondition: 'status == "draft"', schedule: { mode: 'cron', cron, timezone: 'UTC' } },
    nodes: nodes('reminder', 'swept'),
  });
  await runScheduledFlows({ now, tenantId });
  check('a cron flow runs on its schedule for matching records', (await data(big._id)).reminder === 'swept' && (await data(dueIn5._id)).reminder !== 'swept');

  // ── Manually invoked ─────────────────────────────────────────────────────
  r = await createFlow({
    name: 'Mark reviewed', type: 'autolaunched',
    trigger: { objectApiName: 'bill', entryCondition: 'status == "sent"' }, nodes: nodes('manual_flag', 'reviewed'),
  });
  const manualId = r.json?.data?._id;
  check('a button flow has trigger type manual', r.json?.data?.triggerType === 'manual', r.json?.data?.triggerType);
  r = await req(`/api/v1/automations/${manualId}/run-action`, { method: 'POST', cookie, body: { recordId: big._id, objectApiName: 'bill' } });
  check('a manual flow refuses a record that fails its entry condition', r.status === 409 && /entry conditions/.test(r.json?.message || ''), `HTTP ${r.status} ${r.json?.message || ''}`);
  r = await req(`/api/v1/automations/${manualId}/run-action`, { method: 'POST', cookie, body: { recordId: dueIn3._id, objectApiName: 'bill' } });
  check('…and runs for one that meets it', r.status === 200 && (await data(dueIn3._id)).manual_flag === 'reviewed', `HTTP ${r.status}`);
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
