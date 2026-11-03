/**
 * activity.e2e.mjs — activity & customer interaction framework (Core BRD §24).
 *
 * Boots the real Express app, seeds a tenant, and exercises activity creation,
 * the chronological timeline with filters (type, user, date), task completion,
 * idempotent channel logging, validation and tenant isolation.
 *
 * Run: node tests/activity.e2e.mjs   (from backend/)
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
import Activity from '../models/Activity.js';
import { seedDefaultRoles } from '../services/roleService.js';

const RUN = Date.now().toString(36);
const PASSWORD = 'ActTest123!';
const RECORD = new mongoose.Types.ObjectId().toString();

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
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
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
let tenantBId = null;

try {
  await connectDB();

  const tenant = await Tenant.create({
    name: `ZZ_ACT_${RUN}`, slug: `zz-act-${RUN}`, status: 'active', plan: 'enterprise',
  });
  tenantId = tenant._id;
  await seedDefaultRoles(tenantId);
  const stdRole = await Role.findOne({ tenantId, name: 'standard_user' });

  const agent = await User.create({
    tenantId, firstName: 'Agent', lastName: 'One', email: `agent1-${RUN}@example.com`,
    username: `agent1_${RUN}`, password: PASSWORD, role: stdRole._id, status: 'active', emailVerified: true,
  });
  const agent2 = await User.create({
    tenantId, firstName: 'Agent', lastName: 'Two', email: `agent2-${RUN}@example.com`,
    username: `agent2_${RUN}`, password: PASSWORD, role: stdRole._id, status: 'active', emailVerified: true,
  });
  const cookie = await loginCookie(agent.email);
  check('agent can log in', Boolean(cookie));

  const create = (body) => req('/api/v1/activities', { method: 'POST', cookie, body });
  const timeline = (query) => req(`/api/v1/activities/timeline?${query}`, { cookie });

  // Times chosen so ordering is deterministic (earliest → latest).
  const t = (n) => new Date(Date.now() - n * 3600_000).toISOString();

  const aCall = await create({ type: 'call', subject: 'Intro call', objectApiName: 'contact', recordId: RECORD, assignedTo: agent._id, direction: 'outbound', occurredAt: t(5) });
  const aEmail = await create({ type: 'email', subject: 'Follow-up email', objectApiName: 'contact', recordId: RECORD, assignedTo: agent._id, direction: 'inbound', occurredAt: t(4) });
  const aNote = await create({ type: 'note', subject: 'Note', objectApiName: 'contact', recordId: RECORD, occurredAt: t(3) });
  const aTask = await create({ type: 'task', subject: 'Follow-up call', objectApiName: 'contact', recordId: RECORD, assignedTo: agent2._id, dueAt: t(-24), occurredAt: t(2) });
  const aMeeting = await create({ type: 'meeting', subject: 'Kickoff', objectApiName: 'contact', recordId: RECORD, assignedTo: agent2._id, occurredAt: t(1) });
  check('activities of several types can be created', [aCall, aEmail, aNote, aTask, aMeeting].every((r) => r.status === 201), `statuses=${[aCall, aEmail, aNote, aTask, aMeeting].map((r) => r.status).join(',')}`);

  // ── Timeline ────────────────────────────────────────────────────────────
  const all = await timeline(`objectApiName=contact&recordId=${RECORD}`);
  check('timeline returns every activity', all.status === 200 && all.json?.data?.length === 5, `count=${all.json?.data?.length}`);
  check('timeline is reverse-chronological', all.json?.data?.[0]?.type === 'meeting' && all.json?.data?.[4]?.type === 'call', `first=${all.json?.data?.[0]?.type} last=${all.json?.data?.[4]?.type}`);

  const byType = await timeline(`objectApiName=contact&recordId=${RECORD}&types=call,email`);
  check('timeline filters by activity type', byType.json?.data?.length === 2 && byType.json.data.every((a) => ['call', 'email'].includes(a.type)), `count=${byType.json?.data?.length}`);

  const byUser = await timeline(`objectApiName=contact&recordId=${RECORD}&userId=${agent2._id}`);
  check('timeline filters by user', byUser.json?.data?.length === 2 && byUser.json.data.every((a) => String(a.assignedTo?._id || a.assignedTo) === String(agent2._id)), `count=${byUser.json?.data?.length}`);

  const from = new Date(Date.now() - 4.5 * 3600_000).toISOString();
  const byDate = await timeline(`objectApiName=contact&recordId=${RECORD}&from=${from}`);
  check('timeline filters by date range', byDate.json?.data?.length === 4, `count=${byDate.json?.data?.length}`);

  // ── Task lifecycle ──────────────────────────────────────────────────────
  check('a task defaults to open', aTask.json?.data?.status === 'open', `status=${aTask.json?.data?.status}`);
  const completed = await req(`/api/v1/activities/${aTask.json?.data?._id}`, { method: 'PUT', cookie, body: { status: 'completed' } });
  check('a task can be completed', completed.status === 200 && completed.json?.data?.status === 'completed' && Boolean(completed.json?.data?.completedAt), `status=${completed.json?.data?.status}`);

  // ── Idempotent channel logging ──────────────────────────────────────────
  const logBody = { type: 'whatsapp', subject: 'Inbound WA', objectApiName: 'contact', recordId: RECORD, externalId: `wa-${RUN}-1`, direction: 'inbound' };
  const log1 = await req('/api/v1/activities/log', { method: 'POST', cookie, body: logBody });
  const log2 = await req('/api/v1/activities/log', { method: 'POST', cookie, body: logBody });
  check('channel log is idempotent by externalId', log1.status === 201 && log2.status === 201 && String(log1.json?.data?._id) === String(log2.json?.data?._id), `ids=${log1.json?.data?._id}/${log2.json?.data?._id}`);
  const waCount = await Activity.countDocuments({ tenantId, externalId: logBody.externalId });
  check('logging twice creates one activity', waCount === 1, `count=${waCount}`);

  const noExternal = await req('/api/v1/activities/log', { method: 'POST', cookie, body: { type: 'email', objectApiName: 'contact', recordId: RECORD } });
  check('channel log requires an externalId', noExternal.status === 400, `HTTP ${noExternal.status}`);

  // ── Validation ──────────────────────────────────────────────────────────
  const badType = await create({ type: 'smoke_signal', objectApiName: 'contact', recordId: RECORD });
  check('an unknown activity type is rejected', badType.status === 400, `HTTP ${badType.status}`);
  const noRecord = await create({ type: 'note', objectApiName: 'contact' });
  check('objectApiName and recordId are required', noRecord.status === 400, `HTTP ${noRecord.status}`);

  const typesList = await req('/api/v1/activities/types', { cookie });
  check('the activity types endpoint lists supported types', typesList.status === 200 && typesList.json?.data?.includes('call'), '');

  // ── Tenant isolation ────────────────────────────────────────────────────
  const tenantB = await Tenant.create({
    name: `ZZ_ACT_B_${RUN}`, slug: `zz-act-b-${RUN}`, status: 'active', plan: 'enterprise',
  });
  tenantBId = tenantB._id;
  await seedDefaultRoles(tenantBId);
  const roleB = await Role.findOne({ tenantId: tenantBId, name: 'standard_user' });
  const userB = await User.create({
    tenantId: tenantBId, firstName: 'Other', lastName: 'Tenant', email: `otheract-${RUN}@example.com`,
    username: `otheract_${RUN}`, password: PASSWORD, role: roleB._id, status: 'active', emailVerified: true,
  });
  const cookieB = await loginCookie(userB.email);

  const timelineB = await req(`/api/v1/activities/timeline?objectApiName=contact&recordId=${RECORD}`, { cookie: cookieB });
  check('another tenant sees an empty timeline for the record', timelineB.status === 200 && timelineB.json?.data?.length === 0, `count=${timelineB.json?.data?.length}`);

  const getB = await req(`/api/v1/activities/${aCall.json?.data?._id}`, { cookie: cookieB });
  check('another tenant cannot read this activity by id', getB.status === 404, `HTTP ${getB.status}`);
} catch (err) {
  check('test harness ran without error', false, err.message);
} finally {
  if (tenantId || tenantBId) {
    const ids = [tenantId, tenantBId].filter(Boolean);
    await Tenant.deleteMany({ _id: { $in: ids } });
    await Promise.all(
      [User, Role, Session, Activity].map((M) => M.deleteMany({ tenantId: { $in: ids } }).catch(() => {})),
    );
  }
  server.close();
  await mongoose.connection.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
