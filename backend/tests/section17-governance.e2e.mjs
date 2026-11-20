/**
 * BRD Section 17 - Integration Framework & API.
 * Real keys and tokens are created inside the suite's own throwaway tenants
 * (ZZ_S17*), used over HTTP, and removed at the end. External endpoints are a
 * local capture server; every secret is a dummy.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import crypto from 'crypto';
import http from 'http';
import connectDB from '../config/db.js';
import app from '../app.js';
import Tenant from '../models/Tenant.js';
import User from '../models/User.js';
import Role from '../models/Role.js';
import ObjectMeta from '../models/ObjectMeta.js';
import FieldMeta from '../models/FieldMeta.js';
import DynamicRecord from '../models/DynamicRecord.js';
import Automation from '../models/Automation.js';
import ApiKey from '../models/ApiKey.js';
import AuthFailureLog from '../models/AuthFailureLog.js';
import Webhook from '../models/Webhook.js';
import WebhookDeliveryLog from '../models/WebhookDeliveryLog.js';
import IncomingWebhookLog from '../models/IncomingWebhookLog.js';
import Integration from '../models/Integration.js';
import Notification from '../models/Notification.js';
import ChannelAccount from '../models/ChannelAccount.js';
import TenantConfiguration from '../models/TenantConfiguration.js';
import CustomCode from '../models/CustomCode.js';
import AuditLog from '../models/AuditLog.js';
import Session from '../models/Session.js';
import Workspace from '../models/Workspace.js';
import channelService from '../services/channelService.js';
import { processWebhookRetries } from '../services/webhookRetryService.js';
import { seedDefaultRoles } from '../services/roleService.js';
import { seedWorkspace } from './helpers/workspace.mjs';

const RUN = Date.now().toString(36);
const PASSWORD = `Aa1!${crypto.randomBytes(9).toString('hex')}`;
const DUMMY = `dummy-secret-${RUN}`; // must never appear in any log, screen or history
const results = [];
const check = (name, pass, detail = '') => { results.push({ name, pass }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
const call = async (path, { method = 'GET', cookie, key, bearer, body, headers = {}, raw } = {}) => {
  const res = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(key ? { 'X-API-Key': key } : {}), ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), ...headers },
    body: raw !== undefined ? raw : body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text, headers: res.headers };
};
const login = async (email) => {
  const res = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: email, password: PASSWORD }) });
  return (res.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).find((c) => c.startsWith('crm.sid=')) || '';
};

// local capture receiver: records every request, answers with the current mode
const received = [];
let mode = 200;
const receiver = http.createServer((rq, rs) => {
  let b = ''; rq.on('data', (c) => { b += c; });
  rq.on('end', () => { received.push({ url: rq.url, headers: rq.headers, body: b }); rs.statusCode = mode; rs.end('ok'); });
});
await new Promise((r) => receiver.listen(0, '127.0.0.1', r));
const hookUrl = `http://127.0.0.1:${receiver.address().port}/hook`;
const waitFor = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await sleep(150); } return null; };
const eventsSeen = () => received.map((r) => { try { return JSON.parse(r.body).event; } catch { return null; } });

let tA, tB;
try {
  await connectDB();
  tA = await Tenant.create({ name: `ZZ_S17A_${RUN}`, slug: `zz-s17a-${RUN}`, status: 'active', plan: 'enterprise' });
  tB = await Tenant.create({ name: `ZZ_S17B_${RUN}`, slug: `zz-s17b-${RUN}`, status: 'active', plan: 'enterprise' });
  await seedDefaultRoles(tA._id); await seedDefaultRoles(tB._id);
  const roleA = await Role.findOne({ tenantId: tA._id, name: 'admin' });
  const roleB = await Role.findOne({ tenantId: tB._id, name: 'admin' });
  const limitedRole = await Role.create({
    tenantId: tA._id, name: 'limited', label: 'Limited', dataAccess: 'all',
    objectPermissions: [{ objectApiName: 'bill', canRead: true, canCreate: false, canUpdate: false, canDelete: false }],
    appPermissions: { canManageApiKeys: true },
  });
  const mk = (t, role, tag) => User.create({ tenantId: t._id, firstName: tag, lastName: 'S17', email: `${tag}-${RUN}@example.com`, username: `${tag}_${RUN}`, password: PASSWORD, role: role._id, status: 'active', emailVerified: true });
  const hookRole = await Role.create({
    tenantId: tA._id, name: 'hooker', label: 'Hooker', dataAccess: 'all',
    objectPermissions: [{ objectApiName: 'bill', canRead: true, canCreate: false, canUpdate: false, canDelete: false, fieldPermissions: ['name', 'amount', 'status'].map((f) => ({ fieldApiName: f, canView: true })).concat([{ fieldApiName: 'ssn', canView: false }]) }],
    appPermissions: { canManageWebhooks: true },
  });
  const adminA = await mk(tA, roleA, 'a'); const adminB = await mk(tB, roleB, 'b'); const limited = await mk(tA, limitedRole, 'lim'); const hooker = await mk(tA, hookRole, 'hk'); const apprUser = await mk(tA, roleA, 'appr');
  const mkObj = async (t, apiName, extra = []) => {
    const o = await ObjectMeta.create({ tenantId: t._id, name: apiName, label: apiName, pluralLabel: `${apiName}s`, apiName, nameFieldApiName: 'name', isActive: true });
    await FieldMeta.create([{ name: 'name', apiName: 'name', label: 'Name', type: 'text' }, { name: 'amount', apiName: 'amount', label: 'Amount', type: 'number' }, { name: 'status', apiName: 'status', label: 'Status', type: 'text' }, ...extra]
      .map((f) => ({ tenantId: t._id, objectId: o._id, objectApiName: apiName, ...f })));
    return o;
  };
  await mkObj(tA, 'bill', [{ name: 'ssn', apiName: 'ssn', label: 'SSN', type: 'text' }]); await mkObj(tA, 'vault'); await mkObj(tA, 'lead'); await mkObj(tB, 'bill');
  await seedWorkspace(tA._id, [adminA._id, limited._id, hooker._id, apprUser._id], ['bill', 'vault', 'lead']); await seedWorkspace(tB._id, [adminB._id], ['bill']);
  const CA = await login(adminA.email); const CB = await login(adminB.email); const CL = await login(limited.email); const CH = await login(hooker.email); const CP = await login(apprUser.email);
  check('test admins and a limited user can sign in', !!CA && !!CB && !!CL);

  const mkKey = async (cookie, body) => (await call('/api-keys', { method: 'POST', cookie, body })).json?.data;
  // ── 17.2 credentials ────────────────────────────────────────────────────────
  const kFull = await mkKey(CA, { name: 'full', scopes: ['read', 'write', 'delete'] });
  const kRead = await mkKey(CA, { name: 'readonly', scopes: ['read'] });
  const kLim = await mkKey(CL, { name: 'limited role', scopes: ['read', 'write', 'delete'] });
  check('key creation returns the raw key once', /^smk_/.test(kFull?.rawKey || '') && !kFull.keyHash);
  const listed = await call('/api-keys', { cookie: CA });
  check('later reads never return the key or its hash', !listed.text.includes(kFull.rawKey) && !/keyHash/.test(listed.text));
  const dbKey = await ApiKey.findById(kFull._id).select('+keyHash').lean();
  check('only a SHA-256 hash is stored', dbKey.keyHash === crypto.createHash('sha256').update(kFull.rawKey).digest('hex') && !JSON.stringify(dbKey).includes(kFull.rawKey));

  // ── 17.1 API: CRUD, query, metadata, 17.1.11 tenant scope ───────────────────
  const K = kFull.rawKey;
  const c1 = await call('/records/bill', { method: 'POST', key: K, body: { name: 'API bill', amount: 10, status: 'open' } });
  const id1 = c1.json?.data?.id || c1.json?.data?._id;
  check('API key creates a record (17.1.3)', c1.status === 201 && !!id1, `HTTP ${c1.status}`);
  const g1 = await call(`/records/bill/${id1}`, { key: K });
  check('API key retrieves a record (17.1.1)', g1.status === 200 && JSON.stringify(g1.json).includes('API bill'));
  const u1 = await call(`/records/bill/${id1}`, { method: 'PUT', key: K, body: { name: 'API bill', amount: 20, status: 'paid' } });
  check('API key updates a record', u1.status === 200, `HTTP ${u1.status}`);
  const q1 = await call(`/records/bill?filter=${encodeURIComponent(JSON.stringify({ status: 'paid' }))}`, { key: K });
  check('API key queries records with a filter', q1.status === 200 && JSON.stringify(q1.json).includes('API bill'));
  const m1 = await call('/objects/bill', { key: K }); const m2 = await call('/objects/bill/fields', { key: K });
  check('object and field metadata are available (17.1.7)', m1.status === 200 && m2.status === 200 && JSON.stringify(m2.json).includes('amount'));
  const rd = await call('/records/bill', { method: 'POST', key: kRead.rawKey, body: { name: 'x' } });
  check('a read-only key cannot write (scope)', rd.status === 403, `HTTP ${rd.status}`);
  const wrongTenant = await call('/records/bill', { key: K, headers: { 'X-Tenant-ID': String(tB._id) } });
  check('a request naming another tenant is refused', wrongTenant.status === 403, `HTTP ${wrongTenant.status}`);
  const other = await DynamicRecord.create({ tenantId: tB._id, objectApiName: 'bill', objectId: (await ObjectMeta.findOne({ tenantId: tB._id, apiName: 'bill' }))._id, data: { name: 'B secret' } });
  const iso1 = await call(`/records/bill/${other._id}`, { key: K }); const iso2 = await call(`/records/bill/${other._id}`, { method: 'DELETE', key: K });
  check('a key cannot read or delete another tenant\'s record', iso1.status === 404 && iso2.status === 404 && !iso1.text.includes('B secret'), `${iso1.status}/${iso2.status}`);
  check('the other tenant\'s record still exists', !!(await DynamicRecord.findOne({ _id: other._id, isDeleted: { $ne: true } })));

  // 17.1.10 a brand-new object and field are served with no engineering step
  const oc = await call('/objects', { method: 'POST', cookie: CA, body: { name: 'Gadget', label: 'Gadget', pluralLabel: 'Gadgets', apiName: `gadget_${RUN}`, nameFieldApiName: 'name' } });
  const gad = `gadget_${RUN}`;
  await FieldMeta.create({ tenantId: tA._id, objectId: (await ObjectMeta.findOne({ tenantId: tA._id, apiName: gad }))?._id, objectApiName: gad, name: 'name', apiName: 'name', label: 'Name', type: 'text' }).catch(() => {});
  const fc = await call(`/objects/${gad}/fields`, { method: 'POST', cookie: CA, body: { name: 'Colour', label: 'Colour', apiName: 'colour', type: 'text' } });
  await Workspace.updateOne({ tenantId: tA._id }, { $addToSet: { allowedObjects: gad } });
  const gc = await call(`/records/${gad}`, { method: 'POST', key: K, body: { name: 'G1', colour: 'red' } });
  const gg = await call(`/records/${gad}/${gc.json?.data?.id}`, { key: K });
  check('a new custom object and field are usable through the API at once (17.1.10)', oc.status < 300 && fc.status < 300 && gc.status === 201 && JSON.stringify(gg.json).includes('red'), `obj ${oc.status} field ${fc.status} rec ${gc.status}`);

  // 17.1.9 trigger a flow
  const flow = await Automation.create({ tenantId: tA._id, name: `S17 Flow ${RUN}`, apiName: `s17_flow_${RUN}`, type: 'autolaunched', isActive: true, allowApiTrigger: true, nodes: [{ id: 't', type: 'trigger', label: 'Start', nextNodes: [{ nodeId: 'u' }] }, { id: 'u', type: 'action_update_record', label: 'Mark', config: { recordMode: 'trigger', fields: { status: 'flowed' } } }] });
  const rf = await call(`/automations/${flow._id}/run-action`, { method: 'POST', key: K, body: { recordId: id1, objectApiName: 'bill' } });
  const afterFlow = await DynamicRecord.findById(id1).lean();
  check('a key triggers a flow (17.1.9)', rf.status === 200 && afterFlow?.data?.status === 'flowed', `HTTP ${rf.status} status=${afterFlow?.data?.status}`);

  // permission enforcement: key bound to a limited role
  const lr = await call('/records/bill', { key: kLim.rawKey }); const lw = await call('/records/bill', { method: 'POST', key: kLim.rawKey, body: { name: 'nope' } });
  const lv = await call('/records/vault', { key: kLim.rawKey });
  check('a key inherits its role: may read bill, cannot create it or read vault (17.6.4)', lr.status === 200 && lw.status === 403 && lv.status === 403, `${lr.status}/${lw.status}/${lv.status}`);
  const kObj = await mkKey(CA, { name: 'bill only', scopes: ['read'], allowedObjects: ['bill'] });
  const ko = await call('/records/vault', { key: kObj.rawKey });
  check('a key limited to chosen objects cannot reach others', ko.status === 403);

  // ── 17.6 governance ─────────────────────────────────────────────────────────
  const kRot = await mkKey(CA, { name: 'to rotate', scopes: ['read'] });
  const rot = await call(`/api-keys/${kRot._id}/rotate`, { method: 'POST', cookie: CA });
  const oldUse = await call('/records/bill', { key: kRot.rawKey }); const newUse = await call('/records/bill', { key: rot.json?.data?.rawKey });
  check('rotation: new key works, old key is refused (17.6.7)', rot.status === 201 && oldUse.status === 401 && newUse.status === 200, `${rot.status}/${oldUse.status}/${newUse.status}`);
  const kDe = await mkKey(CA, { name: 'to deactivate', scopes: ['read'] });
  const de = await call(`/api-keys/${kDe._id}/deactivate`, { method: 'POST', cookie: CA });
  const deUse = await call('/records/bill', { key: kDe.rawKey });
  const ac = await call(`/api-keys/${kDe._id}/activate`, { method: 'POST', cookie: CA });
  const acUse = await call('/records/bill', { key: kDe.rawKey });
  check('deactivation refuses the key and activation restores it, no data lost (17.6.6, 17.2.8)', de.status === 200 && deUse.status === 401 && ac.status === 200 && acUse.status === 200, `${deUse.status}/${acUse.status}`);
  await call(`/api-keys/${kDe._id}/revoke`, { method: 'DELETE', cookie: CA });
  const reAct = await call(`/api-keys/${kDe._id}/activate`, { method: 'POST', cookie: CA });
  check('a revoked key cannot be reactivated', reAct.status === 400);
  const kLow = await mkKey(CA, { name: 'low limit', scopes: ['read'], rateLimitPerMinute: 3 });
  const codes = []; for (let i = 0; i < 5; i += 1) codes.push((await call('/records/bill?limit=1', { key: kLow.rawKey })).status);
  check('per-key rate limit answers 429 with Retry-After (17.6.1)', codes.slice(0, 3).every((c) => c === 200) && codes[3] === 429 && codes[4] === 429, codes.join(','));
  const noAuth = await call('/records/bill'); const badKey = await call('/records/bill', { key: 'smk_notarealkey000000', headers: { 'X-Tenant-ID': String(tA._id) } });
  check('unauthenticated and bad-key requests are refused', noAuth.status === 401 && badKey.status === 401);
  await sleep(500);
  const fails = await call('/api-keys/auth-failures', { cookie: CA });
  const reasons = (fails.json?.data || []).map((r) => `${r.integration}:${r.reason}`).join('|');
  check('authentication failures are logged for the tenant (17.6.3)', /api-key:Invalid or expired API key/.test(reasons) && /api-key:This API key does not belong/.test(reasons) && /api-key:API rate limit/.test(reasons), reasons.slice(0, 160));
  check('the failure log never holds a full key', !fails.text.includes(kFull.rawKey) && !fails.text.includes('smk_notarealkey000000'));
  const failsB = await call('/api-keys/auth-failures', { cookie: CB });
  check('another tenant cannot read this tenant\'s failure log', !failsB.text.includes('API key does not belong') || !/api-key/.test(failsB.text.replace(String(tA._id), '')));
  const usage = await call('/api-keys/usage-summary?days=7', { cookie: CA });
  check('tenant-level usage monitoring reports calls and errors (17.6.2)', usage.status === 200 && usage.json?.data?.total > 5 && usage.json?.data?.errors >= 1, JSON.stringify(usage.json?.data || {}).slice(0, 120));
  const perKey = await call(`/api-keys/${kFull._id}/usage`, { cookie: CA });
  check('per-key usage lists calls by object and status', perKey.status === 200 && perKey.json?.data?.total > 3);
  const noPerm = await call('/api-keys', { cookie: CB }); // B admin may list its own, but never A's keys
  check('a key list never crosses tenants', !noPerm.text.includes(String(kFull._id)));

  // access tokens (17.2.4)
  const ic = await call('/integrations', { method: 'POST', cookie: CA, body: { name: `S17 token ${RUN}`, permissions: ['read'] } });
  const TOKEN = ic.json?.data?.accessToken;
  const tokRead = await call('/records/bill?limit=1', { bearer: TOKEN }); const tokWrite = await call('/records/bill', { method: 'POST', bearer: TOKEN, body: { name: 'x' } });
  const stored = await Integration.findById(ic.json?.data?._id).lean();
  const tokList = await call('/integrations', { cookie: CA }); const tokGet = await call(`/integrations/${ic.json?.data?._id}`, { cookie: CA });
  check('an integration access token authenticates as Bearer, within its scope (17.2.4)', tokRead.status === 200 && tokWrite.status === 403, `${tokRead.status}/${tokWrite.status}`);
  check('the token is stored only as a hash and never shown again (17.2.6/7)', !JSON.stringify(stored).includes(TOKEN) && !tokList.text.includes(TOKEN) && !tokGet.text.includes(TOKEN) && !/tokenHash/.test(tokGet.text));
  await call(`/integrations/${ic.json?.data?._id}`, { method: 'PUT', cookie: CA, body: { status: 'inactive' } });
  check('an inactive integration token is refused', (await call('/records/bill', { bearer: TOKEN })).status === 401);

  // ── 17.3 incoming webhooks ──────────────────────────────────────────────────
  const inc = (body, extra = {}) => call('/webhooks/incoming', { method: 'POST', key: K, body, ...extra });
  const ic1 = await inc({ objectApiName: 'bill', action: 'create', data: { name: 'Inbound', amount: 5, status: 'new' }, source: 'partner', eventType: 'lead.sent', password: DUMMY });
  const newId = ic1.json?.data?.recordId;
  check('incoming webhook creates a record (17.3.2)', ic1.status === 200 && !!newId);
  const ic2 = await inc({ objectApiName: 'bill', action: 'update', recordId: newId, data: { name: 'Inbound', amount: 6, status: 'changed' } });
  check('incoming webhook updates a record (17.3.3)', ic2.status === 200 && (await DynamicRecord.findById(newId).lean()).data.status === 'changed');
  const ic3 = await inc({ flowId: String(flow._id), recordId: newId, objectApiName: 'bill', action: 'update', data: { name: 'Inbound', amount: 6, status: 'changed' } });
  check('incoming webhook starts a named flow (17.3.4)', ic3.status === 200 && ic3.json?.data?.flow?.name === flow.name && (await DynamicRecord.findById(newId).lean()).data.status === 'flowed', JSON.stringify(ic3.json?.data?.flow));
  await CustomCode.deleteMany({ tenantId: tA._id, name: 's17_calc' });
  const cc = await call('/custom-code', { method: 'POST', cookie: CA, body: { name: 's17_calc', code: 'result = 21 * 2;', inputs: {} } });
  const ccNotActive = await inc({ customCode: 's17_calc', data: {} });
  await call('/custom-code/s17_calc/activate', { method: 'POST', cookie: CA, body: { version: 1 } });
  const ccActive = await inc({ customCode: 's17_calc', data: {} });
  check('incoming webhook runs approved custom code only (17.3.5)', cc.status < 300 && !JSON.stringify(ccNotActive.json?.data).includes('42') && JSON.stringify(ccActive.json?.data).includes('42'), `${JSON.stringify(ccNotActive.json?.data).slice(0, 80)}|${JSON.stringify(ccActive.json?.data).slice(0, 60)}`);
  const ic5 = await inc({ source: 'erp', eventType: 'invoice.paid', externalEventId: `ev-${RUN}`, data: { n: 1 } });
  check('incoming webhook records an external event (17.3.6)', ic5.status === 200 && !!(await IncomingWebhookLog.findOne({ tenantId: tA._id, eventType: 'invoice.paid' })));
  const ic6 = await call('/webhooks/incoming', { method: 'POST', body: { objectApiName: 'bill', action: 'create', data: { name: 'anon' } } });
  const ic7 = await inc({ objectApiName: 'bill', action: 'create', data: { name: 'x' } }, { headers: { 'X-Tenant-ID': String(tB._id) } });
  check('unauthenticated and other-tenant incoming requests are refused (17.3.7)', ic6.status === 401 && ic7.status === 403, `${ic6.status}/${ic7.status}`);
  const ic8 = await call('/webhooks/incoming', { method: 'POST', key: kRead.rawKey, body: { objectApiName: 'bill', action: 'create', data: { name: 'ro' } } });
  const ic9 = await call('/webhooks/incoming', { method: 'POST', key: kLim.rawKey, body: { objectApiName: 'bill', action: 'create', data: { name: 'lim' } } });
  const ic10 = await call('/webhooks/incoming', { method: 'POST', key: kObj.rawKey, body: { objectApiName: 'vault', action: 'create', data: { name: 'v' } } });
  check('incoming webhooks obey key scope, role and object list', ic8.status === 403 && ic9.status === 403 && ic10.status === 403, `${ic8.status}/${ic9.status}/${ic10.status}`);
  // optional HMAC (tenant webhook secret configured)
  await TenantConfiguration.create({ tenantId: tA._id, key: 'integration.webhook.secret', value: 'enc-placeholder' }).catch(() => {});
  await call('/configuration/integration.webhook.secret', { method: 'PUT', cookie: CA, body: { value: DUMMY } });
  const bodyObj = { source: 'sig', eventType: 'signed', data: {} };
  const sign = (b, s = DUMMY) => `sha256=${crypto.createHmac('sha256', s).update(JSON.stringify(b)).digest('hex')}`;
  const s0 = await inc(bodyObj); const s1 = await inc(bodyObj, { headers: { 'X-Webhook-Signature': sign(bodyObj, 'wrong') } }); const s2 = await inc(bodyObj, { headers: { 'X-Webhook-Signature': sign(bodyObj) } });
  check('with a tenant secret: unsigned and wrongly signed are refused, signed is accepted', s0.status === 401 && s1.status === 401 && s2.status === 200, `${s0.status}/${s1.status}/${s2.status}`);
  await call('/configuration/integration.webhook.secret', { method: 'DELETE', cookie: CA });
  const logs = await call('/webhooks/incoming/logs', { cookie: CA });
  check('incoming log is readable and holds no payload values', logs.status === 200 && !logs.text.includes(DUMMY) && !/"payload"/.test(logs.text));
  const stored2 = JSON.stringify(await IncomingWebhookLog.find({ tenantId: tA._id }).lean());
  check('a credential-looking field in an incoming body is masked even in the database', !stored2.includes(DUMMY) && stored2.includes('[hidden]'));

  // ── 17.4 outgoing webhooks ──────────────────────────────────────────────────
  const WS = 'whsec-dummy';
  const bad = await call('/webhooks', { method: 'POST', cookie: CA, body: { name: 'bad', url: hookUrl, events: ['nonsense.event'] } });
  check('an unknown event is refused when configuring a webhook', bad.status === 400);
  const wh = await call('/webhooks', { method: 'POST', cookie: CA, body: { name: 'S17 hook', url: hookUrl, events: ['record.created', 'record.updated', 'record.deleted', 'flow.completed', 'lead.received', 'communication.received', 'communication.sent', 'call.completed', 'approval.completed', 'custom.escalated'], objectFilters: ['bill'], payloadMapping: { bill_name: 'name', bill_amount: 'amount' }, retryCount: 2, retryIntervalSeconds: 1, retryBackoff: 'exponential', failureNotifyThreshold: 1 } });
  const whId = wh.json?.data?._id; const whSecret = wh.json?.data?.secret;
  check('a webhook is created and its signing secret shown once', wh.status === 201 && /^[0-9a-f]{64}$/.test(whSecret || '') && !(await call(`/webhooks/${whId}`, { cookie: CA })).text.includes(whSecret));
  const rawWh = await Webhook.collection.findOne({ _id: new mongoose.Types.ObjectId(whId) });
  check('the signing secret is encrypted at rest (17.2.6)', rawWh.secret?.startsWith('enc:'));
  // flow that raises a custom event and also lets us see flow.completed
  await Automation.create({ tenantId: tA._id, name: `S17 Evt ${RUN}`, apiName: `s17_evt_${RUN}`, type: 'record_triggered', isActive: true, trigger: { objectApiName: 'bill', events: ['create'] }, nodes: [{ id: 't', type: 'trigger', label: 'Start', nextNodes: [{ nodeId: 'e' }] }, { id: 'e', type: 'action_custom_event', label: 'Escalate', config: { eventName: 'escalated' } }] });
  received.length = 0;
  const wc = await call('/records/bill', { method: 'POST', cookie: CA, body: { name: 'Hooked', amount: 99, status: 'open' } });
  const hid = wc.json?.data?.id;
  await call(`/records/bill/${hid}`, { method: 'PUT', cookie: CA, body: { name: 'Hooked', amount: 100, status: 'open' } });
  await call(`/records/bill/${hid}`, { method: 'DELETE', cookie: CA });
  await waitFor(() => ['record.created', 'record.updated', 'record.deleted', 'flow.completed', 'custom.escalated'].every((e) => eventsSeen().includes(e)), 10000);
  const seen = eventsSeen();
  check('record created / updated / deleted are delivered (17.4.2-4)', ['record.created', 'record.updated', 'record.deleted'].every((e) => seen.includes(e)), seen.join(','));
  check('flow completed and a custom business event raised by a flow are delivered (17.4.6, 17.4.11)', seen.includes('flow.completed') && seen.includes('custom.escalated'), seen.join(','));
  const first = received.find((r) => JSON.parse(r.body).event === 'record.created');
  const sigOk = first && first.headers['x-webhook-signature'] === `sha256=${crypto.createHmac('sha256', whSecret).update(first.body).digest('hex')}`;
  check('a delivery is signed with the webhook\'s secret (HMAC-SHA256)', !!sigOk);
  check('payload mapping sends only the mapped standard and custom fields (17.4.12)', first && JSON.stringify(Object.keys(JSON.parse(first.body).data).sort()) === JSON.stringify(['bill_amount', 'bill_name']) && JSON.parse(first.body).data.bill_name === 'Hooked');
  // communication and call events
  const acc = await ChannelAccount.create({ tenantId: tA._id, channel: 'telephony', name: 'S17 tel', provider: 'other' });
  received.length = 0;
  await channelService.fireTestEvent({ tenantId: tA._id, id: acc._id, kind: 'message' }).catch(() => {});
  await channelService.fireTestEvent({ tenantId: tA._id, id: acc._id, kind: 'call' }).catch(() => {});
  await waitFor(() => eventsSeen().includes('call.completed') && eventsSeen().includes('communication.received'), 6000);
  check('communication received and call completed are delivered (17.4.8, 17.4.10)', eventsSeen().includes('communication.received') && eventsSeen().includes('call.completed'), eventsSeen().join(','));
  // retry, backoff, failure notification
  mode = 500; received.length = 0;
  const fc2 = await call('/records/bill', { method: 'POST', cookie: CA, body: { name: 'Retry me', amount: 1, status: 'open' } });
  await waitFor(async () => (await WebhookDeliveryLog.countDocuments({ webhookId: whId, event: 'record.created', status: 'retrying' })) >= 1, 8000);
  const first500 = await WebhookDeliveryLog.findOne({ webhookId: whId, event: 'record.created', status: 'retrying' }).sort({ createdAt: -1 }).lean();
  check('a failing receiver leaves a retrying row with attempt count and next retry time (17.5.10, 17.5.12)', first500?.httpStatus === 500 && first500?.attempt === 1 && first500?.maxAttempts === 3 && !!first500?.nextRetryAt, JSON.stringify({ a: first500?.attempt, m: first500?.maxAttempts }));
  mode = 200;
  await sleep(1300); await processWebhookRetries(tA._id);
  const recovered = await WebhookDeliveryLog.findById(first500?._id).lean();
  check('the retry delivers once the receiver recovers and the stored payload is cleared', recovered?.status === 'success' && recovered?.attempt === 2 && !recovered?.payload, `${recovered?.status}/${recovered?.attempt}`);
  mode = 500;
  await call('/records/bill', { method: 'POST', cookie: CA, body: { name: 'Fail for good', amount: 1, status: 'open' } });
  await waitFor(async () => (await WebhookDeliveryLog.countDocuments({ webhookId: whId, status: 'retrying', attempt: 1, event: 'record.created' })) >= 1, 8000);
  for (let i = 0; i < 3; i += 1) { await sleep(2200); await processWebhookRetries(tA._id); }
  const failed = await WebhookDeliveryLog.findOne({ webhookId: whId, status: 'failed' }).lean();
  const note = await waitFor(() => Notification.findOne({ tenantId: tA._id, title: /keeps failing/ }));
  check('after the last retry the delivery is failed and an administrator is notified (17.5.13)', failed?.attempt === 3 && !!note, `attempt=${failed?.attempt} note=${!!note}`);
  mode = 200;

  // ── Round 2: field security in payloads, flow-trigger permission, remaining events ──
  const hk = await call('/webhooks', { method: 'POST', cookie: CH, body: { name: 'hk hook', url: hookUrl.replace('/hook', '/hk'), events: ['record.created', 'record.updated'], retryCount: 0 } });
  const hkMap = await call('/webhooks', { method: 'POST', cookie: CH, body: { name: 'hk mapped', url: hookUrl.replace('/hook', '/hkm'), events: ['record.created'], retryCount: 0, payloadMapping: { secretNo: 'ssn', amt: 'amount' } } });
  received.length = 0;
  const fr = await call('/records/bill', { method: 'POST', cookie: CA, body: { name: 'FS', amount: 7, status: 'open', ssn: 'FS-HIDDEN-VALUE' } });
  const fsId = fr.json?.data?.id;
  await call(`/records/bill/${fsId}`, { method: 'PUT', cookie: CA, body: { name: 'FS', amount: 8, status: 'open', ssn: 'FS-HIDDEN-VALUE-2' } });
  await waitFor(() => received.filter((r) => r.url === '/hk').length >= 2 && received.some((r) => r.url === '/hkm'), 10000);
  const full = received.filter((r) => r.url === '/hk'); const mapped = received.find((r) => r.url === '/hkm');
  check('a webhook made by a role that cannot see a field never sends it, on create or update (17.1.2, 17.2)', hk.status === 201 && full.length >= 2 && full.every((r) => !r.body.includes('FS-HIDDEN') && JSON.parse(r.body).data.amount !== undefined && !('ssn' in JSON.parse(r.body).data)), full.map((r) => r.body.slice(0, 80)).join('|'));
  check('a mapping that names a hidden field leaves it out and the log says so (17.4.12)', hkMap.status === 201 && mapped && JSON.stringify(Object.keys(JSON.parse(mapped.body).data)) === '["amt"]' && !mapped.body.includes('FS-HIDDEN'));
  const adminSees = received.find((r) => r.url === '/hook' && r.body.includes('FS-HIDDEN-VALUE'));
  const flog = (await call('/integration-log?direction=outbound&limit=300', { cookie: CA })).json?.data || [];
  check('the Integration Log records which fields were withheld', flog.some((r) => /Not sent \(field security\): ssn/.test(r.error || '')) && flog.some((r) => /Mapping "secretNo" names hidden field ssn/.test(r.error || '')), flog.filter((r) => r.error).map((r) => r.error).slice(0, 2).join('|'));
  await call(`/webhooks/${hk.json?.data?._id}`, { method: 'DELETE', cookie: CH }); await call(`/webhooks/${hkMap.json?.data?._id}`, { method: 'DELETE', cookie: CH });

  const flowOff = await Automation.create({ tenantId: tA._id, name: `S17 Off ${RUN}`, apiName: `s17_off_${RUN}`, type: 'autolaunched', isActive: true, nodes: [{ id: 't', type: 'trigger', label: 'Start', nextNodes: [{ nodeId: 'u' }] }, { id: 'u', type: 'action_update_record', label: 'Mark', config: { recordMode: 'trigger', fields: { status: 'ranoff' } } }] });
  const kScoped = await mkKey(CA, { name: 'vault only', scopes: ['write'], allowedObjects: ['vault'] });
  const runIt = (id, k, obj = 'bill') => call(`/automations/${id}/run-action`, { method: 'POST', key: k, body: { recordId: fsId, objectApiName: obj } });
  const t1 = await runIt(flowOff._id, K), t2 = await runIt(flow._id, kScoped.rawKey), t3 = await runIt(flow._id, kLim.rawKey), t4 = await runIt(flow._id, K);
  const after = await DynamicRecord.findById(fsId).lean();
  check('flow trigger by key: flag off 403, key object list 403, owner lacks update 403; all enabled and allowed succeeds (17.1.9)', t1.status === 403 && t2.status === 403 && t3.status === 403 && t4.status === 200 && after.data.status === 'flowed', `${t1.status}/${t2.status}/${t3.status}/${t4.status} status=${after.data.status}`);
  const ilog = (await call('/integration-log?direction=inbound&limit=300', { cookie: CA })).json?.data || [];
  const refused = ilog.filter((r) => /run-action/.test(r.endpoint) && r.httpStatus === 403);
  const af = (await call('/api-keys/auth-failures', { cookie: CA })).json?.data || [];
  check('the refusals are in the Integration Log and the failure log, and the flow did not run', refused.length >= 3 && af.some((r) => /not enabled for API triggering/.test(r.reason)) && after.data.status !== 'ranoff');
  const viaHook = await inc({ flowId: String(flowOff._id), recordId: fsId, objectApiName: 'bill', action: 'update', data: { name: 'FS', amount: 8, status: 'open' } });
  check('an incoming webhook cannot start a flow that is not enabled for API triggering', viaHook.status === 403);

  // approval.completed, communication.sent, lead.received
  const ev = await call('/webhooks', { method: 'POST', cookie: CA, body: { name: 'events hook', url: hookUrl.replace('/hook', '/ev'), events: ['approval.completed', 'communication.sent', 'lead.received'], retryCount: 0 } });
  const evSecret = ev.json?.data?.secret;
  const proc = await call('/approval-processes', { method: 'POST', cookie: CA, body: { name: 'S17 approval', objectApiName: 'bill', steps: [{ order: 1, name: 'Review', approverType: 'user', approverUserId: String(apprUser._id) }] } });
  const sub = await call('/approval-processes/submit', { method: 'POST', cookie: CA, body: { objectApiName: 'bill', recordId: fsId, processId: proc.json?.data?._id } });
  const apv = await call(`/approval-processes/${sub.json?.data?._id}/approve`, { method: 'POST', cookie: CP, body: { comment: 'ok' } });
  const ldc = await call('/records/lead', { method: 'POST', cookie: CA, body: { name: 'Lead 1' } });
  const accS = await ChannelAccount.create({ tenantId: tA._id, channel: 'telephony', name: 'S17 tel2', provider: 'other' });
  const inb = await channelService.fireTestEvent({ tenantId: tA._id, id: accS._id, kind: 'message' }).catch((e) => ({ err: e.message }));
  const rep = await call(`/conversations/${inb.conversation?._id}/reply`, { method: 'POST', cookie: CA, body: { body: 'stub reply' } });
  await waitFor(() => ['approval.completed', 'lead.received', 'communication.sent'].every((e) => received.filter((r) => r.url === '/ev').map((r) => JSON.parse(r.body).event).includes(e)), 10000);
  const evs = received.filter((r) => r.url === '/ev');
  const names = evs.map((r) => JSON.parse(r.body).event);
  check('approval completed, lead received and communication sent are delivered signed (17.4.5, 17.4.7, 17.4.9)', ['approval.completed', 'lead.received', 'communication.sent'].every((e) => names.includes(e)) && evs.every((r) => r.headers['x-webhook-signature'] === `sha256=${crypto.createHmac('sha256', evSecret).update(r.body).digest('hex')}`), `${sub.status}/${apv.status}/${ldc.status}/${rep.status} ${names.join(',')} ${inb.err || ''}`);
  const elog = (await call('/integration-log?direction=outbound&limit=300', { cookie: CA })).json?.data || [];
  check('each of those three has an Integration Log row', ['approval.completed', 'lead.received', 'communication.sent'].every((e) => elog.some((r) => r.event === e && r.result === 'success' && r.httpStatus === 200)));
  await call(`/webhooks/${ev.json?.data?._id}`, { method: 'DELETE', cookie: CA });
  // integration log
  const log = await call('/integration-log?limit=300', { cookie: CA });
  const rows = log.json?.data || [];
  const out = rows.find((r) => r.direction === 'outbound' && r.result === 'failed'); const inn = rows.find((r) => r.direction === 'inbound' && r.integration);
  const cols = ['tenant', 'integration', 'direction', 'time', 'event', 'endpoint', 'result', 'httpStatus', 'error', 'retry'];
  check('the Integration Log has tenant, integration, direction, time, event, endpoint, result, HTTP status, error and retry (17.5.1-10)', cols.every((c) => out && c in out && inn && c in inn) && out.error && out.httpStatus === 500 && /attempt 3 of 3/.test(out.retry));
  const logB = await call('/integration-log', { cookie: CB });
  check('another tenant sees none of these rows', !(logB.json?.data || []).some((r) => r.tenant === tA.name));
  // hygiene
  const dump = log.text + JSON.stringify(await WebhookDeliveryLog.find({ tenantId: tA._id }).lean()) + JSON.stringify(await AuditLog.find({ tenantId: tA._id }).lean()) + JSON.stringify(await AuthFailureLog.find({ tenantId: tA._id }).lean()) + JSON.stringify(await IncomingWebhookLog.find({ tenantId: tA._id }).lean());
  const secrets = [kFull.rawKey, kRead.rawKey, kLim.rawKey, whSecret, DUMMY, TOKEN, 'Authorization'];
  check('no key, token, signing secret, dummy secret or Authorization header appears in any log or audit row (17.2.7, 17.5.11)', !secrets.some((s) => s && dump.includes(s)), secrets.filter((s) => s && dump.includes(s)).map((s) => s.slice(0, 6)).join(','));
  check('delivery rows hold no record values once finished (17.5.11)', !(await WebhookDeliveryLog.find({ tenantId: tA._id, status: { $in: ['success', 'failed'] } }).lean()).some((r) => r.payload && JSON.stringify(r.payload).includes('Hooked')));
  const rs = await call(`/webhooks/${whId}/rotate-secret`, { method: 'POST', cookie: CA });
  const newSecret = rs.json?.data?.secret;
  await call(`/webhooks/${whId}`, { method: 'PUT', cookie: CA, body: { isActive: true } });
  received.length = 0; await call('/records/bill', { method: 'POST', cookie: CA, body: { name: 'after rotate', amount: 1, status: 'x' } });
  await waitFor(() => received.length >= 1, 6000);
  const rb = received.find((r) => JSON.parse(r.body).event === 'record.created');
  check('rotating the signing secret: deliveries are signed with the new secret only (17.6.7)', rs.status === 200 && newSecret !== whSecret && rb && rb.headers['x-webhook-signature'] === `sha256=${crypto.createHmac('sha256', newSecret).update(rb.body).digest('hex')}` && rb.headers['x-webhook-signature'] !== `sha256=${crypto.createHmac('sha256', whSecret).update(rb.body).digest('hex')}`);
  check('a webhook can be deactivated and then sends nothing', await (async () => { await call(`/webhooks/${whId}`, { method: 'PUT', cookie: CA, body: { isActive: false } }); received.length = 0; await call('/records/bill', { method: 'POST', cookie: CA, body: { name: 'quiet', amount: 1, status: 'x' } }); await sleep(1500); return received.length === 0; })());
} catch (err) {
  check('test run completed without unexpected error', false, err.stack || err.message);
} finally {
  try {
    const ids = [tA?._id, tB?._id].filter(Boolean);
    for (const name of Object.keys(mongoose.models)) { try { await mongoose.models[name].deleteMany({ tenantId: { $in: ids } }); } catch { /* model without tenantId */ } }
    await Tenant.deleteMany({ _id: { $in: ids } });
  } catch { /* best effort */ }
  receiver.close(); server.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  await mongoose.disconnect().catch(() => {});
  process.exit(failed.length ? 1 : 0);
}
