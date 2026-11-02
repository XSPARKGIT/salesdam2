/**
 * tenant-isolation.e2e.mjs — cross-tenant isolation regression test.
 *
 * Boots the real Express app, seeds two independent tenants with their own
 * admin user, object, record and file, then attempts to reach tenant B's
 * data using tenant A's authenticated session.
 *
 * Run: node tests/tenant-isolation.e2e.mjs   (from backend/)
 * Exits non-zero if any isolation check fails.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import app from '../app.js';
import Tenant from '../models/Tenant.js';
import User from '../models/User.js';
import Role from '../models/Role.js';
import ObjectMeta from '../models/ObjectMeta.js';
import DynamicRecord from '../models/DynamicRecord.js';
import File from '../models/File.js';
import Incident from '../models/Incident.js';
import Dashboard from '../models/Dashboard.js';
import Session from '../models/Session.js';
import { seedDefaultRoles } from '../services/roleService.js';
import Workspace from '../models/Workspace.js';
import { seedWorkspace } from './helpers/workspace.mjs';

const RUN = Date.now().toString(36);
const PASSWORD = 'IsoTest123!';

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const seedTenant = async (label) => {
  const tenant = await Tenant.create({
    name: `ZZ_ISO_${label}_${RUN}`,
    slug: `zz-iso-${label}-${RUN}`,
    status: 'active',
    plan: 'enterprise',
  });
  await seedDefaultRoles(tenant._id);
  const adminRole = await Role.findOne({ tenantId: tenant._id, name: 'admin' });
  const user = await User.create({
    tenantId: tenant._id,
    firstName: 'Iso',
    lastName: label,
    email: `iso-${label}-${RUN}@example.com`,
    username: `iso_${label}_${RUN}`,
    password: PASSWORD,
    role: adminRole._id,
    status: 'active',
    emailVerified: true,
  });
  await ObjectMeta.create({
    tenantId: tenant._id,
    name: 'Policy',
    label: 'Policy',
    pluralLabel: 'Policies',
    apiName: 'policy',
    nameFieldApiName: 'name',
    isActive: true,
    searchable: true,
  });
  const objectMeta = await ObjectMeta.findOne({ tenantId: tenant._id, apiName: 'policy' });
  await seedWorkspace(tenant._id, [user._id], ['policy']);
  const record = await DynamicRecord.create({
    tenantId: tenant._id,
    objectId: objectMeta._id,
    objectApiName: 'policy',
    data: { name: `SECRET_${label}_${RUN}` },
    createdBy: user._id,
    ownerId: user._id,
  });
  const file = await File.create({
    tenantId: tenant._id,
    createdBy: user._id,
    name: `secret-${label}-${RUN}.txt`,
    mimeType: 'text/plain',
    data: Buffer.from(`SECRET_${label}`).toString('base64'),
    sizeBytes: 10,
  });
  const incident = await Incident.create({
    tenantId: tenant._id,
    title: `INCIDENT_SECRET_${label}_${RUN}`,
    description: `Incident for tenant ${label}`,
    priority: 'medium',
    reportedBy: user._id,
    createdBy: user._id,
  });
  return { tenant, user, adminRole, record, file, incident };
};

const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;

const req = async (path, { method = 'GET', cookie, headers = {}, body } = {}) => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json, text: JSON.stringify(json ?? '') };
};

const loginCookie = async (username) => {
  const res = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: PASSWORD }),
  });
  const setCookie = res.headers.getSetCookie?.() || [];
  const sid = setCookie.map((c) => c.split(';')[0]).find((c) => c.startsWith('crm.sid='));
  return { status: res.status, cookie: sid };
};

let createdTenantIds = [];
try {
  await connectDB();
  const A = await seedTenant('a');
  const B = await seedTenant('b');
  createdTenantIds = [A.tenant._id, B.tenant._id];

  const loginA = await loginCookie(A.user.username);
  const loginB = await loginCookie(B.user.username);
  check('tenant A admin can authenticate', loginA.status === 200 && !!loginA.cookie, `HTTP ${loginA.status}`);
  check('tenant B admin can authenticate', loginB.status === 200 && !!loginB.cookie, `HTTP ${loginB.status}`);
  const ca = loginA.cookie;
  const cb = loginB.cookie;

  // Positive controls — A must reach its own data.
  check('A reads its own file', (await req(`/api/v1/files/${A.file._id}`, { cookie: ca })).status === 200);
  check('A reads its own record', (await req(`/api/v1/records/policy/${A.record._id}`, { cookie: ca })).status === 200);

  // Negative controls — A must NOT reach B's data.
  const fileB = await req(`/api/v1/files/${B.file._id}`, { cookie: ca });
  check('A cannot read B file (IDOR)', fileB.status === 404, `HTTP ${fileB.status}`);
  check('B file content not leaked in body', !fileB.text.includes(`SECRET_b`));

  const roleB = await req(`/api/v1/roles/${B.adminRole._id}`, { cookie: ca });
  check('A cannot read B role', roleB.status === 404, `HTTP ${roleB.status}`);

  const userB = await req(`/api/v1/users/${B.user._id}`, { cookie: ca });
  check('A cannot read B user', userB.status === 404, `HTTP ${userB.status}`);

  const recB = await req(`/api/v1/records/policy/${B.record._id}`, { cookie: ca });
  check('A cannot read B record', recB.status === 404, `HTTP ${recB.status}`);
  check('B record content not leaked in body', !recB.text.includes(`SECRET_b`));

  const delB = await req(`/api/v1/records/policy/${B.record._id}`, { method: 'DELETE', cookie: ca });
  check('A cannot delete B record', delB.status === 404, `HTTP ${delB.status}`);
  const stillThere = await DynamicRecord.findById(B.record._id).lean();
  check('B record still intact after A delete attempt', !!stillThere && !stillThere.isDeleted);

  const list = await req(`/api/v1/records/policy?limit=100`, { cookie: ca });
  check('A record list excludes B records', !list.text.includes(`SECRET_b`));

  // Note: the response echoes the query string, so assert on B's actual record id,
  // not on the search term.
  const search = await req(`/api/v1/search?q=SECRET_b_${RUN}`, { cookie: ca });
  check('A search does not surface B records', !search.text.includes(String(B.record._id)), `searched SECRET_b_${RUN}`);

  // Incidents — tenant admins must not reach another tenant's incidents.
  const incB = await req(`/api/v1/incidents/${B.incident._id}`, { cookie: ca });
  check('A cannot read B incident', incB.status === 404, `HTTP ${incB.status}`);
  check('B incident content not leaked in body', !incB.text.includes(`INCIDENT_SECRET_b`));

  const incList = await req(`/api/v1/incidents?limit=100`, { cookie: ca });
  check('A incident list excludes B incidents', !incList.text.includes(`INCIDENT_SECRET_b`));

  // /admin/all is admin-gated, but a tenant admin is scoped to their own tenant.
  const incAdminAll = await req(`/api/v1/incidents/admin/all?limit=100`, { cookie: ca });
  check(
    'A admin/all excludes B incidents (tenant-scoped)',
    incAdminAll.status === 200 && !incAdminAll.text.includes(`INCIDENT_SECRET_b`),
    `HTTP ${incAdminAll.status}`,
  );

  const incWrite = await req(`/api/v1/incidents/${B.incident._id}/comments`, {
    method: 'POST',
    cookie: ca,
    body: { content: 'cross-tenant comment attempt' },
  });
  check('A cannot comment on B incident', incWrite.status === 404, `HTTP ${incWrite.status}`);

  // Layout resolution must not crash on the (single) role field.
  const layoutResolve = await req(`/api/v1/layouts/policy/resolve`, { cookie: ca });
  check('layout resolve returns 200', layoutResolve.status === 200, `HTTP ${layoutResolve.status}`);

  // A dashboard shared with a role must be visible to members of that role,
  // even when they do not own it.
  await Dashboard.create({
    tenantId: A.tenant._id,
    name: `ROLE_SHARED_${RUN}`,
    createdBy: new mongoose.Types.ObjectId(),
    sharing: { access: 'roles', sharedWithRoles: [A.adminRole._id] },
  });
  const dashList = await req(`/api/v1/dashboards`, { cookie: ca });
  check(
    'role-shared dashboard is visible to the role member',
    dashList.status === 200 && dashList.text.includes(`ROLE_SHARED_${RUN}`),
    `HTTP ${dashList.status}`,
  );

  // Client-supplied tenant header must not override the session tenant.
  const spoof = await req(`/api/v1/files/${B.file._id}`, {
    cookie: ca,
    headers: { 'X-Tenant-ID': String(B.tenant._id) },
  });
  check('X-Tenant-ID header cannot switch tenant', spoof.status === 404, `HTTP ${spoof.status}`);

  // B still sees its own data after A's attempts.
  check('B reads its own file', (await req(`/api/v1/files/${B.file._id}`, { cookie: cb })).status === 200);
} catch (err) {
  check('test harness ran without error', false, err.message);
} finally {
  await Tenant.deleteMany({ _id: { $in: createdTenantIds } });
  await Promise.all(
    [User, Role, ObjectMeta, DynamicRecord, File, Incident, Dashboard, Session, Workspace].map((M) =>
      M.deleteMany({ tenantId: { $in: createdTenantIds } }).catch(() => {}),
    ),
  );
  server.close();
  await mongoose.connection.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
