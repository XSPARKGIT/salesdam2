import 'dotenv/config';
import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import app from '../app.js';
import Tenant from '../models/Tenant.js';
import User from '../models/User.js';
import Role from '../models/Role.js';
import ObjectMeta from '../models/ObjectMeta.js';
import DynamicRecord from '../models/DynamicRecord.js';
import FieldMeta from '../models/FieldMeta.js';
import CommunicationPreference from '../models/CommunicationPreference.js';
import Consent from '../models/Consent.js';
import { seedWorkspace } from './helpers/workspace.mjs';

const RUN = Date.now().toString(36);
const PASSWORD = 'Cons23Test!';
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
  const sc = res.headers.getSetCookie?.() || [];
  return sc.map((c) => c.split(';')[0]).find((c) => c.startsWith('crm.sid=')) || '';
};

let tA, tB;
try {
  await connectDB();
  tA = await Tenant.create({ name: `ZZ_CONS23_A_${RUN}`, slug: `zz-cons23-a-${RUN}`, status: 'active', plan: 'enterprise' });
  tB = await Tenant.create({ name: `ZZ_CONS23_B_${RUN}`, slug: `zz-cons23-b-${RUN}`, status: 'active', plan: 'enterprise' });
  const adminRoleA = await Role.create({ tenantId: tA._id, name: 'admin', label: 'Admin', dataAccess: 'all', objectPermissions: [{ objectApiName: 'contact', canCreate: true, canRead: true, canUpdate: true, canDelete: true }], appPermissions: { canManageTenantSettings: true } });
  const adminRoleB = await Role.create({ tenantId: tB._id, name: 'admin', label: 'Admin', dataAccess: 'all', objectPermissions: [{ objectApiName: 'contact', canCreate: true, canRead: true, canUpdate: true, canDelete: true }], appPermissions: {} });
  const adminA = await User.create({ tenantId: tA._id, firstName: 'AdminA', lastName: 'Test', email: `admina-${RUN}@example.com`, username: `admina_${RUN}`, password: PASSWORD, role: adminRoleA._id, status: 'active', emailVerified: true });
  const adminB = await User.create({ tenantId: tB._id, firstName: 'AdminB', lastName: 'Test', email: `adminb-${RUN}@example.com`, username: `adminb_${RUN}`, password: PASSWORD, role: adminRoleB._id, status: 'active', emailVerified: true });

  await ObjectMeta.create({ tenantId: tA._id, name: 'Contact', label: 'Contact', pluralLabel: 'Contacts', apiName: 'contact', nameFieldApiName: 'name', isActive: true, searchable: true });
  const objA = await ObjectMeta.findOne({ tenantId: tA._id, apiName: 'contact' });
  await FieldMeta.create({ tenantId: tA._id, objectId: objA._id, objectApiName: 'contact', name: 'Name', label: 'Name', apiName: 'name', type: 'text' });
  const rec = await DynamicRecord.create({ tenantId: tA._id, objectId: objA._id, objectApiName: 'contact', ownerId: adminA._id, createdBy: adminA._id, data: { name: 'Test Contact' } });
  await seedWorkspace(tA._id, [adminA._id], ['contact']);
  await seedWorkspace(tB._id, [adminB._id], ['contact']);

  const CA = await loginCookie(adminA.email);
  const CB = await loginCookie(adminB.email);
  check('admins auth', Boolean(CA && CB));

  // ── Preferences: create/update/persist ──
  const pref0 = await req(`/api/v1/communication/preferences?objectApiName=contact&recordId=${rec._id}`, { cookie: CA });
  check('get preferences (200)', pref0.status === 200, `HTTP ${pref0.status}`);
  const savePref = await req('/api/v1/communication/preferences', { method: 'PUT', cookie: CA, body: { objectApiName: 'contact', recordId: rec._id, email: 'opted_out', whatsapp: 'opted_in', marketing: 'granted', preferredChannel: 'email' } });
  check('save preferences (200)', savePref.status === 200, `HTTP ${savePref.status}`);
  const pref1 = await req(`/api/v1/communication/preferences?objectApiName=contact&recordId=${rec._id}`, { cookie: CA });
  check('preferences persisted (email=opted_out)', pref1.json?.data?.email === 'opted_out', `email=${pref1.json?.data?.email}`);
  check('preferences persisted (whatsapp=opted_in)', pref1.json?.data?.whatsapp === 'opted_in', `whatsapp=${pref1.json?.data?.whatsapp}`);
  check('preferences persisted (marketing=granted)', pref1.json?.data?.marketing === 'granted', `marketing=${pref1.json?.data?.marketing}`);

  // ── Consent evidence ──
  const consent = await req('/api/v1/communication/consent', { method: 'POST', cookie: CA, body: { objectApiName: 'contact', recordId: rec._id, status: 'granted', purpose: 'marketing', source: 'web form' } });
  check('record consent evidence (201)', [200, 201].includes(consent.status), `HTTP ${consent.status}`);
  const consentList = await req(`/api/v1/communication/consent?objectApiName=contact&recordId=${rec._id}`, { cookie: CA });
  check('consent evidence listed (200)', consentList.status === 200, `HTTP ${consentList.status}`);
  check('consent evidence has entry', (consentList.json?.data || []).length > 0, `count=${(consentList.json?.data || []).length}`);

  // ── Consent check (canContact) ──
  const checkAllowed = await req('/api/v1/consents/check', { method: 'POST', cookie: CA, body: { tenantId: tA._id, subjectType: 'contact', subjectId: rec._id, channel: 'email' } });
  check('consent check returns result', checkAllowed.status === 200, `HTTP ${checkAllowed.status}`);

  // ── Opted-out blocks when enforced ──
  await req('/api/v1/configuration/consent.enforcement', { method: 'PUT', cookie: CA, body: { value: true } });
  const checkBlocked = await req('/api/v1/consents/check', { method: 'POST', cookie: CA, body: { tenantId: tA._id, subjectType: 'contact', subjectId: rec._id, channel: 'email' } });
  // email is opted_out → should be blocked
  check('opted-out email blocked when enforced', checkBlocked.json?.data?.allowed === false, `allowed=${checkBlocked.json?.data?.allowed} reason=${checkBlocked.json?.data?.reason}`);

  // ── Disable enforcement → allowed ──
  await req('/api/v1/configuration/consent.enforcement', { method: 'PUT', cookie: CA, body: { value: false } });
  const checkAllowed2 = await req('/api/v1/consents/check', { method: 'POST', cookie: CA, body: { tenantId: tA._id, subjectType: 'contact', subjectId: rec._id, channel: 'email' } });
  check('enforcement disabled → allowed', checkAllowed2.json?.data?.allowed === true, `allowed=${checkAllowed2.json?.data?.allowed}`);

  // Re-enable enforcement
  await req('/api/v1/configuration/consent.enforcement', { method: 'PUT', cookie: CA, body: { value: true } });

  // ── Withdrawn consent ──
  await req('/api/v1/communication/consent', { method: 'POST', cookie: CA, body: { objectApiName: 'contact', recordId: rec._id, status: 'withdrawn', purpose: 'marketing', source: 'test' } });
  const checkWithdrawn = await req('/api/v1/consents/check', { method: 'POST', cookie: CA, body: { tenantId: tA._id, subjectType: 'contact', subjectId: rec._id, channel: 'marketing' } });
  check('withdrawn consent blocked', checkWithdrawn.json?.data?.allowed === false, `allowed=${checkWithdrawn.json?.data?.allowed} reason=${checkWithdrawn.json?.data?.reason}`);

  // ── Unknown consent follows default ──
  const rec2 = await DynamicRecord.create({ tenantId: tA._id, objectId: objA._id, objectApiName: 'contact', ownerId: adminA._id, createdBy: adminA._id, data: { name: 'Unknown Contact' } });
  const checkUnknown = await req('/api/v1/consents/check', { method: 'POST', cookie: CA, body: { tenantId: tA._id, subjectType: 'contact', subjectId: rec2._id, channel: 'email' } });
  check('unknown consent follows default (true)', checkUnknown.json?.data?.allowed === true, `allowed=${checkUnknown.json?.data?.allowed}`);

  // ── Tenant isolation ──
  const crossPref = await req(`/api/v1/communication/preferences?objectApiName=contact&recordId=${rec._id}`, { cookie: CB });
  check('tenant isolation: B cannot read A prefs (403/404)', crossPref.status === 403 || crossPref.status === 404, `HTTP ${crossPref.status}`);

  // ── Unauthorized ──
  const unauth = await req('/api/v1/communication/preferences?objectApiName=contact&recordId=' + rec._id);
  check('unauthorized prefs access (401)', unauth.status === 401, `HTTP ${unauth.status}`);

  // ── Persistence after refresh ──
  const pref2 = await req(`/api/v1/communication/preferences?objectApiName=contact&recordId=${rec._id}`, { cookie: CA });
  check('preferences persist after reload', pref2.json?.data?.email === 'opted_out', `email=${pref2.json?.data?.email}`);

  // ── Consent evidence persisted ──
  const consents = await req(`/api/v1/communication/consent?objectApiName=contact&recordId=${rec._id}`, { cookie: CA });
  check('consent evidence persisted', (consents.json?.data || []).length > 0, `count=${(consents.json?.data || []).length}`);

} catch (err) {
  console.error('TEST RUN ERROR:', err);
  check('test run completed without unexpected error', false, err.message);
} finally {
  try {
    if (tA) {
      const tid = tA._id;
      await Promise.all([
        DynamicRecord.deleteMany({ tenantId: tid }),
        ObjectMeta.deleteMany({ tenantId: tid }),
        FieldMeta.deleteMany({ tenantId: tid }),
        User.deleteMany({ tenantId: tid }),
        Role.deleteMany({ tenantId: tid }),
        Tenant.deleteOne({ _id: tid }),
      ]);
    }
    if (tB) {
      const tid = tB._id;
      await Promise.all([
        DynamicRecord.deleteMany({ tenantId: tid }),
        ObjectMeta.deleteMany({ tenantId: tid }),
        User.deleteMany({ tenantId: tid }),
        Role.deleteMany({ tenantId: tid }),
        Tenant.deleteOne({ _id: tid }),
      ]);
    }
    await mongoose.connection.close();
  } catch (e) { console.error('cleanup', e.message); }
  server.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  process.exit(failed.length ? 1 : 0);
}
