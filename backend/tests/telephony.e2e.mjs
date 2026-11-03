/**
 * telephony.e2e.mjs - Call Centre / telephony (Core BRD 18).
 *
 * Boots the real Express app and exercises: default and updated agent presence,
 * supervisor visibility, tenant-configurable dispositions, call ingestion via
 * the signed telephony webhook, post-call wrap-up (disposition + notes), call
 * history on a record and tenant isolation.
 *
 * Run: node tests/telephony.e2e.mjs   (from backend/)
 * Exits non-zero if any check fails.
 */
import 'dotenv/config';
import crypto from 'crypto';
import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import app from '../app.js';
import Tenant from '../models/Tenant.js';
import User from '../models/User.js';
import Role from '../models/Role.js';
import Session from '../models/Session.js';
import ObjectMeta from '../models/ObjectMeta.js';
import DynamicRecord from '../models/DynamicRecord.js';
import ChannelAccount from '../models/ChannelAccount.js';
import AgentPresence from '../models/AgentPresence.js';
import Activity from '../models/Activity.js';
import TenantConfiguration from '../models/TenantConfiguration.js';
import { seedDefaultRoles } from '../services/roleService.js';

const RUN = Date.now().toString(36);
const PASSWORD = 'Tel123!';

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

const signedPost = async (path, secret, payload) => {
  const body = JSON.stringify(payload);
  const signature = crypto.createHmac('sha256', secret).update(body).digest('hex');
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-salesdam-signature': signature },
    body,
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

let tenantAId = null;
let tenantBId = null;

try {
  await connectDB();

  const tenantA = await Tenant.create({ name: `ZZ_TEL_${RUN}`, slug: `zz-tel-${RUN}`, status: 'active', plan: 'enterprise' });
  tenantAId = tenantA._id;
  await seedDefaultRoles(tenantAId);
  const roleAdmin = await Role.findOne({ tenantId: tenantAId, name: 'admin' });
  const roleStd = await Role.findOne({ tenantId: tenantAId, name: 'standard_user' });

  const makeUser = (tenantId, roleId, tag) =>
    User.create({
      tenantId, firstName: tag, lastName: 'User', email: `${tag}-${RUN}@example.com`,
      username: `${tag}_${RUN}`, password: PASSWORD, role: roleId, status: 'active', emailVerified: true,
    });

  const admin = await makeUser(tenantAId, roleAdmin._id, 'teladmin');
  const agent = await makeUser(tenantAId, roleStd._id, 'telagent');
  const cookieAdmin = await loginCookie(admin.email);
  const cookieAgent = await loginCookie(agent.email);
  check('users can log in', Boolean(cookieAdmin && cookieAgent));

  const contactObj = await ObjectMeta.create({
    tenantId: tenantAId, name: 'Contact', label: 'Contact', pluralLabel: 'Contacts',
    apiName: 'contact', nameFieldApiName: 'name', isActive: true, searchable: true,
  });
  const contact = await DynamicRecord.create({
    tenantId: tenantAId, objectId: contactObj._id, objectApiName: 'contact',
    data: { name: 'Jane Client', phone: '+27821234567' },
  });

  const telAccount = await ChannelAccount.create({
    tenantId: tenantAId, channel: 'telephony', name: 'Main Line', provider: 'euphoria',
    webhookSecret: 'tel-secret',
    matchRules: [{ objectApiName: 'contact', fieldApiName: 'phone', kind: 'phone' }],
  });

  // ── Agent presence (18.6) ───────────────────────────────────────────────
  const def = await req('/api/v1/telephony/status/me', { cookie: cookieAgent });
  check('an agent defaults to offline', def.status === 200 && def.json?.data?.status === 'offline', `status=${def.json?.data?.status}`);

  const setAvailable = await req('/api/v1/telephony/status/me', { method: 'PUT', cookie: cookieAgent, body: { status: 'available' } });
  check('an agent can set their availability', setAvailable.status === 200 && setAvailable.json?.data?.status === 'available', `status=${setAvailable.json?.data?.status}`);

  const badStatus = await req('/api/v1/telephony/status/me', { method: 'PUT', cookie: cookieAgent, body: { status: 'napping' } });
  check('an unknown availability status is rejected', badStatus.status === 400, `HTTP ${badStatus.status}`);

  const agentList = await req('/api/v1/telephony/status', { cookie: cookieAgent });
  check('a standard user cannot list every agent status', agentList.status === 403, `HTTP ${agentList.status}`);
  const adminList = await req('/api/v1/telephony/status', { cookie: cookieAdmin });
  const agentRow = (adminList.json?.data || []).find((s) => String(s.userId?._id) === String(agent._id));
  check('a supervisor sees agent availability', adminList.status === 200 && agentRow?.status === 'available', `status=${agentRow?.status}`);

  // ── Dispositions (18.8) ─────────────────────────────────────────────────
  const dispDefault = await req('/api/v1/telephony/dispositions', { cookie: cookieAgent });
  check('the default dispositions are available', dispDefault.json?.data?.includes('Interested'), `count=${dispDefault.json?.data?.length}`);

  await TenantConfiguration.create({
    tenantId: tenantAId, key: 'telephony.dispositions', value: ['Resolved', 'Escalated'],
    dataType: 'json', category: 'Telephony',
  });
  const dispOverride = await req('/api/v1/telephony/dispositions', { cookie: cookieAgent });
  check('a tenant can override the disposition list', dispOverride.json?.data?.length === 2 && dispOverride.json.data[0] === 'Resolved', `list=${dispOverride.json?.data?.join(',')}`);

  // ── Call ingestion + wrap-up (18.3, 18.8) ───────────────────────────────
  const call = await signedPost(`/api/v1/channels/webhook/telephony/${telAccount._id}`, 'tel-secret', {
    kind: 'call', externalMessageId: 'call-1', direction: 'inbound', number: '27821234567',
    startedAt: new Date(Date.now() - 90000).toISOString(), endedAt: new Date().toISOString(),
    durationSeconds: 90, status: 'completed', callReference: 'ref-1', recordingUrl: 'https://rec.example.com/1',
  });
  check('a signed call event is accepted', call.status === 202, `HTTP ${call.status}`);
  const callActivity = await Activity.findOne({ tenantId: tenantAId, type: 'call', recordId: contact._id });
  check('the call is logged against the matched contact', Boolean(callActivity), `found=${Boolean(callActivity)}`);

  const badDisp = await req(`/api/v1/telephony/calls/${callActivity?._id}/wrap-up`, { method: 'POST', cookie: cookieAgent, body: { disposition: 'Interested' } });
  check('a disposition outside the configured list is rejected', badDisp.status === 400, `HTTP ${badDisp.status}`);

  const wrap = await req(`/api/v1/telephony/calls/${callActivity?._id}/wrap-up`, { method: 'POST', cookie: cookieAgent, body: { disposition: 'Resolved', notes: 'Customer happy' } });
  check('an agent can wrap up a call with disposition and notes', wrap.status === 200 && wrap.json?.data?.metadata?.disposition === 'Resolved' && wrap.json?.data?.body === 'Customer happy', `disposition=${wrap.json?.data?.metadata?.disposition}`);

  const noteActivity = await Activity.create({
    tenantId: tenantAId, type: 'note', subject: 'Just a note', objectApiName: 'contact', recordId: contact._id,
  });
  const wrongType = await req(`/api/v1/telephony/calls/${noteActivity._id}/wrap-up`, { method: 'POST', cookie: cookieAgent, body: { disposition: 'Resolved' } });
  check('wrap-up only applies to call activities', wrongType.status === 404, `HTTP ${wrongType.status}`);

  const history = await req(`/api/v1/telephony/calls?objectApiName=contact&recordId=${contact._id}`, { cookie: cookieAgent });
  check('call history is available from the record', history.status === 200 && history.json?.data?.length === 1 && history.json.data[0].type === 'call', `count=${history.json?.data?.length}`);

  // ── Isolation ───────────────────────────────────────────────────────────
  const tenantB = await Tenant.create({ name: `ZZ_TEL_B_${RUN}`, slug: `zz-tel-b-${RUN}`, status: 'active', plan: 'enterprise' });
  tenantBId = tenantB._id;
  await seedDefaultRoles(tenantBId);
  const roleAdminB = await Role.findOne({ tenantId: tenantBId, name: 'admin' });
  const adminB = await makeUser(tenantBId, roleAdminB._id, 'teladminb');
  const cookieAdminB = await loginCookie(adminB.email);

  const statusesB = await req('/api/v1/telephony/status', { cookie: cookieAdminB });
  check('agent availability is scoped to the tenant', statusesB.json?.data?.length === 0, `count=${statusesB.json?.data?.length}`);
  const crossWrap = await req(`/api/v1/telephony/calls/${callActivity?._id}/wrap-up`, { method: 'POST', cookie: cookieAdminB, body: { disposition: 'Interested' } });
  check('a tenant cannot wrap up another tenant call', crossWrap.status === 404, `HTTP ${crossWrap.status}`);
} catch (err) {
  check('test harness ran without error', false, err.message);
} finally {
  const ids = [tenantAId, tenantBId].filter(Boolean);
  if (ids.length) {
    await Tenant.deleteMany({ _id: { $in: ids } });
    const cleanup = [
      User, Role, Session, ObjectMeta, DynamicRecord, ChannelAccount,
      AgentPresence, Activity, TenantConfiguration,
    ];
    await Promise.all(cleanup.map((M) => M.deleteMany({ tenantId: { $in: ids } }).catch(() => {})));
  }
  server.close();
  await mongoose.connection.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
