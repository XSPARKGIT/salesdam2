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
import { seedWorkspace } from './helpers/workspace.mjs';

const RUN = Date.now().toString(36);
const PASSWORD = 'IntTest123!';
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

let tA, tB;
try {
  await connectDB();
  tA = await Tenant.create({ name: `ZZ_INT_A_${RUN}`, slug: `zz-int-a-${RUN}`, status: 'active', plan: 'enterprise' });
  tB = await Tenant.create({ name: `ZZ_INT_B_${RUN}`, slug: `zz-int-b-${RUN}`, status: 'active', plan: 'enterprise' });

  const adminRoleA = await Role.create({ tenantId: tA._id, name: 'admin', label: 'Admin', dataAccess: 'all', objectPermissions: [], appPermissions: { canManageWebhooks: true } });
  const adminRoleB = await Role.create({ tenantId: tB._id, name: 'admin', label: 'Admin', dataAccess: 'all', objectPermissions: [], appPermissions: { canManageWebhooks: true } });
  const adminA = await User.create({ tenantId: tA._id, firstName: 'AdminA', lastName: 'Test', email: `admina-${RUN}@example.com`, username: `admina_${RUN}`, password: PASSWORD, role: adminRoleA._id, status: 'active', emailVerified: true });
  const adminB = await User.create({ tenantId: tB._id, firstName: 'AdminB', lastName: 'Test', email: `adminb-${RUN}@example.com`, username: `adminb_${RUN}`, password: PASSWORD, role: adminRoleB._id, status: 'active', emailVerified: true });

  await ObjectMeta.create({ tenantId: tA._id, name: 'Policy', label: 'Policy', pluralLabel: 'Policies', apiName: 'policy', nameFieldApiName: 'name', isActive: true, searchable: true });
  const objA = await ObjectMeta.findOne({ tenantId: tA._id, apiName: 'policy' });
  await FieldMeta.create({ tenantId: tA._id, objectId: objA._id, objectApiName: 'policy', name: 'Name', label: 'Name', apiName: 'name', type: 'text' });
  await seedWorkspace(tA._id, [adminA._id], ['policy']);
  await seedWorkspace(tB._id, [adminB._id], ['policy']);

  const loginA = await loginCookie(adminA.username);
  const loginB = await loginCookie(adminB.username);
  const CA = loginA.cookie, CB = loginB.cookie;
  check('admins auth', loginA.status === 200 && loginB.status === 200);

  // Unauthenticated API access rejected
  const unauth = await req('/api/v1/records/policy');
  check('unauthenticated API rejected (401)', unauth.status === 401, `HTTP ${unauth.status}`);

  // Incoming webhook: create record in tenant A
  const whCreate = await req('/api/v1/webhooks/incoming', { method: 'POST', cookie: CA, body: { objectApiName: 'policy', action: 'create', data: { name: `WH Record ${RUN}` }, source: 'external-test' } });
  check('incoming webhook creates record (200)', whCreate.status === 200, `HTTP ${whCreate.status}`);
  const created = await DynamicRecord.findOne({ tenantId: tA._id, objectApiName: 'policy', 'data.name': `WH Record ${RUN}` }).lean();
  check('webhook record persisted in DB', !!created);

  // Incoming webhook: update record
  if (created) {
    const whUpdate = await req('/api/v1/webhooks/incoming', { method: 'POST', cookie: CA, body: { objectApiName: 'policy', action: 'update', recordId: created._id, data: { name: `WH Updated ${RUN}` } } });
    check('incoming webhook updates record (200)', whUpdate.status === 200, `HTTP ${whUpdate.status}`);
    const updated = await DynamicRecord.findById(created._id).lean();
    check('webhook update persisted', updated?.data?.name === `WH Updated ${RUN}`);
  }

  // Incoming webhook: non-existent object -> 404
  const whBad = await req('/api/v1/webhooks/incoming', { method: 'POST', cookie: CA, body: { objectApiName: 'nonexistent', action: 'create', data: { name: 'X' } } });
  check('incoming webhook rejects unknown object (404)', whBad.status === 404, `HTTP ${whBad.status}`);

  // Unauthenticated incoming webhook rejected
  const whUnauth = await req('/api/v1/webhooks/incoming', { method: 'POST', body: { objectApiName: 'policy', action: 'create', data: { name: 'X' } } });
  check('unauthenticated incoming webhook rejected (401)', whUnauth.status === 401, `HTTP ${whUnauth.status}`);

  // Tenant isolation: tenant B cannot see tenant A's records
  const listB = await req('/api/v1/records/policy', { cookie: CB });
  check('tenant isolation: B list excludes A records', !listB.text.includes(`WH Updated ${RUN}`), `HTTP ${listB.status}`);

  // Outgoing webhook CRUD
  const whOut = await req('/api/v1/webhooks', { method: 'POST', cookie: CA, body: { name: `Out WH ${RUN}`, url: 'https://httpbin.org/post', events: ['record.created'], isActive: true } });
  check('create outgoing webhook (201)', [200, 201].includes(whOut.status), `HTTP ${whOut.status}`);
  const whId = whOut.json?.data?._id;
  if (whId) {
    const whGet = await req(`/api/v1/webhooks/${whId}`, { cookie: CA });
    check('get outgoing webhook (200)', whGet.status === 200, `HTTP ${whGet.status}`);
    const whDel = await req(`/api/v1/webhooks/${whId}`, { method: 'DELETE', cookie: CA });
    check('delete outgoing webhook (200)', whDel.status === 200, `HTTP ${whDel.status}`);
  }

  // Outgoing webhook tenant isolation
  if (whId) {
    const cross = await req(`/api/v1/webhooks/${whId}`, { cookie: CB });
    check('outgoing webhook tenant isolation (404)', cross.status === 404, `HTTP ${cross.status}`);
  }

  // Incoming webhook logs (admin)
  const logs = await req('/api/v1/webhooks/incoming/logs', { cookie: CA });
  check('incoming webhook logs (200)', logs.status === 200, `HTTP ${logs.status}`);

  // Cross-tenant incoming webhook log isolation
  const logsB = await req('/api/v1/webhooks/incoming/logs', { cookie: CB });
  check('incoming webhook logs tenant isolation', !logsB.text.includes(`WH Updated ${RUN}`), `HTTP ${logsB.status}`);

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
