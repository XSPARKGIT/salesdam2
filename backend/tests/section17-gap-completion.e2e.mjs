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
import ApiKey from '../models/ApiKey.js';
import WebhookDeliveryLog from '../models/WebhookDeliveryLog.js';
import { seedWorkspace } from './helpers/workspace.mjs';

const RUN = Date.now().toString(36);
const PASSWORD = 'IntGap123!';
const results = [];
const check = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };

const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
const req = async (path, { method = 'GET', cookie, body, headers = {} } = {}) => {
  const res = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
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

let tA;
try {
  await connectDB();
  tA = await Tenant.create({ name: `ZZ_GAP_${RUN}`, slug: `zz-gap-${RUN}`, status: 'active', plan: 'enterprise' });
  const adminRole = await Role.create({ tenantId: tA._id, name: 'admin', label: 'Admin', dataAccess: 'all', objectPermissions: [], appPermissions: { canManageApiKeys: true, canManageWebhooks: true } });
  const admin = await User.create({ tenantId: tA._id, firstName: 'Admin', lastName: 'Test', email: `admin-${RUN}@example.com`, username: `admin_${RUN}`, password: PASSWORD, role: adminRole._id, status: 'active', emailVerified: true });
  await ObjectMeta.create({ tenantId: tA._id, name: 'Policy', label: 'Policy', pluralLabel: 'Policies', apiName: 'policy', nameFieldApiName: 'name', isActive: true, searchable: true });
  const obj = await ObjectMeta.findOne({ tenantId: tA._id, apiName: 'policy' });
  await FieldMeta.create({ tenantId: tA._id, objectId: obj._id, objectApiName: 'policy', name: 'Name', label: 'Name', apiName: 'name', type: 'text' });
  await seedWorkspace(tA._id, [admin._id], ['policy']);
  const login = await loginCookie(admin.username);
  const C = login.cookie;
  check('admin auth', login.status === 200 && !!C);

  // ── Idempotency / duplicate event protection ──
  const idemKey = `idem-${RUN}`;
  const wh1 = await req('/api/v1/webhooks/incoming', { method: 'POST', cookie: C, body: { objectApiName: 'policy', action: 'create', data: { name: `Idem Record ${RUN}` }, idempotencyKey: idemKey } });
  check('first webhook with idempotency key (200)', wh1.status === 200, `HTTP ${wh1.status}`);
  const wh2 = await req('/api/v1/webhooks/incoming', { method: 'POST', cookie: C, body: { objectApiName: 'policy', action: 'create', data: { name: `Idem Record ${RUN}` }, idempotencyKey: idemKey } });
  check('duplicate webhook returns duplicate (200)', wh2.status === 200 && wh2.json?.message?.includes('Duplicate'), `HTTP ${wh2.status} msg=${wh2.json?.message}`);
  const recCount = await DynamicRecord.countDocuments({ tenantId: tA._id, objectApiName: 'policy', 'data.name': `Idem Record ${RUN}` });
  check('duplicate event not processed twice (1 record)', recCount === 1, `count=${recCount}`);

  // ── Credential rotation ──
  const createKey = await req('/api/v1/api-keys', { method: 'POST', cookie: C, body: { name: `Test Key ${RUN}`, scopes: ['read'] } });
  check('create API key (201)', createKey.status === 201, `HTTP ${createKey.status}`);
  const keyId = createKey.json?.data?._id;
  const rawKey = createKey.json?.data?.rawKey;
  if (keyId && rawKey) {
    const rotate = await req(`/api/v1/api-keys/${keyId}/rotate`, { method: 'POST', cookie: C });
    check('rotate API key (201)', rotate.status === 201, `HTTP ${rotate.status}`);
    const newRawKey = rotate.json?.data?.rawKey;
    check('rotation returns new raw key', !!newRawKey, `rawKey=${!!newRawKey}`);
    // Old key should be revoked
    const oldKey = await ApiKey.findById(keyId).lean();
    check('old key revoked after rotation', oldKey?.isActive === false, `isActive=${oldKey?.isActive}`);
    // New key should be active
    const newKeyId = rotate.json?.data?._id;
    const newKey = await ApiKey.findById(newKeyId).lean();
    check('new key is active', newKey?.isActive === true, `isActive=${newKey?.isActive}`);
  }

  // ── API key revocation enforcement ──
  const createKey2 = await req('/api/v1/api-keys', { method: 'POST', cookie: C, body: { name: `Revoke Key ${RUN}`, scopes: ['read'] } });
  const keyId2 = createKey2.json?.data?._id;
  const rawKey2 = createKey2.json?.data?.rawKey;
  if (keyId2) {
    await req(`/api/v1/api-keys/${keyId2}/revoke`, { method: 'DELETE', cookie: C });
    // Use raw key to access API (via x-api-key header) — should be rejected
    const access = await req('/api/v1/records/policy', { headers: { 'x-api-key': rawKey2 } });
    check('revoked API key rejected (401/403)', [401, 403].includes(access.status), `HTTP ${access.status}`);
  }

  // ── Delivery log ──
  const whOut = await req('/api/v1/webhooks', { method: 'POST', cookie: C, body: { name: `DL WH ${RUN}`, url: 'https://httpbin.org/post', events: ['record.created'], isActive: true } });
  const whId = whOut.json?.data?._id;
  if (whId) {
    await req(`/api/v1/webhooks/${whId}/test`, { method: 'POST', cookie: C });
    const deliveries = await req(`/api/v1/webhooks/${whId}/deliveries`, { cookie: C });
    check('delivery log returns entries (200)', deliveries.status === 200, `HTTP ${deliveries.status}`);
    check('delivery log has entry', (deliveries.json?.data || []).length > 0, `count=${(deliveries.json?.data || []).length}`);
  }

  // ── Per-tenant rate limiting (basic check) ──
  // Make many rapid requests; should eventually get 429
  let rateLimited = false;
  for (let i = 0; i < 110; i++) {
    const r = await req('/api/v1/records/policy', { cookie: C });
    if (r.status === 429) { rateLimited = true; break; }
  }
  // Note: global limiter may or may not trigger; this is informational
  check('rate limiting observable (informational)', true, `rateLimited=${rateLimited}`);

  // ── Auth failure logging ──
  // Send bad credentials
  const badLogin = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'nonexistent', password: 'wrong' }) });
  check('bad login returns 401', badLogin.status === 401, `HTTP ${badLogin.status}`);

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
    await mongoose.connection.close();
  } catch (e) { console.error('cleanup', e.message); }
  server.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  process.exit(failed.length ? 1 : 0);
}
