/**
 * admin-guards.e2e.mjs — platform administration guard rails.
 *
 * Regression test for four defects found in the Oct 2026 completeness review:
 *   1. a role in use could be deleted (the guard counted a `roles` array
 *      that User does not have);
 *   2. the last superuser could be deactivated (the guard compared an
 *      unpopulated role ref and counted `{ role: { name: 'superuser' } }`);
 *   3. the last superuser could be demoted through PUT /users/:id/record;
 *   4. audit events were silently dropped — the model's action enum had
 *      drifted from the callers and audit() swallowed the validation error.
 *
 * Run: node tests/admin-guards.e2e.mjs   (from backend/)
 * Exits non-zero if any check fails.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import app from '../app.js';
import Tenant from '../models/Tenant.js';
import User from '../models/User.js';
import Role from '../models/Role.js';
import AuditLog from '../models/AuditLog.js';
import Session from '../models/Session.js';
import { seedDefaultRoles } from '../services/roleService.js';

const RUN = Date.now().toString(36);
const PASSWORD = 'GuardTest123!';

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

let tenantId = null;
try {
  await connectDB();

  const tenant = await Tenant.create({
    name: `ZZ_GUARD_${RUN}`,
    slug: `zz-guard-${RUN}`,
    status: 'active',
    plan: 'enterprise',
  });
  tenantId = tenant._id;
  await seedDefaultRoles(tenant._id);

  const superuserRole = await Role.findOne({ tenantId: tenant._id, name: 'superuser' });
  const adminRole = await Role.findOne({ tenantId: tenant._id, name: 'admin' });

  const superuser = await User.create({
    tenantId: tenant._id,
    firstName: 'Guard', lastName: 'Super',
    email: `guard-super-${RUN}@example.com`,
    username: `guard-super-${RUN}@example.com`,
    password: PASSWORD,
    role: superuserRole._id,
    status: 'active',
    emailVerified: true,
  });
  const admin = await User.create({
    tenantId: tenant._id,
    firstName: 'Guard', lastName: 'Admin',
    email: `guard-admin-${RUN}@example.com`,
    username: `guard-admin-${RUN}@example.com`,
    password: PASSWORD,
    role: adminRole._id,
    status: 'active',
    emailVerified: true,
  });

  const adminLogin = await loginCookie(admin.username);
  check('tenant admin can authenticate', adminLogin.status === 200 && !!adminLogin.cookie, `HTTP ${adminLogin.status}`);
  const ca = adminLogin.cookie;

  // ── Last superuser cannot be deactivated ───────────────────────────────
  const deact = await req(`/api/v1/users/${superuser._id}`, { method: 'DELETE', cookie: ca });
  check('the last superuser cannot be deactivated', deact.status === 403, `HTTP ${deact.status}`);
  const stillActive = await User.findById(superuser._id).lean();
  check('the superuser is still active after the blocked request', stillActive?.status === 'active');

  // ── Last superuser cannot be demoted ──────────────────────────────────
  const demote = await req(`/api/v1/users/${superuser._id}/record`, {
    method: 'PUT', cookie: ca, body: { role: adminRole._id },
  });
  check('the last superuser cannot be demoted', demote.status === 403, `HTTP ${demote.status}`);
  const notDemoted = await User.findById(superuser._id).lean();
  check('the superuser role is unchanged after the blocked request', String(notDemoted?.role) === String(superuserRole._id));

  // ── A second superuser makes deactivation legal again ─────────────────
  const secondSuper = await User.create({
    tenantId: tenant._id,
    firstName: 'Guard', lastName: 'Super2',
    email: `guard-super2-${RUN}@example.com`,
    username: `guard-super2-${RUN}@example.com`,
    password: PASSWORD,
    role: superuserRole._id,
    status: 'active',
    emailVerified: true,
  });
  const deact2 = await req(`/api/v1/users/${superuser._id}`, { method: 'DELETE', cookie: ca });
  check('a superuser can be deactivated once another one exists', deact2.status === 200, `HTTP ${deact2.status}`);
  const deactivated = await User.findById(superuser._id).lean();
  check('the deactivated user is marked inactive, not deleted', deactivated?.status === 'inactive');

  // ── A role in use cannot be deleted ───────────────────────────────────
  const roleName = `guard_role_${RUN}`;
  const created = await req('/api/v1/roles', {
    method: 'POST', cookie: ca, body: { name: roleName, label: 'Guard Role' },
  });
  check('a custom role can be created', created.status === 201, `HTTP ${created.status}`);
  const customRoleId = created.json?.data?._id;

  const newUser = await req('/api/v1/users', {
    method: 'POST', cookie: ca,
    body: {
      email: `guard-user-${RUN}@example.com`,
      username: `guard-user-${RUN}@example.com`,
      password: PASSWORD,
      role: customRoleId,
      firstName: 'Guard', lastName: 'User',
    },
  });
  check('a user can be created with the custom role', newUser.status === 201, `HTTP ${newUser.status}`);

  const delRole = await req(`/api/v1/roles/${customRoleId}`, { method: 'DELETE', cookie: ca });
  check('a role that is assigned to a user cannot be deleted', delRole.status === 409, `HTTP ${delRole.status}`);
  const roleStillThere = await Role.findById(customRoleId).lean();
  check('the in-use role still exists', !!roleStillThere);

  // ── Audit events are stored, not silently dropped ─────────────────────
  const profile = await req('/api/v1/users/me/profile', {
    method: 'PATCH', cookie: ca, body: { firstName: 'GuardRenamed' },
  });
  check('the profile update succeeds', profile.status === 200, `HTTP ${profile.status}`);
  const profileAudit = await AuditLog.findOne({
    tenantId: tenant._id, action: 'profile_update', userId: admin._id,
  }).lean();
  check('the profile_update audit event is stored', !!profileAudit);

  // ── Welcome-tour progress persists (it was dropped by strict mode) ─────
  const seenAt = new Date().toISOString();
  const onboarding = await req('/api/v1/users/me/profile', {
    method: 'PATCH', cookie: ca,
    body: { preferences: { theme: 'light', onboarding: { welcomeSeenAt: seenAt, tourStatus: 'skipped' } } },
  });
  check('the onboarding preference update succeeds', onboarding.status === 200, `HTTP ${onboarding.status}`);
  const me = await req('/api/v1/auth/me', { cookie: ca });
  const stored = me.json?.data?.user?.preferences?.onboarding || me.json?.user?.preferences?.onboarding;
  check(
    'the welcome-seen flag is returned by /auth/me after a reload',
    stored?.tourStatus === 'skipped' && !!stored?.welcomeSeenAt,
    JSON.stringify(stored ?? null),
  );

  // A partial preferences update must not wipe the onboarding flag.
  const partial = await req('/api/v1/users/me/profile', {
    method: 'PATCH', cookie: ca, body: { preferences: { theme: 'dark' } },
  });
  const me2 = await req('/api/v1/auth/me', { cookie: ca });
  const prefs2 = me2.json?.data?.user?.preferences || me2.json?.user?.preferences;
  check(
    'a partial preferences update keeps the welcome-seen flag',
    partial.status === 200 && prefs2?.theme === 'dark' && prefs2?.onboarding?.tourStatus === 'skipped',
    JSON.stringify({ theme: prefs2?.theme, onboarding: prefs2?.onboarding }),
  );

  const verify = await req('/api/v1/users/me/verify-password', {
    method: 'POST', cookie: ca, body: { currentPassword: PASSWORD },
  });
  check('password verification succeeds', verify.status === 200, `HTTP ${verify.status}`);
  const verifyAudit = await AuditLog.findOne({
    tenantId: tenant._id, action: 'password_verify', userId: admin._id,
  }).lean();
  check('the password_verify audit event is stored', !!verifyAudit);

  // Any lowercase snake_case action is accepted — a new caller can no longer
  // lose its audit row to an out-of-date allowlist.
  const oddAction = await AuditLog.create({
    tenantId: tenant._id, userId: admin._id, action: 'some_new_event',
  });
  check('an unknown action is stored rather than rejected', oddAction?.action === 'some_new_event');
} catch (err) {
  check('test harness ran without error', false, err.message);
} finally {
  if (tenantId) {
    await Tenant.deleteMany({ _id: tenantId });
    await Promise.all(
      [User, Role, AuditLog, Session].map((M) =>
        M.deleteMany({ tenantId }).catch(() => {}),
      ),
    );
  }
  server.close();
  await mongoose.connection.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
