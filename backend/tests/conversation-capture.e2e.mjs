/**
 * conversation-capture.e2e.mjs — create a record from a conversation inbox
 * thread (Core BRD §16.4).
 *
 * Boots the real Express app, registers a WhatsApp channel account, ingests
 * inbound messages, then turns a thread into a contact: target-object fallback
 * from the match rule, identifier prefill, duplicate blocking, the
 * already-linked guard, permission checks and tenant isolation.
 *
 * Run: node tests/conversation-capture.e2e.mjs   (from backend/)
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
import FieldMeta from '../models/FieldMeta.js';
import DynamicRecord from '../models/DynamicRecord.js';
import ChannelAccount from '../models/ChannelAccount.js';
import Conversation from '../models/Conversation.js';
import Message from '../models/Message.js';
import DuplicateRule from '../models/DuplicateRule.js';
import Activity from '../models/Activity.js';
import AuditLog from '../models/AuditLog.js';
import { seedDefaultRoles } from '../services/roleService.js';
import Workspace from '../models/Workspace.js';
import { seedWorkspace } from './helpers/workspace.mjs';

const RUN = Date.now().toString(36);
const PASSWORD = 'Capture123!';

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

const makeUser = (tenantId, roleId, tag) =>
  User.create({
    tenantId, firstName: tag, lastName: 'User', email: `${tag}-${RUN}@example.com`,
    username: `${tag}_${RUN}`, password: PASSWORD, role: roleId, status: 'active', emailVerified: true,
  });

let tenantAId = null;
let tenantBId = null;

try {
  await connectDB();

  const tenantA = await Tenant.create({ name: `ZZ_CAP_${RUN}`, slug: `zz-cap-${RUN}`, status: 'active', plan: 'enterprise' });
  tenantAId = tenantA._id;
  await seedDefaultRoles(tenantAId);
  const roleAdmin = await Role.findOne({ tenantId: tenantAId, name: 'admin' });
  const roleStd = await Role.findOne({ tenantId: tenantAId, name: 'standard_user' });
  const roleRead = await Role.findOne({ tenantId: tenantAId, name: 'read_only' });

  const admin = await User.create({
    tenantId: tenantAId, firstName: 'Cap', lastName: 'Admin', email: `capadmin-${RUN}@example.com`,
    username: `capadmin_${RUN}`, password: PASSWORD, role: roleAdmin._id, status: 'active', emailVerified: true,
  });
  const agent = await User.create({
    tenantId: tenantAId, firstName: 'Cap', lastName: 'Agent', email: `capagent-${RUN}@example.com`,
    username: `capagent_${RUN}`, password: PASSWORD, role: roleStd._id, status: 'active', emailVerified: true,
  });
  const viewer = await User.create({
    tenantId: tenantAId, firstName: 'Cap', lastName: 'Viewer', email: `capviewer-${RUN}@example.com`,
    username: `capviewer_${RUN}`, password: PASSWORD, role: roleRead._id, status: 'active', emailVerified: true,
  });
  const cookieAdmin = await loginCookie(admin.email);
  const cookieAgent = await loginCookie(agent.email);
  const cookieViewer = await loginCookie(viewer.email);
  check('users can log in', Boolean(cookieAdmin && cookieAgent && cookieViewer));

  const contactObj = await ObjectMeta.create({
    tenantId: tenantAId, name: 'Contact', label: 'Contact', pluralLabel: 'Contacts',
    apiName: 'contact', nameFieldApiName: 'name', isActive: true, searchable: true,
  });
  for (const [apiName, type] of [['name', 'text'], ['phone', 'phone'], ['email', 'email']]) {
    await FieldMeta.create({ tenantId: tenantAId, objectId: contactObj._id, objectApiName: 'contact', name: apiName, label: apiName, apiName, type });
  }

  await seedWorkspace(tenantAId, [admin._id, agent._id, viewer._id], ['contact']);

  // Existing contact whose email will collide with the duplicate gate.
  await req('/api/v1/records/contact', {
    method: 'POST', cookie: cookieAdmin, body: { name: 'Existing', email: 'dup@x.com' },
  });
  const rule = await req('/api/v1/duplicate-rules', {
    method: 'POST', cookie: cookieAdmin,
    body: { name: 'Email', objectApiName: 'contact', logic: 'AND', onMatch: 'block', conditions: [{ field: 'email', matchType: 'normalized' }] },
  });
  check('a duplicate rule is configured', rule.status === 201, `HTTP ${rule.status}`);

  const account = await req('/api/v1/channels', {
    method: 'POST', cookie: cookieAdmin,
    body: {
      channel: 'whatsapp', name: 'Leads WA', provider: 'meta', webhookSecret: 'cc-secret',
      matchRules: [{ objectApiName: 'contact', fieldApiName: 'phone', kind: 'phone' }],
    },
  });
  const accountId = account.json?.data?._id;
  check('a channel account is registered', account.status === 201, `HTTP ${account.status}`);

  const hook = (payload) => signedPost(`/api/v1/channels/webhook/whatsapp/${accountId}`, 'cc-secret', payload);
  const inbound = (identifier, id) => ({
    kind: 'message', externalThreadId: `thread-${id}`, externalMessageId: id,
    from: { name: 'New Lead', identifier }, body: 'Hello',
  });

  // ── Create from an unmatched inbound thread ─────────────────────────────
  const ok1 = await hook(inbound('+27830000001', 'cc-m1'));
  const conv1 = ok1.json?.data?.conversation?._id;
  check('an inbound message opens a thread', ok1.status === 202 && Boolean(conv1), `HTTP ${ok1.status}`);
  check('an unknown sender opens an unlinked thread', !ok1.json?.data?.conversation?.linkedRecord, `linked=${ok1.json?.data?.conversation?.linkedRecord}`);

  const made = await req(`/api/v1/conversations/${conv1}/create-record`, { method: 'POST', cookie: cookieAgent, body: {} });
  check('an agent can create a record from the conversation', made.status === 201, `HTTP ${made.status}`);
  const madeObjName = made.json?.data?.objectApiName;
  check('the target object falls back to the match rule object', madeObjName === 'contact', `object=${madeObjName}`);
  check('the contact identifier prefills the record', made.json?.data?.record?.phone === '27830000001', `phone=${made.json?.data?.record?.phone}`);

  const createdRecord = await DynamicRecord.findOne({ _id: made.json?.data?.record?.id, tenantId: tenantAId });
  check('the record is persisted with the prefilled field', createdRecord?.data?.get('phone') === '27830000001', `phone=${createdRecord?.data?.get('phone')}`);

  const conv1Doc = await Conversation.findById(conv1);
  check('the conversation is linked to the new record', conv1Doc?.linkedRecord?.objectApiName === 'contact' && String(conv1Doc?.linkedRecord?.recordId) === String(made.json?.data?.record?.id), `linked=${conv1Doc?.linkedRecord?.objectApiName}`);

  const again = await req(`/api/v1/conversations/${conv1}/create-record`, { method: 'POST', cookie: cookieAgent, body: {} });
  check('a conversation cannot be converted twice', again.status === 409, `HTTP ${again.status}`);

  // ── Duplicate gate ──────────────────────────────────────────────────────
  const ok2 = await hook(inbound('+27830000002', 'cc-m2'));
  const conv2 = ok2.json?.data?.conversation?._id;
  const blocked = await req(`/api/v1/conversations/${conv2}/create-record`, {
    method: 'POST', cookie: cookieAgent, body: { data: { email: 'dup@x.com' } },
  });
  check('a colliding email is blocked by the duplicate rule', blocked.status === 409 && Array.isArray(blocked.json?.duplicates), `HTTP ${blocked.status}`);

  const viewerMade = await req(`/api/v1/conversations/${conv2}/create-record`, { method: 'POST', cookie: cookieViewer, body: {} });
  check('a user without create permission is refused', viewerMade.status === 403, `HTTP ${viewerMade.status}`);

  // ── Tenant isolation ────────────────────────────────────────────────────
  const tenantB = await Tenant.create({ name: `ZZ_CAP_B_${RUN}`, slug: `zz-cap-b-${RUN}`, status: 'active', plan: 'enterprise' });
  tenantBId = tenantB._id;
  await seedDefaultRoles(tenantBId);
  const roleAdminB = await Role.findOne({ tenantId: tenantBId, name: 'admin' });
  const adminB = await User.create({
    tenantId: tenantBId, firstName: 'Cap', lastName: 'B', email: `capb-${RUN}@example.com`,
    username: `capb_${RUN}`, password: PASSWORD, role: roleAdminB._id, status: 'active', emailVerified: true,
  });
  const cookieAdminB = await loginCookie(adminB.email);
  const cross = await req(`/api/v1/conversations/${conv1}/create-record`, { method: 'POST', cookie: cookieAdminB, body: {} });
  check('a conversation from another tenant is not visible', cross.status === 404, `HTTP ${cross.status}`);
} catch (err) {
  check('test harness ran without error', false, err.message);
} finally {
  const ids = [tenantAId, tenantBId].filter(Boolean);
  if (ids.length) {
    await Tenant.deleteMany({ _id: { $in: ids } });
    const cleanup = [
      User, Role, Session, ObjectMeta, FieldMeta, DynamicRecord, AuditLog,
      ChannelAccount, Conversation, Message, Activity, DuplicateRule, Workspace,
    ];
    await Promise.all(cleanup.map((M) => M.deleteMany({ tenantId: { $in: ids } }).catch(() => {})));
  }
  server.close();
  await mongoose.connection.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
