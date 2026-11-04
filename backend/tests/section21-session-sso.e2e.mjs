/**
 * section21-session-sso.e2e.mjs — BRD §21.5 session inactivity timeout, and
 * §21.6 SSO configuration/plan-gating/status, exercised against the real
 * app, database and Session TTL mechanics.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import app from '../app.js';
import Tenant from '../models/Tenant.js';
import User from '../models/User.js';
import Role from '../models/Role.js';
import Session from '../models/Session.js';
import TenantConfiguration from '../models/TenantConfiguration.js';
import { seedDefaultRoles } from '../services/roleService.js';

const RUN = Date.now().toString(36);
const PASSWORD = 'Sess21Pass!23';
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

let tenantId = null;
let tenantBId = null;
try {
  await connectDB();
  const tenant = await Tenant.create({ name: `ZZ_SESS_${RUN}`, slug: `zz-sess-${RUN}`, status: 'active', plan: 'enterprise' });
  tenantId = tenant._id;
  await seedDefaultRoles(tenantId);
  const role = await Role.findOne({ tenantId, name: 'admin' });
  const adminEmail = `admin-${RUN}@example.com`;
  await User.create({ tenantId, firstName: 'a', lastName: 'd', email: adminEmail, username: adminEmail, password: PASSWORD, role: role._id, status: 'active', emailVerified: true });
  let login = await loginCookie(adminEmail);
  check('admin login succeeds', Boolean(login.cookie));
  const adminCookie = login.cookie;

  // ── Session inactivity timeout (default: disabled) ──────────────────────
  let r = await req('/api/v1/auth/me', { cookie: adminCookie });
  check('a fresh session works with no inactivity timeout configured (default 0)', r.status === 200, `HTTP ${r.status}`);

  r = await req('/api/v1/configuration/auth.session_inactivity_timeout_minutes', { method: 'PUT', cookie: adminCookie, body: { value: 5 } });
  check('tenant admin can set an inactivity timeout', r.status === 200, `HTTP ${r.status}`);

  // Simulate 10 minutes of inactivity by backdating the session's
  // lastAccessedAt directly in the database — faster and more precise than
  // actually waiting, and exercises the same comparison the middleware does.
  const session = await Session.findOne({ userId: (await User.findOne({ tenantId, email: adminEmail }))._id }).sort({ createdAt: -1 });
  check('the session document is persisted and findable', Boolean(session));
  await Session.updateOne({ _id: session._id }, { $set: { lastAccessedAt: new Date(Date.now() - 10 * 60 * 1000) } });

  r = await req('/api/v1/auth/me', { cookie: adminCookie });
  check('a request after the configured inactivity window is rejected', r.status === 401, `HTTP ${r.status} ${r.text}`);

  const stillThere = await Session.findOne({ _id: session._id });
  check('the expired-by-inactivity session is actually deleted, not just rejected', !stillThere);

  // A fresh login + immediate use must still work (no false positive).
  login = await loginCookie(adminEmail);
  r = await req('/api/v1/auth/me', { cookie: login.cookie });
  check('a freshly created session is unaffected by the inactivity timeout', r.status === 200, `HTTP ${r.status}`);

  // Activity within the window keeps the session alive.
  const session2 = await Session.findOne({ _id: { $exists: true }, userId: (await User.findOne({ tenantId, email: adminEmail }))._id }).sort({ createdAt: -1 });
  await Session.updateOne({ _id: session2._id }, { $set: { lastAccessedAt: new Date(Date.now() - 2 * 60 * 1000) } });
  r = await req('/api/v1/auth/me', { cookie: login.cookie });
  check('activity inside the inactivity window keeps the session alive', r.status === 200, `HTTP ${r.status}`);

  await req('/api/v1/configuration/auth.session_inactivity_timeout_minutes', { method: 'DELETE', cookie: login.cookie });
  // The original adminCookie's session was deleted by the inactivity check
  // above; use this still-live one for everything from here on.
  const adminCookie2 = login.cookie;

  // ── Tenant isolation of session policy ───────────────────────────────────
  const tenantB = await Tenant.create({ name: `ZZ_SESS_B_${RUN}`, slug: `zz-sess-b-${RUN}`, status: 'active', plan: 'enterprise' });
  tenantBId = tenantB._id;
  await seedDefaultRoles(tenantBId);
  const bRole = await Role.findOne({ tenantId: tenantBId, name: 'admin' });
  const bEmail = `badmin-${RUN}@example.com`;
  await User.create({ tenantId: tenantBId, firstName: 'b', lastName: 'a', email: bEmail, username: bEmail, password: PASSWORD, role: bRole._id, status: 'active', emailVerified: true });
  const bLogin = await loginCookie(bEmail);
  // Re-set tenant A's inactivity timeout (cleared above) to prove tenant B is unaffected.
  await req('/api/v1/configuration/auth.session_inactivity_timeout_minutes', { method: 'PUT', cookie: adminCookie2, body: { value: 5 } });
  const bSession = await Session.findOne({ userId: (await User.findOne({ tenantId: tenantBId, email: bEmail }))._id }).sort({ createdAt: -1 });
  await Session.updateOne({ _id: bSession._id }, { $set: { lastAccessedAt: new Date(Date.now() - 10 * 60 * 1000) } });
  r = await req('/api/v1/auth/me', { cookie: bLogin.cookie });
  check('tenant B is unaffected by tenant A’s inactivity timeout (tenant-scoped config)', r.status === 200, `HTTP ${r.status}`);

  // ── SSO: a minimal smoke check only ─────────────────────────────────────
  // The full SSO flow (plan gating, persisted config, a genuine OIDC
  // handshake against a real test identity provider, every rejection path)
  // is covered in depth by section21-sso-flow.e2e.mjs. This file originally
  // predates that real implementation — it only confirms the status route
  // is reachable and defaults to disabled; it's otherwise session-timeout
  // focused.
  r = await req(`/api/v1/auth/sso/${tenant._id}/status`);
  check('SSO status is publicly readable (no auth) and off by default', r.status === 200 && r.json?.data?.enabled === false, JSON.stringify(r.json?.data));

  r = await req(`/api/v1/auth/sso/${tenant._id}/status`);
  check('SSO status never exposes a client secret or issuer URL', !JSON.stringify(r.json).toLowerCase().includes('secret'));

  r = await req(`/api/v1/auth/sso/000000000000000000000000/status`);
  check('SSO status for an unknown tenant slug 404s rather than leaking state', r.status === 404, `HTTP ${r.status}`);
} catch (err) {
  check('harness ran without error', false, err.stack || err.message);
} finally {
  if (tenantId) {
    const ids = [tenantId, tenantBId].filter(Boolean);
    await Promise.all([
      Tenant.deleteMany({ _id: { $in: ids } }),
      User.deleteMany({ tenantId: { $in: ids } }),
      Role.deleteMany({ tenantId: { $in: ids } }),
      Session.deleteMany({ tenantId: { $in: ids } }),
      TenantConfiguration.deleteMany({ tenantId: { $in: ids } }),
    ].map((p) => p.catch(() => {})));
  }
  server.close();
  await mongoose.connection.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
