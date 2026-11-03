/**
 * section16-finalisation.e2e.mjs — BRD §16 finalisation pass: Flow-triggered
 * email and WhatsApp-template messaging through the shared consent gate,
 * email send-from-record with record association, and the WhatsApp
 * provider-approval gate re-verified specifically against the Flow path
 * (not just the manual Inbox path, which section16-messaging.e2e.mjs covers).
 *
 * Run: node tests/section16-finalisation.e2e.mjs   (from backend/)
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
import ChannelAccount from '../models/ChannelAccount.js';
import Conversation from '../models/Conversation.js';
import Message from '../models/Message.js';
import MessageTemplate from '../models/MessageTemplate.js';
import EmailTemplate from '../models/EmailTemplate.js';
import Activity from '../models/Activity.js';
import Automation from '../models/Automation.js';
import TenantConfiguration from '../models/TenantConfiguration.js';
import Consent from '../models/Consent.js';
import consentService from '../services/consentService.js';
import { setEmailTransportFactory } from '../services/channelProviders.js';
import { seedDefaultRoles } from '../services/roleService.js';
import { seedWorkspace } from './helpers/workspace.mjs';

const RUN = Date.now().toString(36);
const PASSWORD = 'Final16Test!';

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

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Stub globalThis.fetch for graph.facebook.com only — everything else (the
 * test harness's own calls to the local app) passes through untouched. */
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
const jsonResponse = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

let tenantAId = null;

try {
  await connectDB();

  const tenantA = await Tenant.create({ name: `ZZ_FIN16_${RUN}`, slug: `zz-fin16-${RUN}`, status: 'active', plan: 'enterprise' });
  tenantAId = tenantA._id;
  await seedDefaultRoles(tenantAId);
  const roleAdmin = await Role.findOne({ tenantId: tenantAId, name: 'admin' });
  const admin = await User.create({
    tenantId: tenantAId, firstName: 'Fin', lastName: 'Admin', email: `finadmin-${RUN}@example.com`,
    username: `finadmin_${RUN}`, password: PASSWORD, role: roleAdmin._id, status: 'active', emailVerified: true,
  });

  const leadObj = await ObjectMeta.create({
    tenantId: tenantAId, name: 'Lead', label: 'Lead', pluralLabel: 'Leads',
    apiName: 'lead', nameFieldApiName: 'first_name', isActive: true, searchable: true,
  });
  for (const [apiName, type] of [['first_name', 'text'], ['last_name', 'text'], ['email', 'email'], ['phone', 'phone']]) {
    await FieldMeta.create({ tenantId: tenantAId, objectId: leadObj._id, objectApiName: 'lead', name: apiName, label: apiName, apiName, type });
  }
  await seedWorkspace(tenantAId, [admin._id], ['lead']);
  const cookieAdmin = await loginCookie(admin.email);
  check('admin auth', Boolean(cookieAdmin));

  // Consent enforcement on for this tenant throughout.
  await TenantConfiguration.create({ tenantId: tenantAId, key: 'consent.enforcement', value: true, dataType: 'boolean', category: 'Consent' });

  // A stub SMTP transport so email sends are real code paths, not live mail.
  const sentMail = [];
  setEmailTransportFactory(() => ({
    sendMail: async (opts) => { sentMail.push(opts); return { messageId: `stub-${sentMail.length}` }; },
  }));

  const emailAccount = await req('/api/v1/channels', {
    method: 'POST', cookie: cookieAdmin,
    body: { channel: 'email', name: 'Finalisation Mailbox', provider: 'smtp', webhookSecret: 'fin-mail-secret', credentials: { host: 'smtp.example.com', port: 587, username: 'u', password: 'p', from: 'noreply@example.com' } },
  });
  check('an email channel account is created', emailAccount.status === 201, `HTTP ${emailAccount.status}`);

  // ── §16.7 Direct send-from-record endpoint ───────────────────────────────
  const leadDirect = await req('/api/v1/records/lead', {
    method: 'POST', cookie: cookieAdmin, body: { first_name: 'Direct', last_name: 'Send', email: 'direct@example.com' },
  });
  const leadDirectId = leadDirect.json?.data?.id;
  check('a lead is created for the direct-send test', leadDirect.status === 201, `HTTP ${leadDirect.status}`);

  const missingFields = await req(`/api/v1/records/lead/${leadDirectId}/send-email`, {
    method: 'POST', cookie: cookieAdmin, body: { to: 'direct@example.com' },
  });
  check('sending without a template or subject/body is rejected', missingFields.status === 400, `HTTP ${missingFields.status}`);

  const directSend = await req(`/api/v1/records/lead/${leadDirectId}/send-email`, {
    method: 'POST', cookie: cookieAdmin, body: { to: 'direct@example.com', subject: 'Hi {first_name}', body: 'Hello {first_name} {last_name}' },
  });
  check('a direct send-email call succeeds', directSend.status === 201, `HTTP ${directSend.status} ${directSend.json?.message}`);
  check('merge fields resolve against the live record', sentMail.at(-1)?.subject === 'Hi Direct' && sentMail.at(-1)?.html === 'Hello Direct Send', JSON.stringify(sentMail.at(-1)));
  check('the send is reported honestly, not falsely "delivered"', directSend.json?.data?.message?.status === 'sent' || directSend.json?.data?.message?.status === 'queued', directSend.json?.data?.message?.status);

  const directConv = await Conversation.findOne({ tenantId: tenantAId, 'linkedRecord.recordId': leadDirectId });
  check('a Conversation was created and linked to the record', Boolean(directConv), 'no conversation found');
  const directActivity = await Activity.findOne({ tenantId: tenantAId, objectApiName: 'lead', recordId: leadDirectId, type: 'email' });
  check('the send is recorded in the Activity/history framework (§16.7)', Boolean(directActivity), 'no Activity found');

  // ── §16.7 EmailTemplate-based send, with the real template content ──────
  const emailTpl = await EmailTemplate.create({
    tenantId: tenantAId, name: 'Welcome', subject: 'Welcome {first_name}!', bodyText: 'Hi {first_name}, thanks for joining.', createdBy: admin._id,
  });
  const tplSend = await req(`/api/v1/records/lead/${leadDirectId}/send-email`, {
    method: 'POST', cookie: cookieAdmin, body: { to: 'direct@example.com', templateId: String(emailTpl._id) },
  });
  check('a template-based send-email call succeeds', tplSend.status === 201, `HTTP ${tplSend.status}`);
  check('the EmailTemplate content is rendered from the live record', sentMail.at(-1)?.subject === 'Welcome Direct!' && sentMail.at(-1)?.html === 'Hi Direct, thanks for joining.', JSON.stringify(sentMail.at(-1)));

  // ── §16.6 consent blocks the direct send-email path too ─────────────────
  await consentService.updateConsent({ tenantId: tenantAId, subjectType: 'lead', subjectId: leadDirectId, channels: { email: false }, source: 'test' });
  const blockedDirect = await req(`/api/v1/records/lead/${leadDirectId}/send-email`, {
    method: 'POST', cookie: cookieAdmin, body: { to: 'direct@example.com', subject: 'x', body: 'y' },
  });
  check('a direct send-email call is blocked when consent is withdrawn', blockedDirect.status === 403, `HTTP ${blockedDirect.status}`);
  await consentService.updateConsent({ tenantId: tenantAId, subjectType: 'lead', subjectId: leadDirectId, channels: { email: true }, source: 'test' });

  // ── §5/§16.7 Flow-triggered email must use the same consent gate ────────
  await Automation.create({
    tenantId: tenantAId, name: 'Welcome email flow', apiName: `welcome_email_${RUN}`,
    type: 'record_triggered', isActive: true, isValid: true,
    trigger: { objectApiName: 'lead', events: ['create'], runWhen: 'always' },
    nodes: [
      { id: 'trigger', type: 'trigger', label: 'Trigger', position: { x: 0, y: 0 }, config: {}, nextNodes: [{ nodeId: 'email', condition: null, label: '' }] },
      { id: 'email', type: 'action_send_email', label: 'Send welcome email', position: { x: 100, y: 0 }, config: { to: '{email}', subject: 'Welcome {first_name}', body: 'Hi {first_name}, welcome aboard.' }, nextNodes: [{ nodeId: 'end', condition: null, label: '' }] },
      { id: 'end', type: 'end', label: 'End', position: { x: 200, y: 0 }, config: {}, nextNodes: [] },
    ],
  });

  // Opt this lead's email out *before* it exists is impossible (consent keys
  // off an existing record id) — instead, pre-create the lead with consent
  // disabled by creating it, opting out immediately, then re-triggering via
  // an update is not how `events:['create']` fires. So: verify the Flow DOES
  // send when consent is allowed (default opt-in), then verify a second,
  // explicitly-opted-out *existing* lead's flow-triggered email (fired by an
  // update-triggered automation) is blocked — proving the consent gate is
  // live on the Flow path specifically, not just assumed from the manual path.
  const leadFlow1 = await req('/api/v1/records/lead', {
    method: 'POST', cookie: cookieAdmin, body: { first_name: 'FlowSent', last_name: 'One', email: 'flow1@example.com' },
  });
  check('a lead triggering the email flow is created', leadFlow1.status === 201, `HTTP ${leadFlow1.status}`);
  // fireAutomations is NOT awaited by the record-create route (it's fired
  // with .catch(), not awaited) — give it time to actually run.
  await wait(1500);
  const flow1Activity = await Activity.findOne({ tenantId: tenantAId, objectApiName: 'lead', recordId: leadFlow1.json?.data?.id, type: 'email' });
  check('the Flow-triggered email was sent and recorded in Activity history', Boolean(flow1Activity), 'no Activity found for flow-triggered email');
  check('the Flow email body was merge-rendered from the record', flow1Activity?.body === 'Hi FlowSent, welcome aboard.', flow1Activity?.body);

  // Now an update-triggered automation on an opted-out lead.
  await Automation.create({
    tenantId: tenantAId, name: 'Update email flow', apiName: `update_email_${RUN}`,
    type: 'record_triggered', isActive: true, isValid: true,
    trigger: { objectApiName: 'lead', events: ['update'], runWhen: 'always' },
    nodes: [
      { id: 'trigger', type: 'trigger', label: 'Trigger', position: { x: 0, y: 0 }, config: {}, nextNodes: [{ nodeId: 'email', condition: null, label: '' }] },
      { id: 'email', type: 'action_send_email', label: 'Send update email', position: { x: 100, y: 0 }, config: { to: '{email}', subject: 'Update {first_name}', body: 'Your record was updated.' }, nextNodes: [{ nodeId: 'end', condition: null, label: '' }] },
      { id: 'end', type: 'end', label: 'End', position: { x: 200, y: 0 }, config: {}, nextNodes: [] },
    ],
  });
  const leadFlow2 = await req('/api/v1/records/lead', {
    method: 'POST', cookie: cookieAdmin, body: { first_name: 'OptedOut', last_name: 'Two', email: 'flow2@example.com' },
  });
  const leadFlow2Id = leadFlow2.json?.data?.id;
  await consentService.updateConsent({ tenantId: tenantAId, subjectType: 'lead', subjectId: leadFlow2Id, channels: { email: false }, source: 'test' });
  const mailCountBefore = sentMail.length;
  const update2 = await req(`/api/v1/records/lead/${leadFlow2Id}`, { method: 'PUT', cookie: cookieAdmin, body: { last_name: 'TwoUpdated' } });
  check('updating the opted-out lead succeeds despite the blocked flow email', update2.status === 200, `HTTP ${update2.status}`);
  await wait(1500);
  check('the Flow-triggered email is blocked by consent, same as a manual send', sentMail.length === mailCountBefore, `mailCount before=${mailCountBefore} after=${sentMail.length}`);
  const flow2Activity = await Activity.findOne({ tenantId: tenantAId, objectApiName: 'lead', recordId: leadFlow2Id, type: 'email' });
  check('no email Activity was recorded for the consent-blocked flow send', !flow2Activity, 'an Activity was found despite consent being withdrawn');

  // Email transport stub stays active: the "Welcome email flow" automation
  // still fires on every subsequent lead create in this test.

  // ── §16.3/§16.5 Flow-triggered WhatsApp template — approval gate ────────
  const waAccount = await req('/api/v1/channels', {
    method: 'POST', cookie: cookieAdmin,
    body: { channel: 'whatsapp', name: 'Flow WA', provider: 'meta', webhookSecret: 'flow-wa-secret', credentials: { accessToken: 'tok', phoneNumberId: 'pn-1' } },
  });
  check('a WhatsApp channel account is created', waAccount.status === 201, `HTTP ${waAccount.status}`);

  const waTpl = await req('/api/v1/message-templates', {
    method: 'POST', cookie: cookieAdmin, body: { name: `Flow Template ${RUN}`, channel: 'whatsapp', body: 'Hi {{first_name}}, your account is ready.' },
  });
  const waTplId = waTpl.json?.data?._id;
  check('a WhatsApp message template is created (unapproved by default)', waTpl.status === 201 && waTpl.json?.data?.providerStatus === '', waTpl.json?.data?.providerStatus);

  await Automation.create({
    tenantId: tenantAId, name: 'WA welcome flow', apiName: `wa_welcome_${RUN}`,
    type: 'record_triggered', isActive: true, isValid: true,
    trigger: { objectApiName: 'lead', events: ['create'], runWhen: 'always' },
    nodes: [
      { id: 'trigger', type: 'trigger', label: 'Trigger', position: { x: 0, y: 0 }, config: {}, nextNodes: [{ nodeId: 'wa', condition: null, label: '' }] },
      { id: 'wa', type: 'action_send_message_template', label: 'Send WA welcome', position: { x: 100, y: 0 }, config: { channel: 'whatsapp', to: '{phone}', templateId: waTplId }, nextNodes: [{ nodeId: 'end', condition: null, label: '' }] },
      { id: 'end', type: 'end', label: 'End', position: { x: 200, y: 0 }, config: {}, nextNodes: [] },
    ],
  });

  // fireAutomations is fire-and-forget from the record-create route, so the
  // fetch stub must stay in place for the wait too, not just the POST call.
  const leadWaBlocked = await withFetchStub(
    async () => jsonResponse(200, { messages: [{ id: 'wamid.SHOULD_NOT_SEND' }] }),
    async () => {
      const r = await req('/api/v1/records/lead', {
        method: 'POST', cookie: cookieAdmin, body: { first_name: 'WaBlocked', last_name: 'X', email: 'wab@example.com', phone: '27821110000' },
      });
      await wait(1500);
      return r;
    },
  );
  const waMsgBlocked = await Message.findOne({ tenantId: tenantAId, channel: 'whatsapp', body: { $regex: 'WaBlocked' } });
  check('a Flow-triggered WhatsApp template send is blocked while unapproved (§16.5)', !waMsgBlocked, 'a WhatsApp message was sent despite the template being unapproved');

  await req(`/api/v1/message-templates/${waTplId}`, { method: 'PUT', cookie: cookieAdmin, body: { providerStatus: 'approved' } });
  const leadWaOk = await withFetchStub(
    async () => jsonResponse(200, { messages: [{ id: 'wamid.APPROVED_SEND' }] }),
    async () => {
      const r = await req('/api/v1/records/lead', {
        method: 'POST', cookie: cookieAdmin, body: { first_name: 'WaApproved', last_name: 'Y', email: 'waok@example.com', phone: '27821110001' },
      });
      await wait(1500);
      return r;
    },
  );
  const waMsgOk = await Message.findOne({ tenantId: tenantAId, channel: 'whatsapp', body: { $regex: 'WaApproved' } });
  check('an approved template is sent by the Flow once approval is granted', Boolean(waMsgOk), 'no WhatsApp message found after approval');
  const waOkConversation = waMsgOk
    ? await Conversation.findOne({ _id: waMsgOk.conversationId, 'linkedRecord.recordId': leadWaOk.json?.data?.id })
    : null;
  check('the Flow WhatsApp message is linked to the triggering lead', Boolean(waOkConversation), 'conversation not linked to lead');

  // ── §16.2 Instagram channel — confirm exact support level ────────────────
  const providers = await req('/api/v1/channels/providers', { cookie: cookieAdmin });
  const igProvider = (providers.json?.data || []).find((p) => p.provider === 'meta_instagram');
  check('Instagram is registered as a distinct provider, not merely assumed', Boolean(igProvider), 'meta_instagram provider not found in catalog');
  check('Instagram declares the same inbound-normalizer capability as Messenger (shared Meta Send/webhook API)', igProvider?.inboundNormalizer === true, JSON.stringify(igProvider));
  check('Instagram requires the same Meta Page credentials as Messenger (no separate IG-only credential set exists)', JSON.stringify(igProvider?.requiredCredentials) === JSON.stringify(['pageAccessToken', 'appSecret']), JSON.stringify(igProvider?.requiredCredentials));

} catch (err) {
  console.error('TEST RUN ERROR:', err);
  check('test run completed without unexpected error', false, err.message);
} finally {
  try {
    setEmailTransportFactory(null);
    const models = [
      DynamicRecord, ChannelAccount, Conversation, Message, MessageTemplate, EmailTemplate,
      Activity, Automation, Consent, TenantConfiguration, User, Role, Session, ObjectMeta, FieldMeta,
    ];
    if (tenantAId) {
      await Promise.all(models.map((M) => M.deleteMany({ tenantId: tenantAId })));
      await Tenant.deleteOne({ _id: tenantAId });
    }
    await mongoose.connection.close();
  } catch (e) { console.error('cleanup', e.message); }
  server.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  process.exit(failed.length ? 1 : 0);
}
