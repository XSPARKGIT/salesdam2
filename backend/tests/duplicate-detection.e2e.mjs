/**
 * duplicate-detection.e2e.mjs — duplicate detection & record matching
 * (Core BRD §3.4).
 *
 * Boots the real Express app, seeds a tenant with an object and fields, then
 * exercises matching rules (normalized/exact, AND/OR), block vs warn behaviour,
 * enforcement on create and update, the dry-run endpoint and tenant isolation.
 *
 * Run: node tests/duplicate-detection.e2e.mjs   (from backend/)
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
import DuplicateRule from '../models/DuplicateRule.js';
import { seedDefaultRoles } from '../services/roleService.js';

const RUN = Date.now().toString(36);
const PASSWORD = 'DupTest123!';

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

let tenantId = null;
let tenantBId = null;

try {
  await connectDB();

  const tenant = await Tenant.create({
    name: `ZZ_DUP_${RUN}`, slug: `zz-dup-${RUN}`, status: 'active', plan: 'enterprise',
  });
  tenantId = tenant._id;
  await seedDefaultRoles(tenantId);
  const adminRole = await Role.findOne({ tenantId, name: 'admin' });
  const stdRole = await Role.findOne({ tenantId, name: 'standard_user' });

  const adminUser = await User.create({
    tenantId, firstName: 'Dup', lastName: 'Admin', email: `dupadmin-${RUN}@example.com`,
    username: `dupadmin_${RUN}`, password: PASSWORD, role: adminRole._id, status: 'active', emailVerified: true,
  });
  const stdUser = await User.create({
    tenantId, firstName: 'Dup', lastName: 'Std', email: `dupstd-${RUN}@example.com`,
    username: `dupstd_${RUN}`, password: PASSWORD, role: stdRole._id, status: 'active', emailVerified: true,
  });

  const objectMeta = await ObjectMeta.create({
    tenantId, name: 'Contact', label: 'Contact', pluralLabel: 'Contacts',
    apiName: 'contact', nameFieldApiName: 'name', isActive: true, searchable: true,
  });
  const fieldDefs = [
    ['name', 'text'], ['email', 'email'], ['phone', 'phone'],
    ['first_name', 'text'], ['last_name', 'text'], ['id_number', 'text'],
  ];
  for (const [apiName, type] of fieldDefs) {
    await FieldMeta.create({
      tenantId, objectId: objectMeta._id, objectApiName: 'contact',
      name: apiName, label: apiName, apiName, type,
    });
  }

  const cookieAdmin = await loginCookie(adminUser.username);
  const cookieStd = await loginCookie(stdUser.username);
  check('users can log in', Boolean(cookieAdmin && cookieStd));

  const createRecord = (body) =>
    req('/api/v1/records/contact', { method: 'POST', cookie: cookieAdmin, body });

  // ── Normalized exact matching, block ────────────────────────────────────
  const emailRule = await req('/api/v1/duplicate-rules', {
    method: 'POST', cookie: cookieAdmin,
    body: {
      name: 'Email match', objectApiName: 'contact', logic: 'AND', onMatch: 'block',
      conditions: [{ field: 'email', matchType: 'normalized' }],
    },
  });
  check('admin can create a duplicate rule', emailRule.status === 201, `HTTP ${emailRule.status}`);
  const emailRuleId = emailRule.json?.data?._id;

  const r1 = await createRecord({ name: 'Alice', email: 'alice@x.com' });
  check('first record is created', r1.status === 201, `HTTP ${r1.status}`);

  const blocked = await createRecord({ name: 'Bob', email: 'ALICE@X.COM' });
  check(
    'a case/space variant is blocked as a duplicate',
    blocked.status === 409 && Array.isArray(blocked.json?.duplicates) && blocked.json.duplicates.length === 1,
    `HTTP ${blocked.status} matches=${blocked.json?.duplicates?.length}`,
  );

  // ── AND combination ─────────────────────────────────────────────────────
  await req('/api/v1/duplicate-rules', {
    method: 'POST', cookie: cookieAdmin,
    body: {
      name: 'Name match', objectApiName: 'contact', logic: 'AND', onMatch: 'block',
      conditions: [
        { field: 'first_name', matchType: 'normalized' },
        { field: 'last_name', matchType: 'normalized' },
      ],
    },
  });
  const name1 = await createRecord({ name: 'John Doe', first_name: 'John', last_name: 'Doe', email: 'john@x.com' });
  check('AND rule: baseline record created', name1.status === 201, `HTTP ${name1.status}`);
  const namePartial = await createRecord({ name: 'John Smith', first_name: 'John', last_name: 'Smith', email: 'jsmith@x.com' });
  check('AND rule: partial match is not a duplicate', namePartial.status === 201, `HTTP ${namePartial.status}`);
  const nameFull = await createRecord({ name: 'John Doe 2', first_name: 'John', last_name: 'Doe', email: 'jdoe2@x.com' });
  check('AND rule: full match is blocked', nameFull.status === 409, `HTTP ${nameFull.status}`);

  // ── OR combination ──────────────────────────────────────────────────────
  await req('/api/v1/duplicate-rules', {
    method: 'POST', cookie: cookieAdmin,
    body: {
      name: 'First name or phone', objectApiName: 'contact', logic: 'OR', onMatch: 'block',
      conditions: [
        { field: 'first_name', matchType: 'normalized' },
        { field: 'phone', matchType: 'normalized' },
      ],
    },
  });
  const orBase = await createRecord({ name: 'Zoe', first_name: 'Zoe', phone: '111', email: 'zoe@x.com' });
  check('OR rule: baseline record created', orBase.status === 201, `HTTP ${orBase.status}`);
  const orMatch = await createRecord({ name: 'Zoe Two', first_name: 'Zoe', phone: '222', email: 'zoe2@x.com' });
  check('OR rule: any matching condition is a duplicate', orMatch.status === 409, `HTTP ${orMatch.status}`);

  // ── Exact match is case-sensitive ───────────────────────────────────────
  await req('/api/v1/duplicate-rules', {
    method: 'POST', cookie: cookieAdmin,
    body: {
      name: 'Exact id', objectApiName: 'contact', logic: 'AND', onMatch: 'block',
      conditions: [{ field: 'id_number', matchType: 'exact' }],
    },
  });
  const exactBase = await createRecord({ name: 'ID One', id_number: 'ABC123', email: 'id1@x.com' });
  check('exact rule: baseline record created', exactBase.status === 201, `HTTP ${exactBase.status}`);
  const exactCase = await createRecord({ name: 'ID Two', id_number: 'abc123', email: 'id2@x.com' });
  check('exact match does not fold case', exactCase.status === 201, `HTTP ${exactCase.status}`);

  // ── Dry-run preview endpoint ────────────────────────────────────────────
  const preview = await req('/api/v1/duplicate-rules/check', {
    method: 'POST', cookie: cookieAdmin,
    body: { objectApiName: 'contact', data: { email: 'alice@x.com' } },
  });
  check(
    'dry-run check returns matching records',
    preview.status === 200 && preview.json?.data?.matches?.length === 1 && preview.json?.data?.action === 'block',
    `matches=${preview.json?.data?.matches?.length} action=${preview.json?.data?.action}`,
  );

  // ── Enforcement on update ───────────────────────────────────────────────
  const u1 = await createRecord({ name: 'Upd1', email: 'upd1@x.com' });
  const u2 = await createRecord({ name: 'Upd2', email: 'upd2@x.com' });
  const u1Id = u1.json?.data?.id;
  const u2Id = u2.json?.data?.id;

  const updBlock = await req(`/api/v1/records/contact/${u2Id}`, {
    method: 'PUT', cookie: cookieAdmin, body: { email: 'upd1@x.com' },
  });
  check('an update colliding with another record is blocked', updBlock.status === 409, `HTTP ${updBlock.status}`);

  const updSelf = await req(`/api/v1/records/contact/${u2Id}`, {
    method: 'PUT', cookie: cookieAdmin, body: { email: 'upd2@x.com' },
  });
  check('a record does not collide with itself', updSelf.status === 200, `HTTP ${updSelf.status}`);

  const updNoField = await req(`/api/v1/records/contact/${u2Id}`, {
    method: 'PUT', cookie: cookieAdmin, body: { name: 'Upd2 renamed' },
  });
  check('an update without a matching field is allowed', updNoField.status === 200, `HTTP ${updNoField.status}`);

  // ── Warn behaviour ──────────────────────────────────────────────────────
  const toWarn = await req(`/api/v1/duplicate-rules/${emailRuleId}`, {
    method: 'PUT', cookie: cookieAdmin, body: { onMatch: 'warn' },
  });
  check('a rule can be switched to warn', toWarn.status === 200 && toWarn.json?.data?.onMatch === 'warn', `HTTP ${toWarn.status}`);

  const warned = await createRecord({ name: 'Carol', email: 'ALICE@X.COM' });
  check(
    'warn allows creation but returns the matches',
    warned.status === 201 && warned.json?.duplicateMatches?.length === 1,
    `HTTP ${warned.status} matches=${warned.json?.duplicateMatches?.length}`,
  );

  // ── Guard rails & isolation ─────────────────────────────────────────────
  const stdList = await req('/api/v1/duplicate-rules', { cookie: cookieStd });
  check('a non-admin cannot manage duplicate rules', stdList.status === 403, `HTTP ${stdList.status}`);

  const tenantB = await Tenant.create({
    name: `ZZ_DUP_B_${RUN}`, slug: `zz-dup-b-${RUN}`, status: 'active', plan: 'enterprise',
  });
  tenantBId = tenantB._id;
  await seedDefaultRoles(tenantBId);
  const roleB = await Role.findOne({ tenantId: tenantBId, name: 'admin' });
  const userB = await User.create({
    tenantId: tenantBId, firstName: 'Other', lastName: 'Tenant', email: `otherdup-${RUN}@example.com`,
    username: `otherdup_${RUN}`, password: PASSWORD, role: roleB._id, status: 'active', emailVerified: true,
  });
  const cookieOther = await loginCookie(userB.username);

  const listOther = await req('/api/v1/duplicate-rules', { cookie: cookieOther });
  check('another tenant sees no duplicate rules', listOther.status === 200 && listOther.json?.data?.length === 0, `count=${listOther.json?.data?.length}`);

  const previewOther = await req('/api/v1/duplicate-rules/check', {
    method: 'POST', cookie: cookieOther,
    body: { objectApiName: 'contact', data: { email: 'alice@x.com' } },
  });
  check(
    'another tenant matches nothing (rules are tenant-scoped)',
    previewOther.status === 200 && previewOther.json?.data?.matches?.length === 0,
    `matches=${previewOther.json?.data?.matches?.length}`,
  );

  // An update must not be able to move a rule into another tenant.
  const moveAttempt = await req(`/api/v1/duplicate-rules/${emailRuleId}`, {
    method: 'PUT', cookie: cookieAdmin, body: { tenantId: tenantBId, name: 'Moved?' },
  });
  const stillHere = await DuplicateRule.findById(emailRuleId).lean();
  check(
    'an update cannot move a rule to another tenant',
    moveAttempt.status === 200 && String(stillHere?.tenantId) === String(tenantId) && stillHere?.name === 'Moved?',
    `tenant=${stillHere?.tenantId}`,
  );
} catch (err) {
  check('test harness ran without error', false, err.message);
} finally {
  if (tenantId || tenantBId) {
    const ids = [tenantId, tenantBId].filter(Boolean);
    await Tenant.deleteMany({ _id: { $in: ids } });
    await Promise.all([
      User, Role, Session, ObjectMeta, FieldMeta, DynamicRecord, DuplicateRule,
    ].map((M) => M.deleteMany({ tenantId: { $in: ids } }).catch(() => {})));
  }
  server.close();
  await mongoose.connection.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
