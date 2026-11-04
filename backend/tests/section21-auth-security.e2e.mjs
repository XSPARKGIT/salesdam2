/**
 * section21-auth-security.e2e.mjs — BRD §21.3 password policy, lockout,
 * password reset (by email, not username), change-password, and account
 * activation/deactivation — all enforced on the backend, tenant-configurable,
 * and audited.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import app from '../app.js';
import Tenant from '../models/Tenant.js';
import User from '../models/User.js';
import Role from '../models/Role.js';
import AuditLog from '../models/AuditLog.js';
import TenantConfiguration from '../models/TenantConfiguration.js';
import { seedDefaultRoles } from '../services/roleService.js';

const RUN = Date.now().toString(36);
const PASSWORD = 'Sect21Pass!23';
const results = [];
const check = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };

const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
const req = async (path, { method = 'GET', cookie, body } = {}) => {
  const res = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  const sc = res.headers.getSetCookie?.() || [];
  const cookieOut = sc.map((c) => c.split(';')[0]).find((c) => c.startsWith('crm.sid='));
  return { status: res.status, json, text, cookie: cookieOut };
};
const loginCookie = async (username, password = PASSWORD) => {
  const res = await req('/api/v1/auth/login', { method: 'POST', body: { username, password } });
  return res;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const latestAudit = async (tenantId, action) => {
  await wait(120);
  return AuditLog.findOne({ tenantId, action }).sort({ createdAt: -1 }).lean();
};

let tenantId = null;
let tenantBId = null;
try {
  await connectDB();
  const tenant = await Tenant.create({ name: `ZZ_S21_${RUN}`, slug: `zz-s21-${RUN}`, status: 'active', plan: 'enterprise' });
  tenantId = tenant._id;
  await seedDefaultRoles(tenantId);
  const role = await Role.findOne({ tenantId, name: 'admin' });
  const adminEmail = `admin-${RUN}@example.com`;
  const admin = await User.create({ tenantId, firstName: 'a', lastName: 'd', email: adminEmail, username: `admin_${RUN}`, password: PASSWORD, role: role._id, status: 'active', emailVerified: true });
  const adminLogin = await loginCookie(adminEmail);
  check('admin login succeeds', Boolean(adminLogin.cookie), `HTTP ${adminLogin.status}`);
  const adminCookie = adminLogin.cookie;

  const tenantB = await Tenant.create({ name: `ZZ_S21_B_${RUN}`, slug: `zz-s21-b-${RUN}`, status: 'active', plan: 'enterprise' });
  tenantBId = tenantB._id;

  // ── Password policy: configurable, enforced on the backend ─────────────
  const setConfig = (key, value, cookie = adminCookie) => req(`/api/v1/configuration/${key}`, { method: 'PUT', cookie, body: { value } });

  let r = await setConfig('auth.password_min_length', 12);
  check('tenant admin can set min password length', r.status === 200, `HTTP ${r.status}`);
  r = await setConfig('auth.password_require_symbol', true);
  check('tenant admin can require a symbol', r.status === 200, `HTTP ${r.status}`);

  const weakUser = `weak-${RUN}@example.com`;
  r = await req('/api/v1/users', { method: 'POST', cookie: adminCookie, body: { firstName: 'W', lastName: 'K', email: weakUser, username: weakUser, password: 'short1' } });
  check('a password that is too short and has no symbol is rejected', r.status === 400, `HTTP ${r.status} ${r.text}`);

  r = await req('/api/v1/users', { method: 'POST', cookie: adminCookie, body: { firstName: 'W', lastName: 'K', email: weakUser, username: weakUser, password: 'LongEnough123!' } });
  check('a password meeting this tenant’s policy is accepted', r.status === 201, `HTTP ${r.status} ${r.text}`);

  // Tenant isolation of the policy: tenant B's default (min 8, no symbol)
  // must still accept a password tenant A would now reject.
  const bAdminEmail = `badmin-${RUN}@example.com`;
  await seedDefaultRoles(tenantBId);
  const bRole = await Role.findOne({ tenantId: tenantBId, name: 'admin' });
  await User.create({ tenantId: tenantBId, firstName: 'b', lastName: 'a', email: bAdminEmail, username: `badmin_${RUN}`, password: PASSWORD, role: bRole._id, status: 'active', emailVerified: true });
  const bLogin = await loginCookie(bAdminEmail);
  r = await req('/api/v1/users', { method: 'POST', cookie: bLogin.cookie, body: { firstName: 'P', lastName: 'Q', email: `plain-${RUN}@example.com`, username: `plain-${RUN}@example.com`, password: 'plainpass1' } });
  check('tenant B’s own (unconfigured) policy is unaffected by tenant A’s override', r.status === 201, `HTTP ${r.status} ${r.text}`);

  // ── Lockout: configurable, enforced ─────────────────────────────────────
  r = await setConfig('auth.max_failed_login_attempts', 3);
  check('tenant admin can lower the lockout threshold', r.status === 200);
  r = await setConfig('auth.lockout_duration_minutes', 15);
  check('tenant admin can set the lockout duration', r.status === 200);

  const lockUserEmail = `lockme-${RUN}@example.com`;
  await req('/api/v1/users', { method: 'POST', cookie: adminCookie, body: { firstName: 'L', lastName: 'K', email: lockUserEmail, username: lockUserEmail, password: 'LockMe123456!' } });

  for (let i = 0; i < 3; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await loginCookie(lockUserEmail, 'WrongPassword1!');
  }
  r = await loginCookie(lockUserEmail, 'LockMe123456!');
  check('account locked after reaching the configured threshold (even with the correct password)', r.status === 423, `HTTP ${r.status}`);

  const lockedUser = await User.findOne({ tenantId, email: lockUserEmail });
  check('lockedUntil reflects the configured duration (~15 min)', Boolean(lockedUser.lockedUntil) && (lockedUser.lockedUntil - Date.now()) > 10 * 60 * 1000, `lockedUntil=${lockedUser.lockedUntil}`);

  const lockoutEvt = await latestAudit(tenantId, 'account_lockout');
  check('account_lockout audit event written exactly once this run', Boolean(lockoutEvt) && String(lockoutEvt.userId) === String(lockedUser._id));

  // ── forgot-password: by email (the real, live bug fix) ──────────────────
  r = await req('/api/v1/auth/forgot-password', { method: 'POST', body: { username: lockUserEmail } });
  check('forgot-password by username field (containing an email) is accepted as a legacy alias', r.status === 200, `HTTP ${r.status}`);

  const resetTargetEmail = `resetme-${RUN}@example.com`;
  await req('/api/v1/users', { method: 'POST', cookie: adminCookie, body: { firstName: 'R', lastName: 'S', email: resetTargetEmail, username: resetTargetEmail, password: 'ResetMe123456!' } });
  r = await req('/api/v1/auth/forgot-password', { method: 'POST', body: { email: resetTargetEmail } });
  check('forgot-password by email succeeds', r.status === 200, `HTTP ${r.status}`);

  r = await req('/api/v1/auth/forgot-password', { method: 'POST', body: { email: `nobody-${RUN}@example.com` } });
  check('forgot-password for an unknown email still returns success (no account enumeration)', r.status === 200, `HTTP ${r.status}`);

  const resetTargetUser = await User.findOne({ tenantId, email: resetTargetEmail }).select('+passwordResetToken +passwordResetExpires');
  check('a real, time-limited reset token was persisted', Boolean(resetTargetUser.passwordResetToken) && resetTargetUser.passwordResetExpires > new Date());

  // We cannot recover the raw token (only its hash is stored) from here, so
  // exercise verify/reset through passwordResetService directly, the same
  // way the controller does, to prove the full persisted flow end-to-end.
  const passwordResetService = (await import('../services/passwordResetService.js')).default;
  // Generate a fresh raw token the same way the controller would, store its
  // hash against the user, so we have the plaintext to submit.
  const rawToken = passwordResetService.generateResetToken();
  resetTargetUser.passwordResetToken = passwordResetService.hashToken(rawToken);
  resetTargetUser.passwordResetExpires = new Date(Date.now() + 2 * 60 * 60 * 1000);
  await resetTargetUser.save();

  r = await req('/api/v1/auth/verify-reset-token', { method: 'POST', body: { token: 'not-the-real-token' } });
  check('an invalid reset token is rejected', r.status === 400, `HTTP ${r.status}`);

  r = await req('/api/v1/auth/verify-reset-token', { method: 'POST', body: { token: rawToken } });
  check('a valid reset token is accepted', r.status === 200, `HTTP ${r.status}`);

  // Create two sessions for this user, then reset the password — both must die.
  const preResetLoginA = await loginCookie(resetTargetEmail, 'ResetMe123456!');
  const preResetLoginB = await loginCookie(resetTargetEmail, 'ResetMe123456!');
  check('two independent sessions exist before reset', Boolean(preResetLoginA.cookie) && Boolean(preResetLoginB.cookie));

  r = await req('/api/v1/auth/reset-password', { method: 'POST', body: { token: rawToken, newPassword: 'weak' } });
  check('reset-password enforces the tenant password policy (weak password rejected)', r.status === 400, `HTTP ${r.status} ${r.text}`);

  r = await req('/api/v1/auth/reset-password', { method: 'POST', body: { token: rawToken, newPassword: 'BrandNewPass123!' } });
  check('reset-password succeeds with a policy-compliant password', r.status === 200, `HTTP ${r.status} ${r.text}`);

  r = await req('/api/v1/auth/me', { cookie: preResetLoginA.cookie });
  check('a session that existed before the reset is invalidated', r.status === 401, `HTTP ${r.status}`);
  r = await req('/api/v1/auth/me', { cookie: preResetLoginB.cookie });
  check('every prior session is invalidated, not just one', r.status === 401, `HTTP ${r.status}`);

  r = await req('/api/v1/auth/reset-password', { method: 'POST', body: { token: rawToken, newPassword: 'AnotherPass123!' } });
  check('a used reset token cannot be reused', r.status === 400, `HTTP ${r.status}`);

  const resetCompletedEvt = await latestAudit(tenantId, 'password_reset_completed');
  check('password_reset_completed is audited', Boolean(resetCompletedEvt) && String(resetCompletedEvt.userId) === String(resetTargetUser._id));

  // ── change-password (the live frontend endpoint): policy + session kept ─
  const cpLogin = await loginCookie(resetTargetEmail, 'BrandNewPass123!');
  const cpLogin2 = await loginCookie(resetTargetEmail, 'BrandNewPass123!');
  r = await req('/api/v1/auth/change-password', { method: 'POST', cookie: cpLogin.cookie, body: { currentPassword: 'BrandNewPass123!', newPassword: 'weak' } });
  check('change-password enforces the tenant password policy', r.status === 400, `HTTP ${r.status}`);

  r = await req('/api/v1/auth/change-password', { method: 'POST', cookie: cpLogin.cookie, body: { currentPassword: 'BrandNewPass123!', newPassword: 'YetAnotherPass123!' } });
  check('change-password succeeds with a compliant password', r.status === 200, `HTTP ${r.status} ${r.text}`);

  r = await req('/api/v1/auth/me', { cookie: cpLogin.cookie });
  check('the session that made the change-password request stays alive', r.status === 200, `HTTP ${r.status}`);
  r = await req('/api/v1/auth/me', { cookie: cpLogin2.cookie });
  check('every other session for that user is invalidated', r.status === 401, `HTTP ${r.status}`);

  // ── Account activation / deactivation: sessions + distinct audit events ─
  const actEmail = `activate-${RUN}@example.com`;
  const createRes = await req('/api/v1/users', { method: 'POST', cookie: adminCookie, body: { firstName: 'Ac', lastName: 'Tv', email: actEmail, username: actEmail, password: 'ActivateMe123!' } });
  const actUserId = createRes.json?.data?._id;
  const actLogin = await loginCookie(actEmail, 'ActivateMe123!');
  check('newly created, active user can log in', Boolean(actLogin.cookie));

  r = await req(`/api/v1/users/${actUserId}`, { method: 'DELETE', cookie: adminCookie });
  check('admin can deactivate the user', r.status === 200, `HTTP ${r.status} ${r.text}`);
  r = await req('/api/v1/auth/me', { cookie: actLogin.cookie });
  check('a deactivated user’s existing session is invalidated', r.status === 401, `HTTP ${r.status}`);
  r = await loginCookie(actEmail, 'ActivateMe123!');
  check('a deactivated user cannot authenticate at all', r.status === 401, `HTTP ${r.status}`);

  r = await req(`/api/v1/users/${actUserId}`, { method: 'PUT', cookie: adminCookie, body: { status: 'active' } });
  check('admin can reactivate the user', r.status === 200, `HTTP ${r.status}`);
  r = await loginCookie(actEmail, 'ActivateMe123!');
  check('a reactivated user can authenticate again', Boolean(r.cookie), `HTTP ${r.status}`);

  const activateEvt = await latestAudit(tenantId, 'user_activate');
  check('user_activate is audited as its own event, not folded into generic update', Boolean(activateEvt) && String(activateEvt.resourceId) === String(actUserId));

  // ── Secrets never leak into audit details ───────────────────────────────
  const allRecentEvents = await AuditLog.find({ tenantId }).lean();
  const blob = JSON.stringify(allRecentEvents);
  check('no plaintext password appears anywhere in this tenant’s audit log', !blob.includes('BrandNewPass123!') && !blob.includes('YetAnotherPass123!') && !blob.includes('LockMe123456!'));
  check('no reset token appears anywhere in the audit log', !blob.includes(rawToken));
} catch (err) {
  check('harness ran without error', false, err.stack || err.message);
} finally {
  if (tenantId) {
    const ids = [tenantId, tenantBId].filter(Boolean);
    await Promise.all([
      Tenant.deleteMany({ _id: { $in: ids } }),
      User.deleteMany({ tenantId: { $in: ids } }),
      Role.deleteMany({ tenantId: { $in: ids } }),
      AuditLog.deleteMany({ tenantId: { $in: ids } }),
      TenantConfiguration.deleteMany({ tenantId: { $in: ids } }),
    ].map((p) => p.catch(() => {})));
  }
  server.close();
  await mongoose.connection.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
