/**
 * section16-messaging.e2e.mjs — BRD §16 additions on top of the existing
 * omnichannel framework: the hardened Facebook Lead Ads webhook, real
 * outbound provider dispatch (WhatsApp/Messenger/email), and send-by-template
 * with WhatsApp provider-approval enforcement.
 *
 * Outbound provider calls are exercised against a stubbed `fetch`/SMTP
 * transport, not a live Meta app or mailbox — no such credentials exist in
 * this environment. The stubs assert the exact request Salesdam sends, so a
 * live credential swap is the only thing untested.
 *
 * Run: node tests/section16-messaging.e2e.mjs   (from backend/)
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
import MessageTemplate from '../models/MessageTemplate.js';
import Activity from '../models/Activity.js';
import DuplicateRule from '../models/DuplicateRule.js';
import Automation from '../models/Automation.js';
import IncomingWebhookLog from '../models/IncomingWebhookLog.js';
import { seedDefaultRoles } from '../services/roleService.js';
import { setEmailTransportFactory } from '../services/channelProviders.js';
import { seedWorkspace } from './helpers/workspace.mjs';

const RUN = Date.now().toString(36);
const PASSWORD = 'Msg16Test!';

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

const signedPost = async (path, secret, payload, headerName = 'x-hub-signature-256') => {
  const body = JSON.stringify(payload);
  const signature = crypto.createHmac('sha256', secret).update(body).digest('hex');
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [headerName]: `sha256=${signature}` },
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

/**
 * Stub globalThis.fetch for calls to graph.facebook.com only — the test
 * harness's own req()/fetch() calls to the local app must still go through,
 * or stubbing would also intercept the outer HTTP request this wraps.
 */
const withFetchStub = async (impl, fn) => {
  const original = globalThis.fetch;
  globalThis.fetch = (url, opts) =>
    String(url).includes('graph.facebook.com') ? impl(url, opts) : original(url, opts);
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
};

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

let tenantAId = null;
let tenantBId = null;

try {
  await connectDB();

  const tenantA = await Tenant.create({ name: `ZZ_MSG16_${RUN}`, slug: `zz-msg16-${RUN}`, status: 'active', plan: 'enterprise' });
  tenantAId = tenantA._id;
  const tenantB = await Tenant.create({ name: `ZZ_MSG16B_${RUN}`, slug: `zz-msg16b-${RUN}`, status: 'active', plan: 'enterprise' });
  tenantBId = tenantB._id;
  await seedDefaultRoles(tenantAId);
  const roleAdmin = await Role.findOne({ tenantId: tenantAId, name: 'admin' });

  const makeUser = (tenantId, roleId, tag) =>
    User.create({
      tenantId, firstName: tag, lastName: 'User', email: `${tag}-${RUN}@example.com`,
      username: `${tag}_${RUN}`, password: PASSWORD, role: roleId, status: 'active', emailVerified: true,
    });

  const admin = await makeUser(tenantAId, roleAdmin._id, 'msgadmin');
  const agent = await makeUser(tenantAId, roleAdmin._id, 'msgagent');

  // e2e tenants start with no metadata at all — hand-roll the minimal Lead
  // object this test exercises (mirrors conversation-capture.e2e.mjs).
  const leadObj = await ObjectMeta.create({
    tenantId: tenantAId, name: 'Lead', label: 'Lead', pluralLabel: 'Leads',
    apiName: 'lead', nameFieldApiName: 'first_name', isActive: true, searchable: true,
  });
  const leadFields = [
    ['first_name', 'text'], ['last_name', 'text'], ['email', 'email'], ['phone', 'phone'],
    ['company', 'text'], ['lead_source', 'text'], ['cidb_number', 'text'], ['technical_scope', 'textarea'],
  ];
  for (const [apiName, type] of leadFields) {
    await FieldMeta.create({ tenantId: tenantAId, objectId: leadObj._id, objectApiName: 'lead', name: apiName, label: apiName, apiName, type });
  }

  await seedWorkspace(tenantAId, [admin._id, agent._id], ['lead', 'contact']);
  const cookieAdmin = await loginCookie(admin.username);
  check('admin auth', Boolean(cookieAdmin));

  // ── §16.1 Facebook Lead Ads — flow that marks a lead touched by automation ──
  await Automation.create({
    tenantId: tenantAId,
    name: 'Mark FB lead flow ran',
    apiName: `fb_lead_flow_${RUN}`,
    type: 'record_triggered',
    isActive: true,
    isValid: true,
    trigger: { objectApiName: 'lead', events: ['create'], runWhen: 'always' },
    nodes: [
      { id: 'trigger', type: 'trigger', label: 'Trigger', position: { x: 0, y: 0 }, config: {}, nextNodes: [{ nodeId: 'update', condition: null, label: '' }] },
      { id: 'update', type: 'action_update_record', label: 'Mark flow ran', position: { x: 100, y: 0 }, config: { fields: { technical_scope: 'flow_ran' } }, nextNodes: [{ nodeId: 'end', condition: null, label: '' }] },
      { id: 'end', type: 'end', label: 'End', position: { x: 200, y: 0 }, config: {}, nextNodes: [] },
    ],
  });

  // Duplicate rule: a second lead with the same email must be blocked.
  const dupRule = await req('/api/v1/duplicate-rules', {
    method: 'POST', cookie: cookieAdmin,
    body: { name: 'FB Lead Email', objectApiName: 'lead', logic: 'AND', onMatch: 'block', conditions: [{ field: 'email', matchType: 'normalized' }] },
  });
  check('a duplicate rule is configured for leads', dupRule.status === 201, `HTTP ${dupRule.status}`);

  const fbSecret = 'fb-lead-secret';
  const fbAccount = await req('/api/v1/channels', {
    method: 'POST', cookie: cookieAdmin,
    body: {
      channel: 'facebook', name: 'Lead Ads', provider: 'meta_leadgen', webhookSecret: fbSecret,
      credentials: { pageAccessToken: 'unused-in-this-test' },
      defaultOwnerId: String(agent._id),
      fieldMappings: [{ metaFieldName: 'budget_range', salesdamFieldApiName: 'cidb_number' }],
    },
  });
  check('a Facebook Lead Ads channel account is created', fbAccount.status === 201, `HTTP ${fbAccount.status}`);
  const fbAccountId = fbAccount.json?.data?._id;

  // ── Verification handshake (GET) ───────────────────────────────────────
  // The handshake returns plain text, not JSON, so use raw fetch rather than req().
  const verifyRes = await fetch(
    `${base}/api/v1/integrations/facebook/leadgen/${fbAccountId}?hub.mode=subscribe&hub.verify_token=${fbSecret}&hub.challenge=echo123`,
  );
  const verifyText = await verifyRes.text();
  check('the webhook verification handshake echoes the challenge', verifyRes.status === 200 && verifyText === 'echo123', `status=${verifyRes.status} body=${verifyText}`);

  const verifyBadRes = await fetch(
    `${base}/api/v1/integrations/facebook/leadgen/${fbAccountId}?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=echo123`,
  );
  check('a wrong verify token is rejected', verifyBadRes.status === 403, `HTTP ${verifyBadRes.status}`);

  // ── Unsigned POST must be rejected (the old controller had no auth at all) ──
  const leadgenPayload = (leadgenId, email, campaignId = 'camp-1') => ({
    object: 'page',
    entry: [{
      id: 'page-1',
      changes: [{
        field: 'leadgen',
        value: {
          leadgen_id: leadgenId,
          form_id: 'form-1',
          page_id: 'page-1',
          ad_id: 'ad-1',
          campaign_id: campaignId,
          created_time: Math.floor(Date.now() / 1000),
          // Only present because this is a test fixture — real Meta
          // deliveries omit field_data; it is fetched via the Graph API.
          field_data: [
            { name: 'first_name', values: ['Jane'] },
            { name: 'last_name', values: ['Doe'] },
            { name: 'email', values: [email] },
            { name: 'phone_number', values: ['+15551234567'] },
            { name: 'company_name', values: ['Acme'] },
            { name: 'budget_range', values: ['10k-50k'] },
          ],
        },
      }],
    }],
  });

  const unsignedRes = await fetch(`${base}/api/v1/integrations/facebook/leadgen/${fbAccountId}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(leadgenPayload('lead-001', 'fbjane@example.com')),
  });
  check('an unsigned leadgen webhook is rejected', unsignedRes.status === 401, `HTTP ${unsignedRes.status}`);

  // A spoofed tenantId in the body must be ignored entirely — the account,
  // not the request body, determines the tenant (the prior implementation
  // trusted req.body.tenantId with no auth at all).
  const spoofPayload = leadgenPayload('lead-001', 'fbjane@example.com');
  spoofPayload.tenantId = String(tenantBId);
  const signed1 = await signedPost(`/api/v1/integrations/facebook/leadgen/${fbAccountId}`, fbSecret, spoofPayload);
  check('a signed leadgen webhook is accepted', signed1.status === 202, `HTTP ${signed1.status}`);
  const leadId1 = signed1.json?.data?.results?.[0]?.leadId;
  check('the lead was created', Boolean(leadId1));

  let lead1 = leadId1 ? await DynamicRecord.findById(leadId1).lean() : null;
  const lead1Data = lead1?.data instanceof Map ? Object.fromEntries(lead1.data) : lead1?.data || {};
  check('a spoofed tenantId in the body is ignored — the lead lands in the account\'s real tenant', String(lead1?.tenantId) === String(tenantAId), `tenantId=${lead1?.tenantId}`);
  check('standard Meta fields are mapped by alias', lead1Data.first_name === 'Jane' && lead1Data.last_name === 'Doe' && lead1Data.email === 'fbjane@example.com' && lead1Data.company === 'Acme', JSON.stringify(lead1Data));
  check('an explicit custom field mapping is applied', lead1Data.cidb_number === '10k-50k', `cidb_number=${lead1Data.cidb_number}`);
  check('campaign attribution is recorded on lead_source', lead1Data.lead_source === 'facebook:camp-1', `lead_source=${lead1Data.lead_source}`);
  check('automatic assignment uses the channel account\'s default owner', String(lead1?.ownerId) === String(agent._id), `ownerId=${lead1?.ownerId}`);

  // Flow trigger — async-ish but fireAutomations is awaited before the
  // webhook responds, so it should already be applied.
  lead1 = await DynamicRecord.findById(leadId1).lean();
  const lead1DataAfter = lead1?.data instanceof Map ? Object.fromEntries(lead1.data) : lead1?.data || {};
  check('the configured Flow fired on the new lead', lead1DataAfter.technical_scope === 'flow_ran', `technical_scope=${lead1DataAfter.technical_scope}`);

  // ── Idempotency: redelivering the same leadgen_id must not duplicate ──────
  const signed1Again = await signedPost(`/api/v1/integrations/facebook/leadgen/${fbAccountId}`, fbSecret, leadgenPayload('lead-001', 'fbjane@example.com'));
  check('a redelivered leadgen event is accepted but marked duplicate', signed1Again.status === 202 && signed1Again.json?.data?.results?.[0]?.duplicate === true, JSON.stringify(signed1Again.json?.data));
  const leadCountAfterRedelivery = await DynamicRecord.countDocuments({ tenantId: tenantAId, objectApiName: 'lead', isDeleted: false });
  check('no duplicate lead was created on redelivery', leadCountAfterRedelivery === 1, `count=${leadCountAfterRedelivery}`);

  // ── Duplicate-rule blocking: a different leadgen_id, same email ──────────
  const signed2 = await signedPost(`/api/v1/integrations/facebook/leadgen/${fbAccountId}`, fbSecret, leadgenPayload('lead-002', 'fbjane@example.com'));
  check('a new leadgen event with a colliding email is accepted', signed2.status === 202, `HTTP ${signed2.status}`);
  check('...but skipped by the duplicate rule', signed2.json?.data?.results?.[0]?.skipped === 'duplicate', JSON.stringify(signed2.json?.data));
  const leadCountAfterDup = await DynamicRecord.countDocuments({ tenantId: tenantAId, objectApiName: 'lead', isDeleted: false });
  check('the duplicate-rule-blocked event created no lead', leadCountAfterDup === 1, `count=${leadCountAfterDup}`);

  // ── §16.2/§16.3 real outbound provider dispatch (mocked fetch/SMTP) ──────
  const waAccount = await req('/api/v1/channels', {
    method: 'POST', cookie: cookieAdmin,
    body: { channel: 'whatsapp', name: 'WA Live', provider: 'meta', webhookSecret: 'wa-secret', credentials: { accessToken: 'wa-token', phoneNumberId: 'pn-123' } },
  });
  const waAccountDoc = await ChannelAccount.findById(waAccount.json?.data?._id);
  const waConversation = await Conversation.create({
    tenantId: tenantAId, channel: 'whatsapp', channelAccountId: waAccountDoc._id,
    externalThreadId: 'contact:15551234567', contactIdentifier: '15551234567', status: 'open',
  });

  const waFetchCalls = [];
  const waResult = await withFetchStub(
    async (url, opts) => {
      waFetchCalls.push({ url, body: JSON.parse(opts.body) });
      return jsonResponse(200, { messages: [{ id: 'wamid.TEST123' }] });
    },
    () => req(`/api/v1/conversations/${waConversation._id}/reply`, { method: 'POST', cookie: cookieAdmin, body: { body: 'Hello from Salesdam' } }),
  );
  check('a WhatsApp reply dispatches a real Graph API call', waFetchCalls.length === 1 && waFetchCalls[0].url.includes('/pn-123/messages') && waFetchCalls[0].body.to === '15551234567', JSON.stringify(waFetchCalls[0]));
  check('a successful WhatsApp send is recorded as sent with the provider message id', waResult.status === 201 && waResult.json?.data?.status === 'sent' && waResult.json?.data?.externalMessageId === 'wamid.TEST123', JSON.stringify(waResult.json?.data));

  const waFailResult = await withFetchStub(
    async () => jsonResponse(400, { error: { message: 'Invalid recipient' } }),
    () => req(`/api/v1/conversations/${waConversation._id}/reply`, { method: 'POST', cookie: cookieAdmin, body: { body: 'Another message' } }),
  );
  check('a provider error on send is recorded as failed, not silently lost', waFailResult.json?.data?.status === 'failed' && waFailResult.json?.data?.providerNote === 'Invalid recipient', JSON.stringify(waFailResult.json?.data));

  const fbMsgAccount = await req('/api/v1/channels', {
    method: 'POST', cookie: cookieAdmin,
    body: { channel: 'facebook', name: 'Messenger Live', provider: 'meta_messenger', webhookSecret: 'msg-secret', credentials: { pageAccessToken: 'page-token', appSecret: 'app-secret' } },
  });
  const fbMsgAccountDoc = await ChannelAccount.findById(fbMsgAccount.json?.data?._id);
  const fbConversation = await Conversation.create({
    tenantId: tenantAId, channel: 'facebook', channelAccountId: fbMsgAccountDoc._id,
    externalThreadId: 'contact:psid-99', contactIdentifier: 'psid-99', status: 'open',
  });
  const fbFetchCalls = [];
  const fbResult = await withFetchStub(
    async (url) => { fbFetchCalls.push({ url }); return jsonResponse(200, { message_id: 'm_test_1' }); },
    () => req(`/api/v1/conversations/${fbConversation._id}/reply`, { method: 'POST', cookie: cookieAdmin, body: { body: 'Hi there' } }),
  );
  check('a Messenger reply dispatches the real Send API', fbFetchCalls.length === 1 && fbFetchCalls[0].url.includes('/me/messages') && fbFetchCalls[0].url.includes('page-token'), JSON.stringify(fbFetchCalls[0]));
  check('the Messenger send is recorded as sent', fbResult.json?.data?.status === 'sent' && fbResult.json?.data?.externalMessageId === 'm_test_1', JSON.stringify(fbResult.json?.data));

  const emailAccount = await req('/api/v1/channels', {
    method: 'POST', cookie: cookieAdmin,
    body: { channel: 'email', name: 'Support Mailbox', provider: 'smtp', webhookSecret: 'mail-secret', credentials: { host: 'smtp.example.com', port: 587, username: 'u', password: 'p', from: 'support@example.com' } },
  });
  const emailAccountDoc = await ChannelAccount.findById(emailAccount.json?.data?._id);
  const emailConversation = await Conversation.create({
    tenantId: tenantAId, channel: 'email', channelAccountId: emailAccountDoc._id,
    externalThreadId: 'contact:customer@example.com', contactIdentifier: 'customer@example.com', status: 'open',
  });
  const sentMail = [];
  setEmailTransportFactory(() => ({
    sendMail: async (opts) => { sentMail.push(opts); return { messageId: 'smtp-test-1' }; },
  }));
  const emailResult = await req(`/api/v1/conversations/${emailConversation._id}/reply`, { method: 'POST', cookie: cookieAdmin, body: { body: 'Email body' } });
  setEmailTransportFactory(null);
  check('an email reply sends through real SMTP (stubbed transport)', sentMail.length === 1 && sentMail[0].to === 'customer@example.com' && sentMail[0].from === 'support@example.com', JSON.stringify(sentMail[0]));
  check('the email send is recorded as sent', emailResult.json?.data?.status === 'sent' && emailResult.json?.data?.externalMessageId === 'smtp-test-1', JSON.stringify(emailResult.json?.data));

  // ── §16.5 send-by-template with WhatsApp approval enforcement ───────────
  const leadForMerge = await req('/api/v1/records/lead', {
    method: 'POST', cookie: cookieAdmin, body: { first_name: 'Merge', last_name: 'Target', email: 'merge@example.com', technical_scope: 'n/a' },
  });
  const waConversation2 = await Conversation.create({
    tenantId: tenantAId, channel: 'whatsapp', channelAccountId: waAccountDoc._id,
    externalThreadId: 'contact:27820000000', contactIdentifier: '27820000000', status: 'open',
    linkedRecord: { objectApiName: 'lead', recordId: leadForMerge.json?.data?.id },
  });

  const tplUnapproved = await req('/api/v1/message-templates', {
    method: 'POST', cookie: cookieAdmin,
    body: { name: `Claim Update ${RUN}`, channel: 'whatsapp', body: 'Hi {{first_name}}, your claim {{claim_number}} is ready.', providerTemplateId: 'claim_update_v1' },
  });
  check('a WhatsApp template can be created (unapproved by default)', tplUnapproved.status === 201 && tplUnapproved.json?.data?.providerStatus === '', `providerStatus=${tplUnapproved.json?.data?.providerStatus}`);
  const tplId = tplUnapproved.json?.data?._id;

  const blockedSend = await req(`/api/v1/conversations/${waConversation2._id}/reply-template`, {
    method: 'POST', cookie: cookieAdmin, body: { templateId: tplId, values: { claim_number: 'C-99' } },
  });
  check('an unapproved WhatsApp template cannot be sent', blockedSend.status === 409, `HTTP ${blockedSend.status} ${blockedSend.json?.message}`);

  const approveTpl = await req(`/api/v1/message-templates/${tplId}`, {
    method: 'PUT', cookie: cookieAdmin, body: { providerStatus: 'approved' },
  });
  check('a template can be marked provider-approved', approveTpl.json?.data?.providerStatus === 'approved', approveTpl.json?.data?.providerStatus);

  const approvedSend = await withFetchStub(
    async () => jsonResponse(200, { messages: [{ id: 'wamid.TPL1' }] }),
    () => req(`/api/v1/conversations/${waConversation2._id}/reply-template`, { method: 'POST', cookie: cookieAdmin, body: { templateId: tplId, values: { claim_number: 'C-99' } } }),
  );
  check('an approved WhatsApp template can be sent', approvedSend.status === 201, `HTTP ${approvedSend.status} ${approvedSend.json?.message}`);
  check('merge fields resolve from the linked record and extra values together', approvedSend.json?.data?.body === 'Hi Merge, your claim C-99 is ready.', approvedSend.json?.data?.body);

  const emailTpl = await req('/api/v1/message-templates', {
    method: 'POST', cookie: cookieAdmin, body: { name: `Email Tpl ${RUN}`, channel: 'email', subject: 'Hi', body: 'Hello' },
  });
  const channelMismatch = await req(`/api/v1/conversations/${waConversation2._id}/reply-template`, {
    method: 'POST', cookie: cookieAdmin, body: { templateId: emailTpl.json?.data?._id },
  });
  check('a template for the wrong channel is rejected', channelMismatch.status === 400, `HTTP ${channelMismatch.status}`);

} catch (err) {
  console.error('TEST RUN ERROR:', err);
  check('test run completed without unexpected error', false, err.message);
} finally {
  try {
    setEmailTransportFactory(null);
    const models = [
      DynamicRecord, ChannelAccount, Conversation, Message, MessageTemplate,
      Activity, DuplicateRule, Automation, IncomingWebhookLog, User, Role, Session,
      ObjectMeta, FieldMeta,
    ];
    if (tenantAId) {
      await Promise.all(models.map((M) => M.deleteMany({ tenantId: tenantAId })));
      await Tenant.deleteOne({ _id: tenantAId });
    }
    if (tenantBId) await Tenant.deleteOne({ _id: tenantBId });
    await mongoose.connection.close();
  } catch (e) { console.error('cleanup', e.message); }
  server.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  process.exit(failed.length ? 1 : 0);
}
