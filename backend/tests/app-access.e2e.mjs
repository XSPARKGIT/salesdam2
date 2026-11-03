/**
 * app-access.e2e.mjs — BRD 5.3 App Access Control.
 *
 * Boots the real Express app and verifies, through the API:
 *  - Apps (Workspaces) in a user's App Switcher come from their Role, their
 *    Permission Sets or direct membership (plus the default App)
 *  - a user can't switch into an App they weren't granted
 *  - App access is independent of object permissions: a Role with Read on
 *    Policy but without the Insurance App can report on Policy, and an App in
 *    the switcher doesn't give access to objects the Role can't read
 *  - Permission Sets: CRUD, assignment, validation, admin-only
 *  - deleting an App removes it from Roles and Permission Sets
 *
 * Run: node tests/app-access.e2e.mjs   (from backend/)
 * Exits non-zero if any check fails.
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
import Workspace from '../models/Workspace.js';
import PermissionSet from '../models/PermissionSet.js';
import AuditLog from '../models/AuditLog.js';
import { seedDefaultRoles } from '../services/roleService.js';

const RUN = Date.now().toString(36);
const PASSWORD = 'AppAccess123!';

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

let tenantId = null;
const models = [User, Role, Session, ObjectMeta, FieldMeta, DynamicRecord, Workspace, PermissionSet, AuditLog];

try {
  await connectDB();

  const tenant = await Tenant.create({ name: `ZZ_APP_${RUN}`, slug: `zz-app-${RUN}`, status: 'active', plan: 'enterprise' });
  tenantId = tenant._id;
  await seedDefaultRoles(tenantId);
  const roleAdmin = await Role.findOne({ tenantId, name: 'admin' });

  const sales = await Workspace.create({ tenantId, name: 'Sales', apiName: 'sales', isDefault: true, status: 'active', allowedObjects: ['lead'] });
  const insurance = await Workspace.create({ tenantId, name: 'Insurance', apiName: 'insurance', status: 'active', allowedObjects: ['policy'] });
  const claims = await Workspace.create({ tenantId, name: 'Claims', apiName: 'claims', status: 'active', allowedObjects: ['policy'] });

  const read = (objectApiName) => ({ objectApiName, canCreate: false, canRead: true, canUpdate: false, canDelete: false });
  const mkRole = (name, extra = {}) => Role.create({ tenantId, name: `${name}_${RUN}`, label: name, dataAccess: 'own', ...extra });
  const roleAgent = await mkRole('agent', { objectPermissions: [read('policy'), read('lead')] }); // reads Policy, no Insurance App
  const roleBroker = await mkRole('broker', { objectPermissions: [read('policy')], appIds: [insurance._id] });
  const roleNoRead = await mkRole('noread', { objectPermissions: [read('lead')], appIds: [insurance._id] });

  const mkUser = (key, role) => User.create({
    tenantId, firstName: 'App', lastName: key, email: `app-${key}-${RUN}@example.com`,
    username: `app_${key}_${RUN}`, password: PASSWORD, role: role._id, status: 'active', emailVerified: true,
  });
  const adminU = await mkUser('admin', roleAdmin);
  const agentU = await mkUser('agent', roleAgent);
  const brokerU = await mkUser('broker', roleBroker);
  const noReadU = await mkUser('noread', roleNoRead);
  const psU = await mkUser('ps', roleAgent);
  const memberU = await mkUser('member', roleAgent);
  await Workspace.updateOne({ _id: claims._id }, { $addToSet: { memberIds: memberU._id } });

  const cookies = {};
  for (const [k, u] of Object.entries({ adminU, agentU, brokerU, noReadU, psU, memberU })) cookies[k] = await loginCookie(u.email);
  check('users can log in', Object.values(cookies).every(Boolean));

  const policy = await ObjectMeta.create({ tenantId, name: 'Policy', label: 'Policy', pluralLabel: 'Policies', apiName: 'policy', nameFieldApiName: 'name', isActive: true });
  await ObjectMeta.create({ tenantId, name: 'Lead', label: 'Lead', pluralLabel: 'Leads', apiName: 'lead', nameFieldApiName: 'name', isActive: true });
  await FieldMeta.create([
    { tenantId, objectId: policy._id, objectApiName: 'policy', name: 'name', label: 'Name', apiName: 'name', type: 'text' },
    { tenantId, objectId: policy._id, objectApiName: 'policy', name: 'status', label: 'Status', apiName: 'status', type: 'picklist',
      picklistValues: ['active', 'lapsed'].map((v) => ({ label: v, value: v, isActive: true })) },
  ]);
  const mkPolicy = async (owner, status) => {
    const r = new DynamicRecord({ tenantId, objectId: policy._id, objectApiName: 'policy', ownerId: owner._id, createdBy: owner._id, lastModifiedBy: owner._id });
    r.setField('name', `${status} policy`);
    r.setField('status', status);
    await r.save();
  };
  await mkPolicy(agentU, 'active');
  await mkPolicy(agentU, 'active');
  await mkPolicy(agentU, 'lapsed');
  await mkPolicy(adminU, 'active'); // not visible to the agent (dataAccess: own)

  const appsOf = async (cookie) => ((await req('/api/v1/workspaces/mine', { cookie })).json?.data || []).map((w) => w.name).sort().join(',');

  // ── App Switcher by Role / membership / default ──────────────────────────
  check('a Role without the Insurance App does not see it', (await appsOf(cookies.agentU)) === 'Sales', await appsOf(cookies.agentU));
  check('a Role granted the Insurance App sees it', (await appsOf(cookies.brokerU)) === 'Insurance,Sales', await appsOf(cookies.brokerU));
  check('a direct member still sees the App they were added to', (await appsOf(cookies.memberU)) === 'Claims,Sales', await appsOf(cookies.memberU));

  const me = await req('/api/v1/auth/me', { cookie: cookies.brokerU });
  const meApps = (me.json?.data?.user?.workspaces || []).map((w) => w.name).sort().join(',');
  check('the signed-in user payload lists Role-granted Apps', meApps === 'Insurance,Sales', meApps);

  let r = await req('/api/v1/workspaces/switch', { method: 'POST', cookie: cookies.agentU, body: { workspaceId: insurance._id } });
  check('a user cannot switch into an App they were not granted', r.status === 403, `HTTP ${r.status}`);
  r = await req('/api/v1/workspaces/switch', { method: 'POST', cookie: cookies.brokerU, body: { workspaceId: insurance._id } });
  check('a Role-granted App can be switched to', r.status === 200, `HTTP ${r.status}`);

  // ── Independent of object permissions ────────────────────────────────────
  const report = (cookie) => req('/api/v1/analytics/report', {
    method: 'POST', cookie, body: { objectApiName: 'policy', groupBy: 'status', aggregations: [{ field: '_id', func: 'count', alias: 'count' }] },
  });
  r = await report(cookies.agentU);
  const counts = Object.fromEntries((r.json?.data?.results || []).map((x) => [x._id, x.count]));
  check(
    'Read on Policy lets a user report on it without the Insurance App',
    r.status === 200 && counts.active === 2 && counts.lapsed === 1,
    `HTTP ${r.status} ${JSON.stringify(counts)}`,
  );
  check('the report only counts records the user may see', !counts.active || counts.active === 2, JSON.stringify(counts));

  r = await req('/api/v1/records/policy', { cookie: cookies.agentU });
  check('without the App, Policy records are not browsable', r.status === 403, `HTTP ${r.status}`);

  r = await report(cookies.noReadU);
  check('the Insurance App does not grant reporting on Policy without Read', r.status === 403, `HTTP ${r.status}`);
  await req('/api/v1/workspaces/switch', { method: 'POST', cookie: cookies.noReadU, body: { workspaceId: insurance._id } });
  r = await req('/api/v1/records/policy', { cookie: cookies.noReadU });
  check('nor browsing Policy records inside the App', r.status === 403, `HTTP ${r.status}`);

  const readable = await req('/api/v1/objects?scope=readable', { cookie: cookies.agentU });
  const scoped = await req('/api/v1/objects', { cookie: cookies.agentU });
  const names = (x) => (x.json?.data || []).map((o) => o.apiName).sort().join(',');
  check('the report object list offers every readable object', names(readable) === 'lead,policy', names(readable));
  check('the app object list stays limited to the open App', names(scoped) === 'lead', names(scoped));

  // ── Permission Sets ──────────────────────────────────────────────────────
  r = await req('/api/v1/permission-sets', { method: 'POST', cookie: cookies.agentU, body: { label: 'Nope' } });
  check('a non-admin cannot manage permission sets', r.status === 403, `HTTP ${r.status}`);
  r = await req('/api/v1/permission-sets', { method: 'POST', cookie: cookies.adminU, body: { label: 'Bad', appIds: [new mongoose.Types.ObjectId()] } });
  check('rejects an unknown App', r.status === 400, `HTTP ${r.status} ${r.json?.message || ''}`);

  r = await req('/api/v1/permission-sets', {
    method: 'POST', cookie: cookies.adminU,
    body: { label: 'Insurance Access', description: 'Back-office staff', appIds: [insurance._id], assignedUserIds: [psU._id] },
  });
  const psId = r.json?.data?._id;
  check('admin creates a permission set granting the Insurance App', r.status === 201 && r.json?.data?.name === 'insurance_access', `HTTP ${r.status} ${r.json?.message || ''}`);
  check('a user assigned the permission set sees the App', (await appsOf(cookies.psU)) === 'Insurance,Sales', await appsOf(cookies.psU));
  check('the same Role without the set still does not', (await appsOf(cookies.agentU)) === 'Sales', await appsOf(cookies.agentU));

  r = await req('/api/v1/permission-sets', { method: 'POST', cookie: cookies.adminU, body: { label: 'Insurance Access' } });
  check('permission set names are unique', r.status === 409, `HTTP ${r.status}`);

  r = await req(`/api/v1/permission-sets/${psId}`, { method: 'PUT', cookie: cookies.adminU, body: { assignedUserIds: [] } });
  check('unassigning the user removes the App', r.status === 200 && (await appsOf(cookies.psU)) === 'Sales', await appsOf(cookies.psU));

  // ── Role editor ──────────────────────────────────────────────────────────
  r = await req(`/api/v1/roles/${roleAgent._id}`, { method: 'PUT', cookie: cookies.adminU, body: { appIds: ['not-an-id'] } });
  check('a Role rejects an invalid App', r.status === 400, `HTTP ${r.status}`);
  r = await req(`/api/v1/roles/${roleAgent._id}`, { method: 'PUT', cookie: cookies.adminU, body: { appIds: [claims._id] } });
  check('granting an App on the Role adds it to the switcher', r.status === 200 && (await appsOf(cookies.agentU)) === 'Claims,Sales', await appsOf(cookies.agentU));

  const cat = await req('/api/v1/workspaces/catalogue', { cookie: cookies.adminU });
  check('the App catalogue lists every App without members', cat.status === 200 && cat.json?.data?.length === 3 && !('memberIds' in (cat.json?.data?.[0] || {})), `HTTP ${cat.status}`);

  // ── Deleting an App cleans up grants ─────────────────────────────────────
  await req(`/api/v1/permission-sets/${psId}`, { method: 'PUT', cookie: cookies.adminU, body: { appIds: [insurance._id, claims._id] } });
  const del = await req(`/api/v1/workspaces/${claims._id}`, { method: 'DELETE', cookie: cookies.adminU });
  const roleAfter = await Role.findById(roleAgent._id).lean();
  const psAfter = await PermissionSet.findById(psId).lean();
  check(
    'deleting an App removes it from Roles and Permission Sets',
    del.status === 200 && !roleAfter.appIds.map(String).includes(String(claims._id)) && psAfter.appIds.map(String).join() === String(insurance._id),
    `DELETE ${del.status}`,
  );

  r = await req(`/api/v1/permission-sets/${psId}`, { method: 'DELETE', cookie: cookies.adminU });
  check('a permission set can be deleted', r.status === 200 && !(await PermissionSet.findById(psId)), `HTTP ${r.status}`);
} catch (err) {
  check('test harness ran without error', false, err.stack || err.message);
} finally {
  if (tenantId) {
    await Tenant.deleteMany({ _id: tenantId });
    await Promise.all(models.map((M) => M.deleteMany({ tenantId }).catch(() => {})));
  }
  server.close();
  await mongoose.connection.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
