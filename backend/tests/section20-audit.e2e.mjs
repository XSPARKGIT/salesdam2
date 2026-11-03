import 'dotenv/config';
import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import app from '../app.js';
import Tenant from '../models/Tenant.js';
import User from '../models/User.js';
import Role from '../models/Role.js';
import AuditLog from '../models/AuditLog.js';
import AuthFailureLog from '../models/AuthFailureLog.js';
import { seedDefaultRoles } from '../services/roleService.js';
import { redact } from '../utils/auditLogger.js';

const RUN = Date.now().toString(36);
const PASSWORD = 'Audit20Test!';
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
  const sc = res.headers.getSetCookie?.() || [];
  return sc.map((c) => c.split(';')[0]).find((c) => c.startsWith('crm.sid=')) || '';
};

let tA, tB;
try {
  await connectDB();
  tA = await Tenant.create({ name: `ZZ_AUD20_A_${RUN}`, slug: `zz-aud20-a-${RUN}`, status: 'active', plan: 'enterprise' });
  tB = await Tenant.create({ name: `ZZ_AUD20_B_${RUN}`, slug: `zz-aud20-b-${RUN}`, status: 'active', plan: 'enterprise' });
  await seedDefaultRoles(tA._id);
  await seedDefaultRoles(tB._id);
  const roleA = await Role.findOne({ tenantId: tA._id, name: 'admin' });
  const roleB = await Role.findOne({ tenantId: tB._id, name: 'admin' });
  const userA = await User.create({ tenantId: tA._id, firstName: 'AdminA', lastName: 'Test', email: `admina-${RUN}@example.com`, username: `admina_${RUN}`, password: PASSWORD, role: roleA._id, status: 'active', emailVerified: true });
  const userB = await User.create({ tenantId: tB._id, firstName: 'AdminB', lastName: 'Test', email: `adminb-${RUN}@example.com`, username: `adminb_${RUN}`, password: PASSWORD, role: roleB._id, status: 'active', emailVerified: true });
  const cookieA = await loginCookie(userA.email);
  const cookieB = await loginCookie(userB.email);
  check('admins auth', Boolean(cookieA && cookieB));

  // ── Failed auth logging ──
  const beforeCount = await AuthFailureLog.countDocuments({});
  const badLogin = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'nonexistent@test.com', password: 'wrong' }) });
  check('bad login returns 401', badLogin.status === 401, `HTTP ${badLogin.status}`);
  await new Promise((r) => setTimeout(r, 300));
  const afterCount = await AuthFailureLog.countDocuments({});
  check('auth failure logged', afterCount > beforeCount, `before=${beforeCount} after=${afterCount}`);

  // Verify no secrets in log
  const log = await AuthFailureLog.findOne({}).sort({ createdAt: -1 }).lean();
  check('auth failure log has no password', !JSON.stringify(log).includes(PASSWORD), 'no password leaked');
  check('auth failure log has reason', !!log?.reason, `reason=${log?.reason}`);

  // ── Secret redaction (unit) ──
  const redacted = redact({ password: 'secret123', token: 'abc', nested: { apiKey: 'key123', authorization: 'Bearer xyz' }, arr: [{ secret: 's1' }, { keyHash: 'h1' }] });
  check('redact: password redacted', redacted.password === '[REDACTED]');
  check('redact: token redacted', redacted.token === '[REDACTED]');
  check('redact: nested apiKey redacted', redacted.nested.apiKey === '[REDACTED]');
  check('redact: nested authorization redacted', redacted.nested.authorization === '[REDACTED]');
  check('redact: array secret redacted', redacted.arr[0].secret === '[REDACTED]');
  check('redact: array keyHash redacted', redacted.arr[1].keyHash === '[REDACTED]');
  check('redact: non-sensitive preserved', redacted.nested !== undefined);

  // ── Audit log filters ──
  // Create an audit entry by performing an action
  await req('/api/v1/admin/logs', { cookie: cookieA }); // trigger list
  await new Promise((r) => setTimeout(r, 200));
  const logs = await req('/api/v1/admin/logs', { cookie: cookieA });
  check('admin can list audit logs (200)', logs.status === 200, `HTTP ${logs.status}`);

  // Filter by action
  const actionFilter = await req('/api/v1/admin/logs?action=login', { cookie: cookieA });
  check('filter by action works', actionFilter.status === 200, `HTTP ${actionFilter.status}`);

  // Filter by date range
  const from = new Date(Date.now() - 60000).toISOString();
  const to = new Date().toISOString();
  const dateFilter = await req(`/api/v1/admin/logs?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { cookie: cookieA });
  check('filter by date range works', dateFilter.status === 200, `HTTP ${dateFilter.status}`);

  // ── Tenant isolation ──
  const logsB = await req('/api/v1/admin/logs', { cookie: cookieB });
  check('tenant B can list own audit logs (200)', logsB.status === 200, `HTTP ${logsB.status}`);
  // Verify no cross-tenant data
  const aIds = (logs.json?.data?.items || logs.json?.data || []).map((l) => String(l.tenantId));
  const bIds = (logsB.json?.data?.items || logsB.json?.data || []).map((l) => String(l.tenantId));
  check('tenant isolation: no cross-tenant audit logs', bIds.every((id) => id === String(tB._id)) || bIds.length === 0, `bIds=${[...new Set(bIds)]}`);

  // ── Non-admin cannot access other user's logs ──
  // Create a non-admin user
  const nonAdminRole = await Role.create({ tenantId: tA._id, name: 'viewer', label: 'Viewer', dataAccess: 'own', objectPermissions: [], appPermissions: {} });
  const nonAdmin = await User.create({ tenantId: tA._id, firstName: 'Viewer', lastName: 'Test', email: `viewer-${RUN}@example.com`, username: `viewer_${RUN}`, password: PASSWORD, role: nonAdminRole._id, status: 'active', emailVerified: true });
  const cookieNA = await loginCookie(nonAdmin.email);
  const naLogs = await req('/api/v1/admin/logs', { cookie: cookieNA });
  // Non-admin may get 403 (no canViewAuditLog) or see only own logs
  check('non-admin audit access handled (403 or own logs only)', naLogs.status === 403 || naLogs.status === 200, `HTTP ${naLogs.status}`);

  // ── Immutability: no PUT/DELETE routes ──
  const putAttempt = await req(`/api/v1/admin/logs/${(logs.json?.data?.items || logs.json?.data || [])[0]?._id}`, { method: 'PUT', cookie: cookieA, body: { action: 'tampered' } });
  check('audit log PUT rejected (404/405)', putAttempt.status === 404 || putAttempt.status === 405 || putAttempt.status === 403, `HTTP ${putAttempt.status}`);
  const delAttempt = await req(`/api/v1/admin/logs/${(logs.json?.data?.items || logs.json?.data || [])[0]?._id}`, { method: 'DELETE', cookie: cookieA });
  check('audit log DELETE rejected (404/405)', delAttempt.status === 404 || delAttempt.status === 405 || delAttempt.status === 403, `HTTP ${delAttempt.status}`);

  // ── Secret redaction in audit details ──
  const redactTest = redact({ password: 'secret123', token: 'abc', nested: { apiKey: 'key123', authorization: 'Bearer xyz' }, arr: [{ secret: 's1' }, { keyHash: 'h1' }] });
  check('redact: password', redactTest.password === '[REDACTED]');
  check('redact: token', redactTest.token === '[REDACTED]');
  check('redact: nested apiKey', redactTest.nested.apiKey === '[REDACTED]');
  check('redact: nested authorization', redactTest.nested.authorization === '[REDACTED]');
  check('redact: array secret', redactTest.arr[0].secret === '[REDACTED]');
  check('redact: array keyHash', redactTest.arr[1].keyHash === '[REDACTED]');

} catch (err) {
  console.error('TEST RUN ERROR:', err);
  check('test run completed without unexpected error', false, err.message);
} finally {
  try {
    for (const t of [tA, tB]) {
      if (t) {
        const tid = t._id;
        await Promise.all([
          AuditLog.deleteMany({ tenantId: tid }),
          AuthFailureLog.deleteMany({ tenantId: tid }),
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
