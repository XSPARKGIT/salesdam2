/**
 * configuration.e2e.mjs — TenantConfiguration resolution (Core BRD §14).
 *
 * Boots the real Express app, seeds two tenants, and verifies the resolution
 * order: tenant override → platform-wide default → code default → fallback,
 * including tenant isolation and the admin/superuser guard rails.
 *
 * Run: node tests/configuration.e2e.mjs   (from backend/)
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
import TenantConfiguration from '../models/TenantConfiguration.js';
import configurationService from '../services/configurationService.js';
import { seedDefaultRoles } from '../services/roleService.js';

const RUN = Date.now().toString(36);
const PASSWORD = 'CfgTest123!';
const THRESHOLD = 'approvals.threshold_amount';
const SYSTEM_KEY = `test.system_key_${RUN}`;
const LOCKED_KEY = `test.locked_key_${RUN}`;

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
  return { status: res.status, json };
};

const loginCookie = async (username) => {
  const res = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: PASSWORD }),
  });
  const setCookie = res.headers.getSetCookie?.() || [];
  const sid = setCookie.map((c) => c.split(';')[0]).find((c) => c.startsWith('crm.sid='));
  return sid || '';
};

const seedTenant = async (label) => {
  const tenant = await Tenant.create({
    name: `ZZ_CFG_${label}_${RUN}`,
    slug: `zz-cfg-${label}-${RUN}`,
    status: 'active',
    plan: 'enterprise',
  });
  await seedDefaultRoles(tenant._id);
  const adminRole = await Role.findOne({ tenantId: tenant._id, name: 'admin' });
  const superRole = await Role.findOne({ tenantId: tenant._id, name: 'superuser' });
  const user = await User.create({
    tenantId: tenant._id,
    firstName: 'Cfg',
    lastName: label,
    email: `cfg-${label}-${RUN}@example.com`,
    username: `cfg_${label}_${RUN}`,
    password: PASSWORD,
    role: adminRole._id,
    status: 'active',
    emailVerified: true,
  });
  const superuser = await User.create({
    tenantId: tenant._id,
    firstName: 'CfgSuper',
    lastName: label,
    email: `cfg-super-${label}-${RUN}@example.com`,
    username: `cfg_super_${label}_${RUN}`,
    password: PASSWORD,
    role: superRole._id,
    status: 'active',
    emailVerified: true,
  });
  return { tenant, user, superuser };
};

let tenantAId = null;
let tenantBId = null;
const cleanupKeys = [THRESHOLD, SYSTEM_KEY, LOCKED_KEY];

try {
  await connectDB();

  const A = await seedTenant('A');
  const B = await seedTenant('B');
  tenantAId = A.tenant._id;
  tenantBId = B.tenant._id;

  const cookieA = await loginCookie(A.user.email);
  const cookieB = await loginCookie(B.user.email);
  const cookieSuper = await loginCookie(A.superuser.email);
  check('admin login returns session cookie', Boolean(cookieA));
  check('superuser login returns session cookie', Boolean(cookieSuper));

  // ── Code default resolves when nothing is stored ────────────────────────
  const baseA = await req('/api/v1/configuration', { cookie: cookieA });
  const baseEntry = baseA.json?.data?.find((e) => e.key === THRESHOLD);
  check(
    'code default applies when no override exists',
    baseA.status === 200 && baseEntry?.value === 0 && baseEntry?.source === 'default',
    `HTTP ${baseA.status} value=${baseEntry?.value} source=${baseEntry?.source}`,
  );

  // ── Tenant override wins over the system default ────────────────────────
  const putA = await req(`/api/v1/configuration/${THRESHOLD}`, {
    method: 'PUT',
    cookie: cookieA,
    body: { value: '5000' },
  });
  check('tenant admin can set an override', putA.status === 200, `HTTP ${putA.status}`);

  const afterA = await req('/api/v1/configuration', { cookie: cookieA });
  const afterEntry = afterA.json?.data?.find((e) => e.key === THRESHOLD);
  check(
    'override wins and is cast to a number',
    afterEntry?.value === 5000 && afterEntry?.source === 'tenant' && afterEntry?.isOverridden === true,
    `value=${afterEntry?.value} source=${afterEntry?.source}`,
  );

  // ── Tenant isolation: tenant B is unaffected ────────────────────────────
  const baseB = await req('/api/v1/configuration', { cookie: cookieB });
  const bEntry = baseB.json?.data?.find((e) => e.key === THRESHOLD);
  check(
    "another tenant does not see the override",
    bEntry?.value === 0 && bEntry?.source === 'default',
    `value=${bEntry?.value} source=${bEntry?.source}`,
  );

  // Service-level resolution, including fallback and resolveMany.
  const resolvedA = await configurationService.resolve(THRESHOLD, tenantAId);
  const resolvedB = await configurationService.resolve(THRESHOLD, tenantBId);
  check('service resolve honours tenant override', resolvedA === 5000, `got ${resolvedA}`);
  check('service resolve isolates tenants', resolvedB === 0, `got ${resolvedB}`);
  const fallback = await configurationService.resolve('nope.unknown', tenantAId, 'FALLBACK');
  check('service resolve uses provided fallback', fallback === 'FALLBACK', `got ${fallback}`);

  const many = await configurationService.resolveMany(
    [THRESHOLD, 'records.recycle_bin_retention_days', 'nope.unknown'],
    tenantAId,
  );
  check(
    'resolveMany merges override + default and omits unknown',
    many[THRESHOLD] === 5000 &&
      many['records.recycle_bin_retention_days'] === 30 &&
      !('nope.unknown' in many),
    JSON.stringify(many),
  );

  // ── Guard rails ─────────────────────────────────────────────────────────
  const unknownPut = await req('/api/v1/configuration/not.a.key', {
    method: 'PUT',
    cookie: cookieA,
    body: { value: 1 },
  });
  check('unknown key rejected for tenant override', unknownPut.status === 403, `HTTP ${unknownPut.status}`);

  await configurationService.set({
    key: LOCKED_KEY,
    tenantId: null,
    value: 'locked',
    dataType: 'string',
    editableByTenant: false,
  });
  const lockedPut = await req(`/api/v1/configuration/${LOCKED_KEY}`, {
    method: 'PUT',
    cookie: cookieA,
    body: { value: 'x' },
  });
  check('non-editable key rejected for tenant override', lockedPut.status === 403, `HTTP ${lockedPut.status}`);

  const badNumber = await req(`/api/v1/configuration/${THRESHOLD}`, {
    method: 'PUT',
    cookie: cookieA,
    body: { value: 'not-a-number' },
  });
  check('non-numeric value rejected for a number key', badNumber.status === 400, `HTTP ${badNumber.status}`);

  const adminDefaults = await req(`/api/v1/configuration/defaults/${SYSTEM_KEY}`, {
    method: 'PUT',
    cookie: cookieA,
    body: { value: 1 },
  });
  check('tenant admin cannot write platform defaults', adminDefaults.status === 403, `HTTP ${adminDefaults.status}`);

  // ── Operator-level default applies to every tenant ──────────────────────
  const superPut = await req(`/api/v1/configuration/defaults/${SYSTEM_KEY}`, {
    method: 'PUT',
    cookie: cookieSuper,
    body: { value: 'shared', dataType: 'string', category: 'test', label: 'Shared Key' },
  });
  check('superuser can write a platform default', superPut.status === 200, `HTTP ${superPut.status}`);

  const bAfterSystem = await req('/api/v1/configuration', { cookie: cookieB });
  const sharedEntry = bAfterSystem.json?.data?.find((e) => e.key === SYSTEM_KEY);
  check(
    'platform default visible to another tenant as system source',
    sharedEntry?.value === 'shared' && sharedEntry?.source === 'system',
    `value=${sharedEntry?.value} source=${sharedEntry?.source}`,
  );

  // ── Clearing an override falls back to the platform default ─────────────
  const del = await req(`/api/v1/configuration/${THRESHOLD}`, {
    method: 'DELETE',
    cookie: cookieA,
  });
  const afterClear = await req('/api/v1/configuration', { cookie: cookieA });
  const clearedEntry = afterClear.json?.data?.find((e) => e.key === THRESHOLD);
  check(
    'clearing an override restores the default',
    del.status === 200 && clearedEntry?.value === 0 && clearedEntry?.source === 'default',
    `HTTP ${del.status} value=${clearedEntry?.value} source=${clearedEntry?.source}`,
  );

  // ── Superuser can clear a platform default ──────────────────────────────
  const delSystem = await req(`/api/v1/configuration/defaults/${SYSTEM_KEY}`, {
    method: 'DELETE',
    cookie: cookieSuper,
  });
  const afterSystemClear = await req('/api/v1/configuration', { cookie: cookieB });
  const goneEntry = afterSystemClear.json?.data?.find((e) => e.key === SYSTEM_KEY);
  check(
    'cleared platform default no longer appears',
    delSystem.status === 200 && goneEntry === undefined,
    `HTTP ${delSystem.status} present=${goneEntry !== undefined}`,
  );
} catch (err) {
  check('test harness ran without error', false, err.message);
} finally {
  if (tenantAId || tenantBId) {
    const tenantIds = [tenantAId, tenantBId].filter(Boolean);
    await Tenant.deleteMany({ _id: { $in: tenantIds } });
    await Promise.all(
      [User, Role, Session].map((M) =>
        M.deleteMany({ tenantId: { $in: tenantIds } }).catch(() => {}),
      ),
    );
    await TenantConfiguration.deleteMany({ tenantId: { $in: tenantIds } });
  }
  await TenantConfiguration.deleteMany({ tenantId: null, key: { $in: cleanupKeys } });
  server.close();
  await mongoose.connection.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
