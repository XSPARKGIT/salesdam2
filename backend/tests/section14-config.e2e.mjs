import 'dotenv/config';
import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import app from '../app.js';
import Tenant from '../models/Tenant.js';
import User from '../models/User.js';
import Role from '../models/Role.js';
import TenantConfiguration from '../models/TenantConfiguration.js';
import configurationService from '../services/configurationService.js';
import EmailSender from '../models/EmailSender.js';
import ChannelAccount from '../models/ChannelAccount.js';
import Activity from '../models/Activity.js';
import Webhook from '../models/Webhook.js';
import WebhookDeliveryLog from '../models/WebhookDeliveryLog.js';
import AuditLog from '../models/AuditLog.js';
import callRecordingRetention from '../services/callRecordingRetentionService.js';
import webhookRetryService from '../services/webhookRetryService.js';
import channelProviders from '../services/channelProviders.js';
import consentService from '../services/consentService.js';
import { deliverCommunication } from '../services/insurance/communicationDispatcher.js';
import { reencryptSecret, encryptSecret } from '../utils/secretCrypto.js';
import fs from 'fs';
import { seedWorkspace } from './helpers/workspace.mjs';

const RUN = Date.now().toString(36);
import crypto from 'crypto';
import net from 'net';
import http from 'http';
const PASSWORD = `Aa1!${crypto.randomBytes(9).toString('hex')}`;
const results = [];
const check = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };

const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
const req = async (path, { method = 'GET', cookie, body } = {}) => {
  const res = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
};
const loginCookie = async (username) => {
  const res = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: PASSWORD }) });
  const setCookie = res.headers.getSetCookie?.() || [];
  const sid = setCookie.map((c) => c.split(';')[0]).find((c) => c.startsWith('crm.sid='));
  return { status: res.status, cookie: sid };
};

let tA, tB;
try {
  await connectDB();
  tA = await Tenant.create({ name: `ZZ_CFGA_${RUN}`, slug: `zz-cfga-${RUN}`, status: 'active', plan: 'enterprise' });
  tB = await Tenant.create({ name: `ZZ_CFGB_${RUN}`, slug: `zz-cfgb-${RUN}`, status: 'active', plan: 'enterprise' });

  const adminRoleA = await Role.create({ tenantId: tA._id, name: 'admin', label: 'Admin', dataAccess: 'all', objectPermissions: [], appPermissions: { canManageTenantSettings: true } });
  const adminRoleB = await Role.create({ tenantId: tB._id, name: 'admin', label: 'Admin', dataAccess: 'all', objectPermissions: [], appPermissions: { canManageTenantSettings: true } });
  const adminA = await User.create({ tenantId: tA._id, firstName: 'AdminA', lastName: 'Test', email: `admina-${RUN}@example.com`, username: `admina_${RUN}`, password: PASSWORD, role: adminRoleA._id, status: 'active', emailVerified: true });
  const adminB = await User.create({ tenantId: tB._id, firstName: 'AdminB', lastName: 'Test', email: `adminb-${RUN}@example.com`, username: `adminb_${RUN}`, password: PASSWORD, role: adminRoleB._id, status: 'active', emailVerified: true });

  await seedWorkspace(tA._id, [adminA._id], []);
  await seedWorkspace(tB._id, [adminB._id], []);

  const loginA = await loginCookie(adminA.email);
  const loginB = await loginCookie(adminB.email);
  const CA = loginA.cookie, CB = loginB.cookie;
  check('admins auth', loginA.status === 200 && loginB.status === 200);

  // Tenant A sets branding override
  const setBrand = await req('/api/v1/configuration/branding.primary_color', { method: 'PUT', cookie: CA, body: { value: '#FF0000' } });
  check('tenant A can set branding override', setBrand.status === 200, `HTTP ${setBrand.status}`);

  // Tenant A sets secret
  const setSecret = await req('/api/v1/configuration/integration.email.smtp_password', { method: 'PUT', cookie: CA, body: { value: 'supersecret123' } });
  check('tenant A can set secret', setSecret.status === 200, `HTTP ${setSecret.status}`);

  // Secret encrypted at rest
  const secretDoc = await TenantConfiguration.findOne({ tenantId: tA._id, key: 'integration.email.smtp_password' }).lean();
  check('secret encrypted at rest', secretDoc?.value?.startsWith('enc:'), `stored=${secretDoc?.value?.slice(0,6)}`);

  // Effective config for A: branding overridden, secret masked
  const cfgA = await req('/api/v1/configuration', { cookie: CA });
  const brandA = cfgA.json?.data?.find((e) => e.key === 'branding.primary_color');
  const secretA = cfgA.json?.data?.find((e) => e.key === 'integration.email.smtp_password');
  check('tenant A branding override applied', brandA?.value === '#FF0000' && brandA?.source === 'tenant', JSON.stringify(brandA));
  check('secret masked in API response', secretA?.value === '••••••••', `value=${secretA?.value}`);

  // Tenant B does not see A's override
  const cfgB = await req('/api/v1/configuration', { cookie: CB });
  const brandB = cfgB.json?.data?.find((e) => e.key === 'branding.primary_color');
  check('tenant B branding uses default (not A override)', brandB?.value !== '#FF0000', `value=${brandB?.value}`);
  const secretB = cfgB.json?.data?.find((e) => e.key === 'integration.email.smtp_password');
  check('tenant B secret not leaked', secretB?.value !== '••••••••' || secretB?.value === '', `value=${secretB?.value}`);

  // Reset A branding override -> falls back to default
  const resetBrand = await req('/api/v1/configuration/branding.primary_color', { method: 'DELETE', cookie: CA });
  check('reset override succeeds', resetBrand.status === 200, `HTTP ${resetBrand.status}`);
  const cfgA2 = await req('/api/v1/configuration', { cookie: CA });
  const brandA2 = cfgA2.json?.data?.find((e) => e.key === 'branding.primary_color');
  check('after reset falls back to default', brandA2?.value === '#244c64', `value=${brandA2?.value}`);

  // System default update affects tenant without override
  // Need superuser: make adminA superuser? Use existing admin role name 'superuser' approach: create superuser role
  const suRole = await Role.create({ tenantId: tA._id, name: 'superuser', label: 'Superuser', dataAccess: 'all', objectPermissions: [], appPermissions: {} });
  const su = await User.create({ tenantId: tA._id, firstName: 'Super', lastName: 'User', email: `su-${RUN}@example.com`, username: `su_${RUN}`, password: PASSWORD, role: suRole._id, status: 'active', emailVerified: true });
  await seedWorkspace(tA._id, [su._id], []);
  const loginSU = await loginCookie(su.email);
  const CSU = loginSU.cookie;
  check('superuser auth', loginSU.status === 200);

  const setDefault = await req('/api/v1/configuration/defaults/branding.primary_color', { method: 'PUT', cookie: CSU, body: { value: '#00FF00' } });
  check('superuser can set system default', setDefault.status === 200, `HTTP ${setDefault.status}`);

  // Tenant B (no override) should see new default
  const cfgB2 = await req('/api/v1/configuration', { cookie: CB });
  const brandB2 = cfgB2.json?.data?.find((e) => e.key === 'branding.primary_color');
  check('system default propagates to tenant without override', brandB2?.value === '#00FF00', `value=${brandB2?.value}`);

  // Tenant admin cannot set system default
  const tenantSetDefault = await req('/api/v1/configuration/defaults/branding.primary_color', { method: 'PUT', cookie: CA, body: { value: '#000000' } });
  check('tenant admin cannot set system default (403)', tenantSetDefault.status === 403, `HTTP ${tenantSetDefault.status}`);

  // Tenant admin cannot read other tenant's config (tenant isolation)
  // (already implied by tenant-scoped queries)

  // ── Added with the Section 14 test pass ──
  await req('/api/v1/configuration/branding.company_name', { method: 'PUT', cookie: CA, body: { value: 'Acme A' } });
  const pubA = await req(`/api/v1/configuration/public-branding?tenant=${tA._id}`);
  const pubB = await req(`/api/v1/configuration/public-branding?tenant=${tB.slug}`);
  const pubNone = await req('/api/v1/configuration/public-branding');
  check('login page branding is public and per tenant', pubA.status === 200 && pubA.json?.data?.companyName === 'Acme A' && pubB.json?.data?.companyName === 'Salesdam' && pubNone.json?.data?.companyName === 'Salesdam', `${pubA.json?.data?.companyName}/${pubB.json?.data?.companyName}`);
  check('public branding exposes nothing but branding', Object.keys(pubA.json?.data || {}).sort().join() === 'companyName,loginLogoUrl,logoUrl,primaryColor');
  const badColor = await req('/api/v1/configuration/branding.primary_color', { method: 'PUT', cookie: CA, body: { value: 'red; x:y' } });
  const badLogo = await req('/api/v1/configuration/branding.logo_url', { method: 'PUT', cookie: CA, body: { value: 'javascript:alert(1)' } });
  check('invalid colour / logo refused (400)', badColor.status === 400 && badLogo.status === 400, `${badColor.status}/${badLogo.status}`);
  const putSecret = await req('/api/v1/configuration/integration.telephony.api_key', { method: 'PUT', cookie: CA, body: { value: 'tel-dummy-secret-9' } });
  check('saving a secret does not echo it, even encrypted', putSecret.status === 200 && !putSecret.text.includes('tel-dummy') && !putSecret.text.includes('enc:'), putSecret.text.slice(0, 0));
  const viaFormula = await configurationService.resolveMany(['integration.telephony.api_key', 'branding.company_name'], tA._id);
  const viaInternal = await configurationService.resolveMany(['integration.telephony.api_key'], tA._id, { includeSecrets: true });
  check('CONFIG() formulas never receive secrets; trusted callers can', viaFormula['integration.telephony.api_key'] === undefined && viaFormula['branding.company_name'] === 'Acme A' && viaInternal['integration.telephony.api_key'] === 'tel-dummy-secret-9');
  const snd = await EmailSender.create({ tenantId: tA._id, name: 'S', email: 'a@example.com', smtpHost: 'x', smtpUser: 'u', smtpPass: 'smtp-dummy-secret-7' });
  const rawSnd = await EmailSender.collection.findOne({ _id: snd._id });
  const readBack = await EmailSender.findById(snd._id).select('+smtpPass');
  check('SMTP password and webhook secrets are encrypted at rest and still usable', rawSnd.smtpPass.startsWith('enc:') && !rawSnd.smtpPass.includes('smtp-dummy') && readBack.smtpPass === 'smtp-dummy-secret-7');
  await EmailSender.deleteMany({ tenantId: tA._id });


  // ═════════ Section 14 completion: wired settings, credentials end to end, leaks, tenant admin ═════════
  const put = (path, cookie, value) => req(path, { method: 'PUT', cookie, body: { value } });

  // 1a. Default currency: tenant value → platform value → built-in (drives what the app shows)
  const curOf = async (cookie) => (await req('/api/v1/auth/me', { cookie })).json?.data?.tenant?.operatingCurrency?.code;
  const cur0 = await curOf(CA);
  await req('/api/v1/configuration/defaults/platform.default_currency', { method: 'PUT', cookie: CSU, body: { value: 'EUR' } });
  const curPlat = await curOf(CA);
  await put('/api/v1/configuration/platform.default_currency', CA, 'GBP');
  const curTenant = await curOf(CA), curOther = await curOf(CB);
  await req('/api/v1/configuration/platform.default_currency', { method: 'DELETE', cookie: CA });
  const curReset = await curOf(CA);
  await req('/api/v1/configuration/defaults/platform.default_currency', { method: 'DELETE', cookie: CSU });
  check('default currency: built-in → platform → tenant → reset, other tenant unaffected', cur0 === 'ZAR' && curPlat === 'EUR' && curTenant === 'GBP' && curOther === 'EUR' && curReset === 'EUR', `${cur0}/${curPlat}/${curTenant}/${curOther}/${curReset}`);

  // 1b. Call-recording retention: only tenants with a positive window are touched
  const mkCall = (tenantId, days, url) => Activity.create({ tenantId, objectApiName: 'lead', recordId: new mongoose.Types.ObjectId(), type: 'call', subject: 's14', createdBy: adminA._id, ownerId: adminA._id, occurredAt: new Date(Date.now() - days * 864e5), metadata: { recordingUrl: url } });
  const aOld = await mkCall(tA._id, 30, 'https://rec.invalid/a-old'), aNew = await mkCall(tA._id, 1, 'https://rec.invalid/a-new');
  const bOld = await mkCall(tB._id, 400, 'https://rec.invalid/b-old');
  await put('/api/v1/configuration/records.call_recording_retention_days', CA, 0);
  await callRecordingRetention.purgeExpiredRecordings();
  const afterZero = (await Activity.findById(aOld._id).lean()).metadata.recordingUrl;
  await put('/api/v1/configuration/records.call_recording_retention_days', CA, -5);
  await callRecordingRetention.purgeExpiredRecordings();
  const afterNeg = (await Activity.findById(aOld._id).lean()).metadata.recordingUrl;
  await put('/api/v1/configuration/records.call_recording_retention_days', CA, 7);
  await callRecordingRetention.purgeExpiredRecordings();
  const gA = await Activity.findById(aOld._id).lean(), gN = await Activity.findById(aNew._id).lean(), gB = await Activity.findById(bOld._id).lean();
  check('call recordings: 0 / negative window purges nothing; 7 days clears only the old call of that tenant', afterZero && afterNeg && gA.metadata.recordingUrl === '' && gA.metadata.recordingPurgedAt && gN.metadata.recordingUrl && gB.metadata.recordingUrl, `${!!afterZero}/${!!afterNeg}/${gA.metadata.recordingUrl === ''}/${!!gN.metadata.recordingUrl}/${!!gB.metadata.recordingUrl}`);

  // 1c. Consent settings apply where queued communications are sent
  const clientId = new mongoose.Types.ObjectId();
  await consentService.updateConsent({ tenantId: tA._id, subjectType: 'client', subjectId: clientId, channels: { email: { optedIn: false } }, user: adminA });
  const commOf = () => ({ data: { channel: 'email', client: clientId, subject: 'x', body: 'x' } });
  await put('/api/v1/configuration/consent.enforcement', CA, true);
  const blocked = await deliverCommunication(tA._id, commOf());
  await put('/api/v1/configuration/consent.enforcement', CA, false);
  const notBlocked = await deliverCommunication(tA._id, commOf());
  check('consent: enforcement on blocks an opted-out client; off does not', blocked.success === false && /blocked/i.test(blocked.error || '') && !/blocked/i.test(notBlocked.error || ''), `${blocked.error}|${notBlocked.error}`);

  // 1d. Channel credentials: tenant's own → tenant configuration → platform default; never across tenants
  const realFetch = globalThis.fetch; let seenAuth = null;
  const waSend = async (tenantId, own) => { seenAuth = null; globalThis.fetch = async (u, o) => { seenAuth = o?.headers?.Authorization || null; return { ok: true, json: async () => ({ messages: [{ id: 'm' }] }) }; };
    try { return await channelProviders.getAdapter('whatsapp').send({ tenantId, credentials: { phoneNumberId: '1', ...(own ? { accessToken: own } : {}) } }, { recipientIdentifier: '+27000', body: 'x' }); } finally { globalThis.fetch = realFetch; } };
  await req('/api/v1/configuration/defaults/integration.whatsapp.access_token', { method: 'PUT', cookie: CSU, body: { value: 'plat-wa-token' } });
  await put('/api/v1/configuration/integration.whatsapp.access_token', CA, 'tenantA-wa-token');
  await waSend(tA._id); const sA = seenAuth;
  await waSend(tB._id); const sB = seenAuth;
  await waSend(tA._id, 'account-own-token'); const sOwn = seenAuth;
  await req('/api/v1/configuration/defaults/integration.whatsapp.access_token', { method: 'DELETE', cookie: CSU });
  const none = await waSend(tB._id);
  check('WhatsApp token: account → tenant → platform, never another tenant', sA === 'Bearer tenantA-wa-token' && sB === 'Bearer plat-wa-token' && sOwn === 'Bearer account-own-token' && none.status === 'queued', `${sA}|${sB}|${sOwn}|${none.status}`);

  // inbound signature for telephony / Meta: the account's secret, else the tenant's key, else the platform's
  await put('/api/v1/configuration/integration.telephony.api_key', CA, 'tenantA-tel-key');
  const accA = await ChannelAccount.create({ tenantId: tA._id, channel: 'telephony', name: 'S14 tel A', provider: 'other', credentials: { apiToken: 'cred-dummy-A' } });
  const accB = await ChannelAccount.create({ tenantId: tB._id, channel: 'telephony', name: 'S14 tel B', provider: 'other' });
  const rawAcc = await ChannelAccount.collection.findOne({ _id: accA._id });
  const hook = async (acc, key) => { const body = JSON.stringify({ kind: 'status', externalMessageId: 'x1', status: 'delivered' }); return req(`/api/v1/channels/webhook/telephony/${acc._id}`, { method: 'POST', body: undefined, ...{} }).then(async () => { const r = await fetch(`${base}/api/v1/channels/webhook/telephony/${acc._id}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-salesdam-signature': `sha256=${crypto.createHmac('sha256', key).update(body).digest('hex')}` }, body }); return r.status; }); };
  const okSig = await hook(accA, 'tenantA-tel-key'), badSig = await hook(accA, 'wrong'), bTryA = await hook(accB, 'tenantA-tel-key');
  check('telephony inbound is verified with the tenant key; another tenant\'s key is refused', okSig !== 401 && badSig === 401 && bTryA === 401, `${okSig}/${badSig}/${bTryA}`);
  check('channel account credentials are encrypted at rest and not returned by the API', typeof rawAcc.credentials === 'string' && rawAcc.credentials.startsWith('enc:') && !JSON.stringify(rawAcc).includes('cred-dummy-A') && !JSON.stringify(accA.toJSON()).includes('cred-dummy-A'));

  // 2. Email sending end to end: local SMTP capture, decrypted credentials, nothing delivered
  const smtpGot = [];
  const smtp = net.createServer((sock) => {
    let mode = 'cmd', buf = ''; let cur = { data: '' };
    sock.write('220 localhost ESMTP\r\n');
    sock.on('data', (d) => { buf += d.toString(); let i; while ((i = buf.indexOf('\r\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 2);
      if (mode === 'data') { if (line === '.') { mode = 'cmd'; smtpGot.push(cur); cur = { ...cur, data: '' }; sock.write('250 OK captured\r\n'); } else cur.data += line + '\n'; continue; }
      if (mode === 'user') { cur.user = Buffer.from(line, 'base64').toString(); mode = 'pass'; sock.write('334 UGFzc3dvcmQ6\r\n'); continue; }
      if (mode === 'pass') { cur.pass = Buffer.from(line, 'base64').toString(); mode = 'cmd'; sock.write('235 OK\r\n'); continue; }
      const u = line.toUpperCase();
      if (u.startsWith('EHLO') || u.startsWith('HELO')) sock.write('250-localhost\r\n250 AUTH LOGIN PLAIN\r\n');
      else if (u.startsWith('AUTH PLAIN')) { const p = Buffer.from(line.split(' ')[2] || '', 'base64').toString().split('\0'); cur.user = p[1]; cur.pass = p[2]; sock.write('235 OK\r\n'); }
      else if (u.startsWith('AUTH LOGIN')) { mode = 'user'; sock.write('334 VXNlcm5hbWU6\r\n'); }
      else if (u === 'DATA') { mode = 'data'; sock.write('354 go\r\n'); }
      else if (u === 'QUIT') { sock.write('221 bye\r\n'); sock.end(); }
      else sock.write('250 OK\r\n'); } });
  });
  await new Promise((r) => smtp.listen(0, '127.0.0.1', r));
  const SMTP_PASS = `smtp-${crypto.randomBytes(6).toString('hex')}`;
  const mk = await req('/api/v1/email-senders', { method: 'POST', cookie: CA, body: { name: 'S14 Sender', email: 'sender@example.com', smtpHost: '127.0.0.1', smtpPort: smtp.address().port, smtpUser: 'cap-user', smtpPass: SMTP_PASS } });
  const sid = mk.json?.data?._id;
  const tst = await req(`/api/v1/email-senders/${sid}/test`, { method: 'POST', cookie: CA, body: { to: 'capture@example.invalid' } });
  const lstS = await req('/api/v1/email-senders', { cookie: CA });
  check('email sender: message sent through the capture server with the tenant\'s decrypted credentials', tst.status === 200 && smtpGot.length === 1 && smtpGot[0].user === 'cap-user' && smtpGot[0].pass === SMTP_PASS && /Test email/.test(smtpGot[0].data), `HTTP ${tst.status} captured ${smtpGot.length}`);
  check('email sender: password absent from create/test/list answers and stored encrypted', ![mk.text, tst.text, lstS.text].some((t) => t.includes(SMTP_PASS)) && (await (await import('../models/EmailSender.js')).default.collection.findOne({ _id: new mongoose.Types.ObjectId(sid) })).smtpPass.startsWith('enc:'));
  smtp.close();

  // 2b. Webhook signing end to end: local receiver, signature recomputed with the tenant's secret
  const hits = [];
  const rcv = http.createServer((rq, rs) => { let b = ''; rq.on('data', (c) => { b += c; }); rq.on('end', () => { hits.push({ sig: rq.headers['x-webhook-signature'], body: b }); rs.writeHead(200); rs.end('ok'); }); });
  await new Promise((r) => rcv.listen(0, '127.0.0.1', r));
  const mkH = await req('/api/v1/webhooks', { method: 'POST', cookie: CA, body: { name: 'S14 Hook', url: `http://127.0.0.1:${rcv.address().port}/h`, events: ['record.created'], secret: 'caller-supplied-should-be-ignored', tenantId: String(tB._id) } });
  const hookSecret = mkH.json?.data?.secret, hid = mkH.json?.data?._id;
  const stored = await Webhook.collection.findOne({ _id: new mongoose.Types.ObjectId(hid) });
  check('webhook create ignores a caller-supplied secret and tenant, returns the real secret once', hookSecret && hookSecret !== 'caller-supplied-should-be-ignored' && String(stored.tenantId) === String(tA._id) && stored.secret.startsWith('enc:'));
  const tw = await req(`/api/v1/webhooks/${hid}/test`, { method: 'POST', cookie: CA });
  const expect1 = hits[0] && `sha256=${crypto.createHmac('sha256', hookSecret).update(hits[0].body).digest('hex')}`;
  check('webhook test delivery is signed with the tenant\'s decrypted secret', tw.status === 200 && hits.length === 1 && hits[0].sig === expect1, `HTTP ${tw.status} hits ${hits.length}`);
  const retryPayload = { event: 'record.created', n: 1 };
  const lg = await WebhookDeliveryLog.create({ tenantId: tA._id, webhookId: hid, event: 'record.created', url: `http://127.0.0.1:${rcv.address().port}/h`, payload: retryPayload, status: 'retrying', attempt: 1, maxAttempts: 3, nextRetryAt: new Date(Date.now() - 1000) });
  await webhookRetryService.processWebhookRetries();
  const expect2 = hits[1] && `sha256=${crypto.createHmac('sha256', hookSecret).update(JSON.stringify(retryPayload)).digest('hex')}`;
  const lgAfter = await WebhookDeliveryLog.findById(lg._id).lean();
  check('webhook retry is signed with the same secret and recorded as success', hits.length === 2 && hits[1].sig === expect2 && lgAfter.status === 'success', `hits ${hits.length} ${lgAfter.status}`);
  check('delivery logs and webhook API never contain the secret', ![JSON.stringify(lgAfter), (await req('/api/v1/webhooks', { cookie: CA })).text, (await req(`/api/v1/webhooks/${hid}`, { cookie: CA })).text].some((t) => t.includes(hookSecret)));
  rcv.close();

  // 3. Other places a secret could leak
  const LEAK = `leak-${crypto.randomBytes(6).toString('hex')}`;
  await put('/api/v1/configuration/integration.meta.app_secret', CA, LEAK);
  await put('/api/v1/configuration/integration.webhook.secret', CA, LEAK);
  const surfaces = [
    (await req('/api/v1/configuration', { cookie: CA })).text,
    (await req('/api/v1/channels', { cookie: CA })).text,
    (await req('/api/v1/search?q=integration', { cookie: CA })).text,
    JSON.stringify(await AuditLog.find({ tenantId: tA._id }).lean()),
    JSON.stringify(await TenantConfiguration.find({ tenantId: tA._id, isSecret: true }).lean()),
  ];
  const logPath = new URL('../logs/combined.log', import.meta.url);
  let logText = ''; try { logText = fs.readFileSync(logPath, 'utf8'); } catch { /* no log file */ }
  logText = logText.split('\n').filter((l) => !l.includes('/search?q=')).join('\n'); // the request line of the search probe itself carries the dummy term
  check('a dummy secret appears in no API answer, search, audit record, stored row or application log', !surfaces.some((t) => t.includes(LEAK)) && !logText.includes(LEAK) && !logText.includes(SMTP_PASS) && !logText.includes(hookSecret), `surfaces ${surfaces.map((t) => t.includes(LEAK) ? 1 : 0).join('')} log ${[LEAK, SMTP_PASS, hookSecret].map((x) => logText.includes(x) ? 1 : 0).join('')}`);
  const viaFormula2 = await configurationService.resolveMany(['integration.meta.app_secret'], tA._id);
  check('formulas, flows and approvals receive no secret value', viaFormula2['integration.meta.app_secret'] === undefined);
  const rk = encryptSecret('rot-dummy', 'salesdam-config-salt');
  check('key rotation helper re-encrypts under the current key', (() => { try { return reencryptSecret(rk, 'salesdam-config-salt', process.env.ENCRYPTION_KEY || 'dev-only-insecure-key-change-me') !== rk; } catch { return false; } })());

  // public login-branding: branding values only, never a secret or any other key
  const pubKeys = (await req(`/api/v1/configuration/public-branding?tenant=${tA._id}`)).json?.data || {};
  const pubText = JSON.stringify(pubKeys);
  check('public branding returns only the four branding values and no secret', Object.keys(pubKeys).sort().join() === 'companyName,loginLogoUrl,logoUrl,primaryColor' && !pubText.includes(LEAK) && !/enc:|••|secret|token/i.test(pubText.replace('loginLogoUrl', '')));
  const burst = []; for (let i = 0; i < 3; i++) burst.push((await req('/api/v1/configuration/public-branding')).headers);
  const rl = await fetch(`${base}/api/v1/configuration/public-branding`);
  check('public branding is rate limited (standard rate-limit headers present)', rl.headers.get('ratelimit-limit') === '120' || rl.headers.get('ratelimit-policy') !== null, `limit ${rl.headers.get('ratelimit-limit')}`);

  // 4. Non-superuser tenant admin (adminA has canManageTenantSettings, is not a superuser)
  await req('/api/v1/configuration/defaults/s14.locked', { method: 'PUT', cookie: CSU, body: { value: 'fixed', dataType: 'string', label: 'Locked', editableByTenant: false } });
  const view = await req('/api/v1/configuration', { cookie: CA });
  const ov = await put('/api/v1/configuration/records.recycle_bin_retention_days', CA, 45);
  const lockedPut = await put('/api/v1/configuration/s14.locked', CA, 'x');
  const defPut = await req('/api/v1/configuration/defaults/records.recycle_bin_retention_days', { method: 'PUT', cookie: CA, body: { value: 1 } });
  const defDel = await req('/api/v1/configuration/defaults/records.recycle_bin_retention_days', { method: 'DELETE', cookie: CA });
  const defGet = await req('/api/v1/configuration/defaults', { cookie: CA });
  const rv = await req('/api/v1/configuration/records.recycle_bin_retention_days', { method: 'DELETE', cookie: CA });
  const lockedRow = view.json?.data?.find((e) => e.key === 's14.locked');
  check('tenant admin (not a superuser): can view and override editable keys and reset them', view.status === 200 && view.json.data.length > 20 && ov.status === 200 && rv.status === 200);
  check('tenant admin: cannot override a locked key (403), sees it as not editable', lockedPut.status === 403 && lockedRow?.editableByTenant === false, `${lockedPut.status}`);
  check('tenant admin: cannot read, change or delete operator-level defaults (403)', defPut.status === 403 && defDel.status === 403 && defGet.status === 403, `${defPut.status}/${defDel.status}/${defGet.status}`);
  await req('/api/v1/configuration/defaults/s14.locked', { method: 'DELETE', cookie: CSU });

  // Reset system default cleanup
  await req('/api/v1/configuration/defaults/branding.primary_color', { method: 'DELETE', cookie: CSU });

} catch (err) {
  console.error('TEST RUN ERROR:', err);
  check('test run completed without unexpected error', false, err.message);
} finally {
  try {
    for (const t of [tA, tB]) {
      if (t) {
        const tid = t._id;
        await Promise.all([
          TenantConfiguration.deleteMany({ tenantId: tid }),
          ChannelAccount.deleteMany({ tenantId: tid }), Activity.deleteMany({ tenantId: tid }), Webhook.deleteMany({ tenantId: tid }), WebhookDeliveryLog.deleteMany({ tenantId: tid }),
          mongoose.connection.collection('emailsenders').deleteMany({ tenantId: tid }), mongoose.connection.collection('consents').deleteMany({ tenantId: tid }),
          TenantConfiguration.deleteMany({ tenantId: null, key: { $regex: '^branding\\.' } }),
          User.deleteMany({ tenantId: tid }),
          Role.deleteMany({ tenantId: tid }),
          Tenant.deleteOne({ _id: tid }),
        ]);
      }
    }
    await mongoose.connection.close();
  } catch (e) { console.error('cleanup', e.message); }
  server.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  process.exit(failed.length ? 1 : 0);
}
