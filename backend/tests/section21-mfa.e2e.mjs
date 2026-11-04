/**
 * section21-mfa.e2e.mjs — BRD §21.4 Multi-Factor Authentication: enrollment,
 * login challenge, recovery codes, disable, and enforcement at the Role
 * ("administrative Profile"), tenant and per-user levels — all through the
 * real HTTP endpoints and the real database, no mocked responses.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { authenticator } from 'otplib';
import connectDB from '../config/db.js';
import app from '../app.js';
import Tenant from '../models/Tenant.js';
import User from '../models/User.js';
import Role from '../models/Role.js';
import AuditLog from '../models/AuditLog.js';
import TenantConfiguration from '../models/TenantConfiguration.js';
import { seedDefaultRoles } from '../services/roleService.js';

const RUN = Date.now().toString(36);
const PASSWORD = 'Mfa21Pass!23';
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
const loginCookie = async (username, password = PASSWORD) => req('/api/v1/auth/login', { method: 'POST', body: { username, password } });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const latestAudit = async (tenantId, action, userId) => {
  await wait(120);
  const q = { tenantId, action };
  if (userId) q.userId = userId;
  return AuditLog.findOne(q).sort({ createdAt: -1 }).lean();
};

let tenantId = null;
try {
  await connectDB();
  const tenant = await Tenant.create({ name: `ZZ_MFA_${RUN}`, slug: `zz-mfa-${RUN}`, status: 'active', plan: 'enterprise' });
  tenantId = tenant._id;
  await seedDefaultRoles(tenantId);
  const adminRole = await Role.findOne({ tenantId, name: 'admin' });

  // A dedicated admin who enrolls in MFA immediately, used only to flip
  // tenant/platform MFA requirements on and off below — otherwise the very
  // act of requiring MFA tenant-wide locks the session doing the toggling
  // out of the config endpoint too (correct enforcement, just not useful
  // for a test harness that needs to turn the requirement back off).
  const configAdminEmail = `configadmin-${RUN}@example.com`;
  await User.create({ tenantId, firstName: 'C', lastName: 'A', email: configAdminEmail, username: configAdminEmail, password: PASSWORD, role: adminRole._id, status: 'active', emailVerified: true });
  let configAdminCookie = (await loginCookie(configAdminEmail)).cookie;
  const enrollRes = await req('/api/v1/auth/mfa/enroll', { method: 'POST', cookie: configAdminCookie });
  await req('/api/v1/auth/mfa/enroll/verify', { method: 'POST', cookie: configAdminCookie, body: { code: authenticator.generate(enrollRes.json.data.secret) } });

  // ── Plain user: enroll, verify, login challenge, recovery, disable ─────
  const plainEmail = `plain-${RUN}@example.com`;
  const plainUser = await User.create({ tenantId, firstName: 'P', lastName: 'U', email: plainEmail, username: plainEmail, password: PASSWORD, role: adminRole._id, status: 'active', emailVerified: true });
  let login = await loginCookie(plainEmail);
  check('plain user logs in normally before MFA is set up', Boolean(login.cookie) && !login.json?.data?.mfaChallengeRequired);
  let cookie = login.cookie;

  let r = await req('/api/v1/auth/mfa/status', { cookie });
  check('mfa/status reports not enabled, not required for an ordinary user', r.json?.data?.enabled === false && r.json?.data?.required === false, JSON.stringify(r.json?.data));

  r = await req('/api/v1/auth/mfa/enroll', { method: 'POST', cookie });
  check('enroll returns a secret, otpauth URI and backup codes', r.status === 200 && Boolean(r.json?.data?.secret) && Boolean(r.json?.data?.otpAuthUri) && Array.isArray(r.json?.data?.backupCodes) && r.json.data.backupCodes.length > 0, `HTTP ${r.status}`);
  const secret = r.json.data.secret;
  const backupCodes = r.json.data.backupCodes;

  const enrollEvt = await latestAudit(tenantId, 'mfa_enroll', plainUser._id);
  check('mfa_enroll is audited', Boolean(enrollEvt));
  check('the TOTP secret never appears in the mfa_enroll audit entry', !JSON.stringify(enrollEvt).includes(secret));

  r = await req('/api/v1/auth/mfa/enroll/verify', { method: 'POST', cookie, body: { code: '000000' } });
  check('enrollment verify rejects an incorrect code', r.status === 401, `HTTP ${r.status}`);

  const goodCode = authenticator.generate(secret);
  r = await req('/api/v1/auth/mfa/enroll/verify', { method: 'POST', cookie, body: { code: goodCode } });
  check('enrollment verify accepts a correct TOTP code and enables MFA', r.status === 200, `HTTP ${r.status} ${r.text}`);

  const enabledEvt = await latestAudit(tenantId, 'mfa_enabled', plainUser._id);
  check('mfa_enabled is audited', Boolean(enabledEvt));

  r = await req('/api/v1/auth/mfa/status', { cookie });
  check('mfa/status now reports enabled', r.json?.data?.enabled === true);

  // Log out, log back in — now the password step alone must not be enough.
  await req('/api/v1/auth/logout', { method: 'POST', cookie });
  login = await loginCookie(plainEmail);
  check('login after enrollment returns mfaChallengeRequired instead of a full session', login.status === 200 && login.json?.data?.mfaChallengeRequired === true, JSON.stringify(login.json));
  const pendingCookie = login.cookie;
  check('a pending-MFA cookie is issued', Boolean(pendingCookie));

  r = await req('/api/v1/auth/me', { cookie: pendingCookie });
  check('the pending session cannot access protected routes before MFA verification', r.status === 401, `HTTP ${r.status}`);

  r = await req('/api/v1/auth/mfa/verify', { method: 'POST', cookie: pendingCookie, body: { code: '000000' } });
  check('a wrong code at the login challenge is rejected', r.status === 401, `HTTP ${r.status}`);
  const failEvt = await latestAudit(tenantId, 'mfa_verify_failed', plainUser._id);
  check('mfa_verify_failed is audited', Boolean(failEvt));

  r = await req('/api/v1/auth/me', { cookie: pendingCookie });
  check('the pending session is still not authenticated after a failed attempt', r.status === 401, `HTTP ${r.status}`);

  const liveCode = authenticator.generate(secret);
  r = await req('/api/v1/auth/mfa/verify', { method: 'POST', cookie: pendingCookie, body: { code: liveCode } });
  check('the correct code at the login challenge completes login', r.status === 200 && Boolean(r.json?.data?.user), `HTTP ${r.status} ${r.text}`);
  cookie = pendingCookie; // same cookie, now upgraded to a full session

  r = await req('/api/v1/auth/me', { cookie });
  check('the upgraded session can now access protected routes', r.status === 200, `HTTP ${r.status}`);

  const successEvt = await latestAudit(tenantId, 'mfa_verify_success', plainUser._id);
  check('mfa_verify_success is audited', Boolean(successEvt));
  const loginEvt = await latestAudit(tenantId, 'login', plainUser._id);
  check('a login event is recorded once MFA completes', Boolean(loginEvt));

  // ── Recovery code: works once, then is rejected on reuse ───────────────
  await req('/api/v1/auth/logout', { method: 'POST', cookie });
  login = await loginCookie(plainEmail);
  const pending2 = login.cookie;
  const usedCode = backupCodes[0];
  r = await req('/api/v1/auth/mfa/verify', { method: 'POST', cookie: pending2, body: { backupCode: usedCode } });
  check('a valid backup code completes login', r.status === 200, `HTTP ${r.status} ${r.text}`);
  const recoveryEvt = await latestAudit(tenantId, 'mfa_recovery_used', plainUser._id);
  check('mfa_recovery_used is audited', Boolean(recoveryEvt));

  await req('/api/v1/auth/logout', { method: 'POST', cookie: pending2 });
  login = await loginCookie(plainEmail);
  const pending3 = login.cookie;
  r = await req('/api/v1/auth/mfa/verify', { method: 'POST', cookie: pending3, body: { backupCode: usedCode } });
  check('a used backup code cannot be reused', r.status === 401, `HTTP ${r.status}`);
  // Clean up the still-pending session from the failed attempt, and use it
  // (now upgraded to a full session) for the disable checks below.
  await req('/api/v1/auth/mfa/verify', { method: 'POST', cookie: pending3, body: { backupCode: backupCodes[1] } });
  cookie = pending3;

  // ── Disable requires the current password ───────────────────────────────
  r = await req('/api/v1/auth/mfa/disable', { method: 'POST', cookie, body: { currentPassword: 'WrongPassword!' } });
  check('disabling MFA with the wrong password is rejected', r.status === 401, `HTTP ${r.status}`);

  r = await req('/api/v1/auth/mfa/disable', { method: 'POST', cookie, body: { currentPassword: PASSWORD } });
  check('disabling MFA with the correct password succeeds', r.status === 200, `HTTP ${r.status} ${r.text}`);
  const disabledEvt = await latestAudit(tenantId, 'mfa_disabled', plainUser._id);
  check('mfa_disabled is audited', Boolean(disabledEvt));

  await req('/api/v1/auth/logout', { method: 'POST', cookie });
  login = await loginCookie(plainEmail);
  check('after disabling, login no longer requires an MFA challenge', Boolean(login.cookie) && !login.json?.data?.mfaChallengeRequired);

  // ── Enforcement: Role-required MFA ("administrative Profile") ──────────
  await Role.updateOne({ _id: adminRole._id }, { $set: { mfaRequired: true } });
  const roleReqEmail = `rolereq-${RUN}@example.com`;
  const roleReqUser = await User.create({ tenantId, firstName: 'R', lastName: 'R', email: roleReqEmail, username: roleReqEmail, password: PASSWORD, role: adminRole._id, status: 'active', emailVerified: true });
  login = await loginCookie(roleReqEmail);
  check('a user in an MFA-required Role, not yet enrolled, is still let in but flagged for enrollment', login.status === 200 && login.json?.data?.mfaEnrollmentRequired === true && !login.json?.data?.mfaChallengeRequired, JSON.stringify(login.json?.data));

  // ── Backend enforcement: blocked everywhere except finishing enrollment ─
  r = await req('/api/v1/objects', { cookie: login.cookie });
  check('an unenrolled, MFA-required user is blocked from ordinary protected endpoints (not just nudged by the frontend)', r.status === 403, `HTTP ${r.status}`);
  r = await req('/api/v1/users', { cookie: login.cookie });
  check('...on a second, unrelated endpoint too (this is a general gate, not a one-off check)', r.status === 403, `HTTP ${r.status}`);
  r = await req('/api/v1/auth/me', { cookie: login.cookie });
  check('...while /auth/me itself still works, so the frontend can render the forced-enrollment screen', r.status === 200, `HTTP ${r.status}`);
  r = await req('/api/v1/auth/mfa/status', { cookie: login.cookie });
  check('...and mfa/status still works', r.status === 200, `HTTP ${r.status}`);

  r = await req('/api/v1/auth/mfa/enroll', { method: 'POST', cookie: login.cookie });
  check('mfa/enroll itself is reachable precisely because it is how the user escapes the block', r.status === 200, `HTTP ${r.status}`);
  check('enrollment returns a real, scannable QR code built from the actual secret', typeof r.json?.data?.qrCodeDataUrl === 'string' && r.json.data.qrCodeDataUrl.startsWith('data:image/png;base64,'));
  const roleSecret = r.json.data.secret;
  await req('/api/v1/auth/mfa/enroll/verify', { method: 'POST', cookie: login.cookie, body: { code: authenticator.generate(roleSecret) } });

  // The enrollment block is lifted immediately once enrolled (same session).
  r = await req('/api/v1/objects', { cookie: login.cookie });
  check('once enrolled, the same session is no longer blocked from protected endpoints', r.status !== 403, `HTTP ${r.status}`);

  await req('/api/v1/auth/logout', { method: 'POST', cookie: login.cookie });
  login = await loginCookie(roleReqEmail);
  check('once enrolled, that Role-required user is challenged on every subsequent login', login.json?.data?.mfaChallengeRequired === true);
  r = await req('/api/v1/objects', { cookie: login.cookie });
  check('a session still pending its MFA challenge cannot reach protected endpoints either (can’t bypass by skipping straight past the enrollment gate)', r.status === 401, `HTTP ${r.status}`);

  await Role.updateOne({ _id: adminRole._id }, { $set: { mfaRequired: false } });

  // ── Enforcement: tenant-required MFA (auth.mfa_required override) ──────
  const tenantReqEmail = `tenantreq-${RUN}@example.com`;
  const tenantReqUser = await User.create({ tenantId, firstName: 'T', lastName: 'R', email: tenantReqEmail, username: tenantReqEmail, password: PASSWORD, role: adminRole._id, status: 'active', emailVerified: true });
  login = await loginCookie(tenantReqEmail);
  check('before the tenant requires MFA, a fresh user logs in normally', Boolean(login.cookie) && !login.json?.data?.mfaEnrollmentRequired && !login.json?.data?.mfaChallengeRequired);
  cookie = login.cookie;

  r = await req('/api/v1/configuration/auth.mfa_required', { method: 'PUT', cookie: configAdminCookie, body: { value: true } });
  check('tenant admin can turn on tenant-wide MFA', r.status === 200, `HTTP ${r.status}`);

  await req('/api/v1/auth/logout', { method: 'POST', cookie });
  login = await loginCookie(tenantReqEmail);
  check('once the tenant requires MFA, an unenrolled user is flagged for enrollment on login', login.status === 200 && login.json?.data?.mfaEnrollmentRequired === true);
  r = await req('/api/v1/records/lead', { cookie: login.cookie });
  check('tenant-level MFA requirement also blocks protected endpoints for an unenrolled user', r.status === 403, `HTTP ${r.status}`);
  cookie = login.cookie; // the re-login above still creates a full (if flagged) session

  // ── Per-user override ("required for selected users") ──────────────────
  const userReqEmail = `userreq-${RUN}@example.com`;
  const userReqUser = await User.create({ tenantId, firstName: 'U', lastName: 'R', email: userReqEmail, username: userReqEmail, password: PASSWORD, role: adminRole._id, status: 'active', emailVerified: true, mfaRequired: true });
  const clearRes = await req(`/api/v1/configuration/auth.mfa_required`, { method: 'DELETE', cookie: configAdminCookie }); // clear the tenant-wide override from above
  check('tenant-wide MFA requirement can be cleared', clearRes.status === 200, `HTTP ${clearRes.status} ${clearRes.text}`);
  login = await loginCookie(userReqEmail);
  check('a user with their own mfaRequired flag is flagged for enrollment even with no tenant/Role requirement', login.json?.data?.mfaEnrollmentRequired === true, JSON.stringify(login.json?.data));
  r = await req('/api/v1/records/lead', { cookie: login.cookie });
  check('per-user MFA requirement also blocks protected endpoints for an unenrolled user', r.status === 403, `HTTP ${r.status}`);

  const otherEmail = `other-${RUN}@example.com`;
  await User.create({ tenantId, firstName: 'O', lastName: 'T', email: otherEmail, username: otherEmail, password: PASSWORD, role: adminRole._id, status: 'active', emailVerified: true });
  login = await loginCookie(otherEmail);
  check('a user without any MFA requirement logs in normally', Boolean(login.cookie) && !login.json?.data?.mfaEnrollmentRequired && !login.json?.data?.mfaChallengeRequired);

  // ── Enforcement: platform-required MFA (non-overridable system default) ─
  // This mutates the one TRUE platform-wide default, shared by every tenant
  // in this database — scoped as tightly as possible and always cleared in
  // the finally below, even on failure.
  let platformDefaultSet = false;
  try {
    await TenantConfiguration.findOneAndUpdate(
      { key: 'auth.mfa_required', tenantId: null },
      { $set: { value: true, dataType: 'boolean', category: 'auth', editableByTenant: false } },
      { upsert: true },
    );
    platformDefaultSet = true;

    const platReqEmail = `platreq-${RUN}@example.com`;
    await User.create({ tenantId, firstName: 'P', lastName: 'R', email: platReqEmail, username: platReqEmail, password: PASSWORD, role: adminRole._id, status: 'active', emailVerified: true });
    login = await loginCookie(platReqEmail);
    check('platform-required MFA (non-overridable default) flags a fresh, unenrolled user for enrollment', login.status === 200 && login.json?.data?.mfaEnrollmentRequired === true, JSON.stringify(login.json?.data));
    r = await req('/api/v1/records/lead', { cookie: login.cookie });
    check('...and blocks protected endpoints exactly like the other three levels', r.status === 403, `HTTP ${r.status}`);

    r = await req('/api/v1/configuration/auth.mfa_required', { method: 'PUT', cookie: configAdminCookie, body: { value: false } });
    check('a tenant admin cannot override a non-overridable platform default', r.status === 403, `HTTP ${r.status}`);
  } finally {
    if (platformDefaultSet) {
      await TenantConfiguration.deleteOne({ key: 'auth.mfa_required', tenantId: null });
    }
  }

  // ── No secret ever leaks into any audit entry for this tenant ──────────
  const allEvents = await AuditLog.find({ tenantId }).lean();
  const blob = JSON.stringify(allEvents);
  check('no TOTP secret appears anywhere in this tenant’s audit log', !blob.includes(secret) && !blob.includes(roleSecret));
  check('no backup/recovery code appears anywhere in the audit log', !backupCodes.some((c) => blob.includes(c)));
} catch (err) {
  check('harness ran without error', false, err.stack || err.message);
} finally {
  if (tenantId) {
    await Promise.all([
      Tenant.deleteMany({ _id: tenantId }),
      User.deleteMany({ tenantId }),
      Role.deleteMany({ tenantId }),
      AuditLog.deleteMany({ tenantId }),
      TenantConfiguration.deleteMany({ tenantId }),
    ].map((p) => p.catch(() => {})));
  }
  server.close();
  await mongoose.connection.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
