/**
 * omnichannel.e2e.mjs - omnichannel inbox, channel abstraction, messaging
 * templates and inbound ingestion (Core BRD 16).
 *
 * Boots the real Express app and exercises: channel account management (with
 * secret redaction), webhook signature enforcement, inbound WhatsApp ingestion
 * with record matching and dedupe, inbox assignment/transfer/status, consent-
 * gated replies, internal notes, messaging templates + merge fields, inbound
 * call logging to the Activity framework, and tenant isolation.
 *
 * Run: node tests/omnichannel.e2e.mjs   (from backend/)
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
import Conversation from '../models/Conversation.js';
import Message from '../models/Message.js';
import MessageTemplate from '../models/MessageTemplate.js';
import Activity from '../models/Activity.js';
import TenantConfiguration from '../models/TenantConfiguration.js';
import Consent from '../models/Consent.js';
import { seedDefaultRoles } from '../services/roleService.js';
import consentService from '../services/consentService.js';

const RUN = Date.now().toString(36);
const PASSWORD = 'Omni123!';

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

// Signed webhook post: signature is HMAC-SHA256 over the exact body bytes.
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

  const tenantA = await Tenant.create({ name: `ZZ_OMNI_${RUN}`, slug: `zz-omni-${RUN}`, status: 'active', plan: 'enterprise' });
  tenantAId = tenantA._id;
  await seedDefaultRoles(tenantAId);
  const roleAdmin = await Role.findOne({ tenantId: tenantAId, name: 'admin' });
  const roleStd = await Role.findOne({ tenantId: tenantAId, name: 'standard_user' });

  const makeUser = (tenantId, roleId, tag) =>
    User.create({
      tenantId, firstName: tag, lastName: 'User', email: `${tag}-${RUN}@example.com`,
      username: `${tag}_${RUN}`, password: PASSWORD, role: roleId, status: 'active', emailVerified: true,
    });

  const admin = await makeUser(tenantAId, roleAdmin._id, 'omniadmin');
  const agent = await makeUser(tenantAId, roleStd._id, 'omniagent');
  const agent2 = await makeUser(tenantAId, roleStd._id, 'omniagent2');
  const cookieAdmin = await loginCookie(admin.email);
  const cookieAgent = await loginCookie(agent.email);
  check('users can log in', Boolean(cookieAdmin && cookieAgent));

  // A contact object + one matching record (phone + email).
  const contactObj = await ObjectMeta.create({
    tenantId: tenantAId, name: 'Contact', label: 'Contact', pluralLabel: 'Contacts',
    apiName: 'contact', nameFieldApiName: 'name', isActive: true, searchable: true,
  });
  const contact = await DynamicRecord.create({
    tenantId: tenantAId, objectId: contactObj._id, objectApiName: 'contact',
    data: { name: 'Jane Client', phone: '+27821234567', email: 'jane@example.com' },
  });

  // ── Channel accounts ────────────────────────────────────────────────────
  const capRes = await req('/api/v1/channels/capabilities', { cookie: cookieAdmin });
  const waCap = (capRes.json?.data || []).find((c) => c.channel === 'whatsapp');
  check('the capabilities endpoint exposes channel support', capRes.status === 200 && waCap?.templates === true, `templates=${waCap?.templates}`);

  const provRes = await req('/api/v1/channels/providers', { cookie: cookieAdmin });
  const metaProv = (provRes.json?.data || []).find((p) => p.provider === 'meta');
  check('the provider catalog lists required credentials and normalizer support', provRes.status === 200 && metaProv?.requiredCredentials?.includes('phoneNumberId') && metaProv?.inboundNormalizer === true, `creds=${metaProv?.requiredCredentials}`);

  const waCreate = await req('/api/v1/channels', {
    method: 'POST', cookie: cookieAdmin,
    body: {
      channel: 'whatsapp', name: 'Support WA', provider: 'meta',
      webhookSecret: 'wa-secret', credentials: { accessToken: 'tok' },
      matchRules: [{ objectApiName: 'contact', fieldApiName: 'phone', kind: 'phone' }],
    },
  });
  const waId = waCreate.json?.data?._id;
  check('an admin can register a channel account', waCreate.status === 201, `HTTP ${waCreate.status}`);
  check('provider secrets are never returned', !('webhookSecret' in (waCreate.json?.data || {})) && !('credentials' in (waCreate.json?.data || {})), `keys=${Object.keys(waCreate.json?.data || {}).join(',')}`);

  const validateWa = await req(`/api/v1/channels/${waId}/validate`, { method: 'POST', cookie: cookieAdmin });
  check('provider config validation reports missing credentials', validateWa.status === 200 && validateWa.json?.data?.valid === false && (validateWa.json?.data?.missing || []).includes('phoneNumberId'), `missing=${(validateWa.json?.data?.missing || []).join(',')}`);

  const stdCreate = await req('/api/v1/channels', {
    method: 'POST', cookie: cookieAgent,
    body: { channel: 'whatsapp', name: 'Nope', matchRules: [] },
  });
  check('a standard user cannot register a channel account', stdCreate.status === 403, `HTTP ${stdCreate.status}`);

  // Telephony account for call ingestion (18.3).
  const telCreate = await req('/api/v1/channels', {
    method: 'POST', cookie: cookieAdmin,
    body: {
      channel: 'telephony', name: 'Main Line', provider: 'euphoria', webhookSecret: 'tel-secret',
      matchRules: [{ objectApiName: 'contact', fieldApiName: 'phone', kind: 'phone' }],
    },
  });
  const telId = telCreate.json?.data?._id;
  check('a telephony channel account can be registered', telCreate.status === 201, `HTTP ${telCreate.status}`);

  // ── Webhook signature enforcement ───────────────────────────────────────
  const inbound = {
    kind: 'message', externalThreadId: 'wa-thread-1', externalMessageId: 'wa-msg-1',
    from: { name: 'Jane Client', identifier: '27821234567' }, body: 'Hi, is my claim approved?',
  };
  const noSig = await req(`/api/v1/channels/webhook/whatsapp/${waId}`, { method: 'POST', body: inbound });
  check('an unsigned webhook is rejected', noSig.status === 401, `HTTP ${noSig.status}`);
  const badSig = await signedPost(`/api/v1/channels/webhook/whatsapp/${waId}`, 'wrong-secret', inbound);
  check('a wrongly signed webhook is rejected', badSig.status === 401, `HTTP ${badSig.status}`);

  // ── Inbound message ingestion ───────────────────────────────────────────
  const ok1 = await signedPost(`/api/v1/channels/webhook/whatsapp/${waId}`, 'wa-secret', inbound);
  check('a signed inbound message is accepted', ok1.status === 202 && ok1.json?.data?.duplicate === false, `HTTP ${ok1.status}`);
  const convId = ok1.json?.data?.conversation?._id;
  check('the message is matched to the existing contact', String(ok1.json?.data?.conversation?.linkedRecord?.recordId) === String(contact._id), `recordId=${ok1.json?.data?.conversation?.linkedRecord?.recordId}`);

  const dup = await signedPost(`/api/v1/channels/webhook/whatsapp/${waId}`, 'wa-secret', inbound);
  const msgCount = await Message.countDocuments({ tenantId: tenantAId, externalMessageId: 'wa-msg-1' });
  check('a repeated inbound message is de-duplicated', dup.json?.data?.duplicate === true && msgCount === 1, `count=${msgCount}`);

  // ── Inbox operations ────────────────────────────────────────────────────
  const list = await req('/api/v1/conversations?status=open', { cookie: cookieAgent });
  check('the inbox lists open conversations', list.status === 200 && list.json?.data?.length === 1, `count=${list.json?.data?.length}`);
  const unassigned = await req('/api/v1/conversations?assigned=unassigned', { cookie: cookieAgent });
  check('the inbox can filter unassigned conversations', unassigned.json?.data?.length === 1, `count=${unassigned.json?.data?.length}`);

  // ── Real provider payload normalization (§16.1) ─────────────────────────
  const metaPayload = {
    object: 'whatsapp_business_account',
    entry: [{ id: '123', changes: [{ field: 'messages', value: {
      messaging_product: 'whatsapp',
      metadata: { display_phone_number: '27110000000', phone_number_id: 'pn1' },
      contacts: [{ profile: { name: 'Meta User' }, wa_id: '27829998888' }],
      messages: [{ from: '27829998888', id: 'wamid.TEST1', timestamp: '1700000000', type: 'text', text: { body: 'Hello via Meta' } }],
      statuses: [{ id: 'wamid.TEST1', status: 'delivered', timestamp: '1700000001', recipient_id: '27829998888' }],
    } }] }],
  };
  const okMeta = await signedPost(`/api/v1/channels/webhook/whatsapp/${waId}`, 'wa-secret', metaPayload);
  check('a provider-shaped Meta payload is normalized and ingested', okMeta.status === 202 && okMeta.json?.data?.accepted === 2, `accepted=${okMeta.json?.data?.accepted}`);
  const metaMsg = await Message.findOne({ tenantId: tenantAId, externalMessageId: 'wamid.TEST1' });
  check('the normalized message is stored and its status event applied', Boolean(metaMsg) && metaMsg.status === 'delivered', `status=${metaMsg?.status}`);
  const metaConv = metaMsg ? await Conversation.findById(metaMsg.conversationId) : null;
  check('the normalized contact name is captured', metaConv?.contactName === 'Meta User', `name=${metaConv?.contactName}`);

  const accept = await req(`/api/v1/conversations/${convId}/assign`, { method: 'POST', cookie: cookieAgent, body: {} });
  check('an agent can accept a conversation', String(accept.json?.data?.assignedTo?._id || accept.json?.data?.assignedTo) === String(agent._id), `assignedTo=${accept.json?.data?.assignedTo}`);
  const transfer = await req(`/api/v1/conversations/${convId}/assign`, { method: 'POST', cookie: cookieAgent, body: { userId: String(agent2._id) } });
  check('a conversation can be transferred to another agent', String(transfer.json?.data?.assignedTo?._id || transfer.json?.data?.assignedTo) === String(agent2._id), `assignedTo=${transfer.json?.data?.assignedTo}`);

  const messages = await req(`/api/v1/conversations/${convId}/messages`, { cookie: cookieAgent });
  check('conversation history is returned', messages.status === 200 && messages.json?.data?.length === 1, `count=${messages.json?.data?.length}`);

  // ── Outbound reply (provider not configured) ────────────────────────────
  const reply1 = await req(`/api/v1/conversations/${convId}/reply`, { method: 'POST', cookie: cookieAgent, body: { body: 'Let me check for you.' } });
  check('a reply is queued, not falsely marked sent, until the provider is wired', reply1.status === 201 && reply1.json?.data?.status === 'queued' && ['not_configured', 'pending_integration'].includes(reply1.json?.data?.providerStatus), `status=${reply1.json?.data?.status}/${reply1.json?.data?.providerStatus}`);

  // ── Consent-gated replies (16.6) ────────────────────────────────────────
  await TenantConfiguration.create({ tenantId: tenantAId, key: 'consent.enforcement', value: true, dataType: 'boolean', category: 'Consent' });
  await consentService.updateConsent({ tenantId: tenantAId, subjectType: 'contact', subjectId: contact._id, channels: { whatsapp: false }, source: 'test' });
  const blocked = await req(`/api/v1/conversations/${convId}/reply`, { method: 'POST', cookie: cookieAgent, body: { body: 'Follow up' } });
  check('a reply is blocked when consent is withdrawn and enforcement is on', blocked.status === 403, `HTTP ${blocked.status}`);

  await consentService.updateConsent({ tenantId: tenantAId, subjectType: 'contact', subjectId: contact._id, channels: { whatsapp: true }, source: 'test' });
  const allowed = await req(`/api/v1/conversations/${convId}/reply`, { method: 'POST', cookie: cookieAgent, body: { body: 'Following up now' } });
  check('a reply proceeds once consent is granted', allowed.status === 201, `HTTP ${allowed.status}`);

  // ── Internal notes & status ─────────────────────────────────────────────
  const note = await req(`/api/v1/conversations/${convId}/notes`, { method: 'POST', cookie: cookieAgent, body: { body: 'Internal: check policy' } });
  check('an internal note is recorded and flagged internal', note.status === 201 && note.json?.data?.isInternalNote === true, `internal=${note.json?.data?.isInternalNote}`);

  const closed = await req(`/api/v1/conversations/${convId}/status`, { method: 'POST', cookie: cookieAgent, body: { status: 'closed' } });
  check('a conversation can be closed', closed.status === 200 && closed.json?.data?.status === 'closed', `status=${closed.json?.data?.status}`);
  const replyClosed = await req(`/api/v1/conversations/${convId}/reply`, { method: 'POST', cookie: cookieAgent, body: { body: 'again' } });
  check('a closed conversation must be reopened before replying', replyClosed.status === 409, `HTTP ${replyClosed.status}`);
  const reopened = await req(`/api/v1/conversations/${convId}/status`, { method: 'POST', cookie: cookieAgent, body: { status: 'open' } });
  check('a conversation can be reopened', reopened.status === 200 && reopened.json?.data?.status === 'open', `status=${reopened.json?.data?.status}`);

  // ── Link / unlink ───────────────────────────────────────────────────────
  const unlinked = await req(`/api/v1/conversations/${convId}/link`, { method: 'POST', cookie: cookieAgent, body: {} });
  check('a conversation record link can be cleared', unlinked.json?.data?.linkedRecord == null, `linked=${unlinked.json?.data?.linkedRecord}`);
  const relinked = await req(`/api/v1/conversations/${convId}/link`, { method: 'POST', cookie: cookieAgent, body: { objectApiName: 'contact', recordId: String(contact._id) } });
  check('a conversation can be linked to a record', relinked.json?.data?.linkedRecord?.objectApiName === 'contact', `object=${relinked.json?.data?.linkedRecord?.objectApiName}`);

  // ── Messaging templates (16.5) ──────────────────────────────────────────
  const tplCreate = await req('/api/v1/message-templates', {
    method: 'POST', cookie: cookieAdmin,
    body: { name: 'Claim Update', channel: 'whatsapp', body: 'Hi {{contact.name}}, claim {{claim.number}} is {{claim.status}}.', language: 'en' },
  });
  const tplId = tplCreate.json?.data?._id;
  check('an admin can create a messaging template', tplCreate.status === 201, `HTTP ${tplCreate.status}`);

  const tplStd = await req('/api/v1/message-templates', { method: 'POST', cookie: cookieAgent, body: { name: 'Nope', channel: 'sms', body: 'x' } });
  check('a standard user cannot create a template', tplStd.status === 403, `HTTP ${tplStd.status}`);

  const preview = await req(`/api/v1/message-templates/${tplId}/preview`, {
    method: 'POST', cookie: cookieAgent,
    body: { values: { contact: { name: 'Jane' }, claim: { number: 'C-1', status: 'approved' } } },
  });
  check('template merge fields resolve', preview.json?.data?.body === 'Hi Jane, claim C-1 is approved.', `body=${preview.json?.data?.body}`);

  const tplList = await req('/api/v1/message-templates?channel=whatsapp', { cookie: cookieAgent });
  check('templates are listed per channel', tplList.json?.data?.length === 1, `count=${tplList.json?.data?.length}`);

  // ── Inbound call logging (18.3) ─────────────────────────────────────────
  const call = await signedPost(`/api/v1/channels/webhook/telephony/${telId}`, 'tel-secret', {
    kind: 'call', externalMessageId: 'call-1', direction: 'inbound', number: '+27821234567',
    agentEmail: 'agent@example.com', startedAt: new Date(Date.now() - 120000).toISOString(), endedAt: new Date().toISOString(),
    durationSeconds: 120, status: 'completed', callReference: 'ref-1', recordingUrl: 'https://rec.example.com/1',
  });
  check('a call webhook is accepted', call.status === 202, `HTTP ${call.status}`);
  const callActivity = await Activity.findOne({ tenantId: tenantAId, type: 'call', recordId: contact._id });
  check('the call is logged against the matched record', Boolean(callActivity), `found=${Boolean(callActivity)}`);
  check('the call log captures duration and recording link', callActivity?.metadata?.durationSeconds === 120 && callActivity?.metadata?.recordingUrl === 'https://rec.example.com/1', `duration=${callActivity?.metadata?.durationSeconds}`);

  // ── Telephony provider readiness (§18.5) ────────────────────────────────
  const telProviders = await req('/api/v1/telephony/providers', { cookie: cookieAgent });
  check('the telephony provider catalog is exposed', telProviders.status === 200 && telProviders.json?.data?.some((p) => p.provider === 'euphoria' && p.callControlImplemented === false), `providers=${(telProviders.json?.data || []).map((p) => p.provider).join(',')}`);
  const dialRes = await req('/api/v1/telephony/calls', { method: 'POST', cookie: cookieAgent, body: { provider: 'euphoria', to: '+27821234567' } });
  check('outbound call control declines explicitly until a provider is wired', dialRes.status === 501, `HTTP ${dialRes.status}`);

  // ── Inactive account & isolation ────────────────────────────────────────
  await ChannelAccount.updateOne({ _id: waId }, { $set: { isActive: false } });
  const inactive = await signedPost(`/api/v1/channels/webhook/whatsapp/${waId}`, 'wa-secret', inbound);
  check('an inactive channel account rejects webhooks', inactive.status === 403, `HTTP ${inactive.status}`);

  const tenantB = await Tenant.create({ name: `ZZ_OMNI_B_${RUN}`, slug: `zz-omni-b-${RUN}`, status: 'active', plan: 'enterprise' });
  tenantBId = tenantB._id;
  await seedDefaultRoles(tenantBId);
  const roleAdminB = await Role.findOne({ tenantId: tenantBId, name: 'admin' });
  const adminB = await makeUser(tenantBId, roleAdminB._id, 'omniadminb');
  const cookieAdminB = await loginCookie(adminB.email);

  const accountsB = await req('/api/v1/channels', { cookie: cookieAdminB });
  const convsB = await req('/api/v1/conversations', { cookie: cookieAdminB });
  check('channel accounts are scoped to their tenant', accountsB.json?.data?.length === 0, `count=${accountsB.json?.data?.length}`);
  check('conversations are scoped to their tenant', convsB.json?.data?.length === 0, `count=${convsB.json?.data?.length}`);
} catch (err) {
  check('test harness ran without error', false, err.message);
} finally {
  const ids = [tenantAId, tenantBId].filter(Boolean);
  if (ids.length) {
    await Tenant.deleteMany({ _id: { $in: ids } });
    const cleanup = [
      User, Role, Session, ObjectMeta, DynamicRecord, ChannelAccount, Conversation,
      Message, MessageTemplate, Activity, TenantConfiguration, Consent,
    ];
    await Promise.all(cleanup.map((M) => M.deleteMany({ tenantId: { $in: ids } }).catch(() => {})));
  }
  server.close();
  await mongoose.connection.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
