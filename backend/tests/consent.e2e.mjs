/**
 * consent.e2e.mjs — communication consent & preferences (Core BRD §23).
 *
 * Boots the real Express app, seeds a tenant, and exercises recording consent
 * evidence, opt-in/opt-out, the enforcement query (with tenant-configurable
 * enforcement), history, validation and tenant isolation.
 *
 * Run: node tests/consent.e2e.mjs   (from backend/)
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
import Consent from '../models/Consent.js';
import TenantConfiguration from '../models/TenantConfiguration.js';
import { seedDefaultRoles } from '../services/roleService.js';

const RUN = Date.now().toString(36);
const PASSWORD = 'ConsentTest123!';
const SUBJECT = new mongoose.Types.ObjectId().toString();

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
  return setCookie.map((c) => c.split(';')[0]).find((c) => c.startsWith('crm.sid=')) || '';
};

const seedUser = async (tenant, role, label) =>
  User.create({
    tenantId: tenant._id, firstName: label, lastName: 'Consent',
    email: `${label}-${RUN}@example.com`, username: `${label}_${RUN}`,
    password: PASSWORD, role: role._id, status: 'active', emailVerified: true,
  });

let tenantId = null;
let tenantBId = null;

try {
  await connectDB();

  const tenant = await Tenant.create({
    name: `ZZ_CONS_${RUN}`, slug: `zz-cons-${RUN}`, status: 'active', plan: 'enterprise',
  });
  tenantId = tenant._id;
  await seedDefaultRoles(tenantId);
  const adminRole = await Role.findOne({ tenantId, name: 'admin' });
  const stdRole = await Role.findOne({ tenantId, name: 'standard_user' });
  await seedUser(tenant, adminRole, 'consadmin');
  await seedUser(tenant, stdRole, 'consstd');
  const cookieAdmin = await loginCookie(`consadmin-${RUN}@example.com`);
  const cookieStd = await loginCookie(`consstd-${RUN}@example.com`);
  check('users can log in', Boolean(cookieAdmin && cookieStd));

  const getConsent = () => req(`/api/v1/consents/contact/${SUBJECT}`, { cookie: cookieAdmin });
  const putConsent = (body) =>
    req(`/api/v1/consents/contact/${SUBJECT}`, { method: 'PUT', cookie: cookieAdmin, body });
  const checkConsent = (channel) =>
    req('/api/v1/consents/check', { method: 'POST', cookie: cookieAdmin, body: { subjectType: 'contact', subjectId: SUBJECT, channel } });

  check('no consent record yet returns null', (await getConsent()).json?.data === null, '');

  // ── Record consent evidence ─────────────────────────────────────────────
  const granted = await putConsent({ channels: { email: true }, source: 'web form', purpose: 'marketing', preferredChannel: 'email' });
  check('consent can be recorded', granted.status === 200, `HTTP ${granted.status}`);
  const afterGrant = (await getConsent()).json?.data;
  check(
    'evidence is stored (status, source, purpose, capturedBy, timestamp)',
    afterGrant?.channels?.email?.status === 'granted' &&
      afterGrant?.channels?.email?.source === 'web form' &&
      afterGrant?.channels?.email?.purpose === 'marketing' &&
      Boolean(afterGrant?.channels?.email?.capturedBy) &&
      Boolean(afterGrant?.channels?.email?.consentedAt),
    JSON.stringify(afterGrant?.channels?.email),
  );
  check('preferred channel is stored', afterGrant?.preferredChannel === 'email', `pref=${afterGrant?.preferredChannel}`);

  // ── Enforcement off (default) ───────────────────────────────────────────
  const allowedOff = await checkConsent('email');
  check(
    'opt-in allows contact',
    allowedOff.json?.data?.allowed === true && allowedOff.json?.data?.reason === 'consent granted',
    JSON.stringify(allowedOff.json?.data),
  );

  const withdrawn = await putConsent({ channels: { email: false }, note: 'unsubscribed' });
  const afterWithdraw = (await getConsent()).json?.data;
  check(
    'opt-out records a withdrawal timestamp and history',
    afterWithdraw?.channels?.email?.status === 'withdrawn' &&
      Boolean(afterWithdraw?.channels?.email?.withdrawnAt) &&
      afterWithdraw?.history?.length === 2,
    `history=${afterWithdraw?.history?.length}`,
  );

  const offWhenEnforcementDisabled = await checkConsent('email');
  check(
    'opt-out does not block while enforcement is disabled',
    offWhenEnforcementDisabled.json?.data?.allowed === true && offWhenEnforcementDisabled.json?.data?.enforced === false,
    JSON.stringify(offWhenEnforcementDisabled.json?.data),
  );

  // ── Enforcement on (TenantConfiguration) ────────────────────────────────
  const setEnforce = await req('/api/v1/configuration/consent.enforcement', { method: 'PUT', cookie: cookieAdmin, body: { value: true } });
  check('enforcement can be switched on via tenant configuration', setEnforce.status === 200, `HTTP ${setEnforce.status}`);

  const blockedOptOut = await checkConsent('email');
  check(
    'opt-out blocks contact when enforcement is on',
    blockedOptOut.json?.data?.allowed === false && blockedOptOut.json?.data?.reason === 'consent withdrawn',
    JSON.stringify(blockedOptOut.json?.data),
  );

  const unknownDefaultIn = await checkConsent('whatsapp');
  check(
    'unknown consent follows default opt-in (true)',
    unknownDefaultIn.json?.data?.allowed === true,
    JSON.stringify(unknownDefaultIn.json?.data),
  );

  await req('/api/v1/configuration/consent.default_opt_in', { method: 'PUT', cookie: cookieAdmin, body: { value: false } });
  const unknownDefaultOut = await checkConsent('whatsapp');
  check(
    'unknown consent follows default opt-in (false)',
    unknownDefaultOut.json?.data?.allowed === false,
    JSON.stringify(unknownDefaultOut.json?.data),
  );

  await putConsent({ channels: { whatsapp: true } });
  const optInOverridesDefault = await checkConsent('whatsapp');
  check(
    'an explicit opt-in overrides the default',
    optInOverridesDefault.json?.data?.allowed === true,
    JSON.stringify(optInOverridesDefault.json?.data),
  );

  // ── Validation & guard rails ────────────────────────────────────────────
  const badChannel = await checkConsent('carrier_pigeon');
  check('an unknown channel is rejected', badChannel.status === 400, `HTTP ${badChannel.status}`);

  const ignoredUnknown = await putConsent({ channels: { carrier_pigeon: true } });
  const afterIgnored = (await getConsent()).json?.data;
  check(
    'an unknown channel in an update is ignored',
    ignoredUnknown.status === 200 && !afterIgnored?.channels?.carrier_pigeon,
    '',
  );

  const stdList = await req('/api/v1/consents', { cookie: cookieStd });
  check('a non-admin cannot list all consents', stdList.status === 403, `HTTP ${stdList.status}`);
  const adminList = await req('/api/v1/consents', { cookie: cookieAdmin });
  check(
    'an admin can list consents',
    adminList.status === 200 && adminList.json?.data?.some((c) => String(c.subjectId) === SUBJECT),
    `count=${adminList.json?.data?.length}`,
  );

  // ── Tenant isolation ────────────────────────────────────────────────────
  const tenantB = await Tenant.create({
    name: `ZZ_CONS_B_${RUN}`, slug: `zz-cons-b-${RUN}`, status: 'active', plan: 'enterprise',
  });
  tenantBId = tenantB._id;
  await seedDefaultRoles(tenantBId);
  const roleB = await Role.findOne({ tenantId: tenantBId, name: 'admin' });
  await seedUser(tenantB, roleB, 'othercons');
  const cookieOther = await loginCookie(`othercons-${RUN}@example.com`);

  const otherGet = await req(`/api/v1/consents/contact/${SUBJECT}`, { cookie: cookieOther });
  check('another tenant cannot read this consent', otherGet.json?.data === null, `data=${JSON.stringify(otherGet.json?.data)}`);

  const otherCheck = await req('/api/v1/consents/check', { method: 'POST', cookie: cookieOther, body: { subjectType: 'contact', subjectId: SUBJECT, channel: 'email' } });
  check(
    "another tenant's enforcement is independent (defaults, not A's config)",
    otherCheck.json?.data?.enforced === false,
    JSON.stringify(otherCheck.json?.data),
  );
} catch (err) {
  check('test harness ran without error', false, err.message);
} finally {
  if (tenantId || tenantBId) {
    const ids = [tenantId, tenantBId].filter(Boolean);
    await Tenant.deleteMany({ _id: { $in: ids } });
    await Promise.all(
      [User, Role, Session, Consent].map((M) => M.deleteMany({ tenantId: { $in: ids } }).catch(() => {})),
    );
    await TenantConfiguration.deleteMany({ tenantId: { $in: ids } });
  }
  server.close();
  await mongoose.connection.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
