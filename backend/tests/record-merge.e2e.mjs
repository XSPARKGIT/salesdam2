/**
 * record-merge.e2e.mjs — duplicate record merge (Core BRD §3.4).
 *
 * Boots the real Express app, seeds a tenant with contact + deal objects (with
 * a lookup between them) and exercises: blank-field fill, explicit field
 * override, reference repointing, soft-delete + mergedIntoId, merge history,
 * validation-restore on a rejected merge, and the guard rails.
 *
 * Run: node tests/record-merge.e2e.mjs   (from backend/)
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
import AuditLog from '../models/AuditLog.js';
import Activity from '../models/Activity.js';
import { seedDefaultRoles } from '../services/roleService.js';

const RUN = Date.now().toString(36);
const PASSWORD = 'Merge123!';

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

let tenantAId = null;
let tenantBId = null;
const models = [User, Role, Session, ObjectMeta, FieldMeta, DynamicRecord, AuditLog, Activity];

try {
  await connectDB();

  const tenantA = await Tenant.create({ name: `ZZ_MERGE_${RUN}`, slug: `zz-merge-${RUN}`, status: 'active', plan: 'enterprise' });
  tenantAId = tenantA._id;
  await seedDefaultRoles(tenantAId);
  const roleAdmin = await Role.findOne({ tenantId: tenantAId, name: 'admin' });
  const roleStd = await Role.findOne({ tenantId: tenantAId, name: 'standard_user' });

  const admin = await User.create({
    tenantId: tenantAId, firstName: 'Merge', lastName: 'Admin', email: `mergeadmin-${RUN}@example.com`,
    username: `mergeadmin_${RUN}`, password: PASSWORD, role: roleAdmin._id, status: 'active', emailVerified: true,
  });
  const std = await User.create({
    tenantId: tenantAId, firstName: 'Merge', lastName: 'Std', email: `mergestd-${RUN}@example.com`,
    username: `mergestd_${RUN}`, password: PASSWORD, role: roleStd._id, status: 'active', emailVerified: true,
  });
  const cookieAdmin = await loginCookie(admin.username);
  const cookieStd = await loginCookie(std.username);
  check('users can log in', Boolean(cookieAdmin && cookieStd));

  const contactObj = await ObjectMeta.create({
    tenantId: tenantAId, name: 'Contact', label: 'Contact', pluralLabel: 'Contacts',
    apiName: 'contact', nameFieldApiName: 'name', isActive: true, searchable: true,
  });
  const dealObj = await ObjectMeta.create({
    tenantId: tenantAId, name: 'Deal', label: 'Deal', pluralLabel: 'Deals',
    apiName: 'deal', nameFieldApiName: 'name', isActive: true, searchable: true,
  });
  const mkField = (objectId, objectApiName, apiName, type, extra = {}) =>
    FieldMeta.create({ tenantId: tenantAId, objectId, objectApiName, name: apiName, label: apiName, apiName, type, ...extra });

  await mkField(contactObj._id, 'contact', 'name', 'text');
  await mkField(contactObj._id, 'contact', 'email', 'email');
  await mkField(contactObj._id, 'contact', 'phone', 'phone');
  await mkField(contactObj._id, 'contact', 'status', 'text', { isRequired: true });

  await mkField(dealObj._id, 'deal', 'name', 'text');
  await mkField(dealObj._id, 'deal', 'contact_id', 'lookup', { lookupObjectApiName: 'contact' });

  const createRecord = (object, body) =>
    req(`/api/v1/records/${object}`, { method: 'POST', cookie: cookieAdmin, body });
  const merge = (object, body) =>
    req(`/api/v1/records/${object}/merge`, { method: 'POST', cookie: cookieAdmin, body });

  // ── Blank fill, soft delete, ref repoint ────────────────────────────────
  const a = await createRecord('contact', { name: 'Alice', email: 'a@x.com', status: 'open' });
  const b = await createRecord('contact', { name: 'Bob', phone: '+27821111111', status: 'open' });
  const aId = a.json?.data?.id;
  const bId = b.json?.data?.id;
  check('a baseline pair of records is created', a.status === 201 && b.status === 201, `HTTP ${a.status}/${b.status}`);

  const deal = await createRecord('deal', { name: 'Deal 1', contact_id: String(bId) });
  const dealId = deal.json?.data?.id;
  check('a deal referencing the duplicate record is created', deal.status === 201, `HTTP ${deal.status}`);

  // Activities logged on the duplicate, as primary record and as a related one.
  const noteOnB = await Activity.create({
    tenantId: tenantAId, type: 'note', subject: 'Called Bob', objectApiName: 'contact', recordId: bId,
  });
  const meetingRelB = await Activity.create({
    tenantId: tenantAId, type: 'meeting', subject: 'Deal review', objectApiName: 'deal', recordId: dealId,
    relatedRecords: [{ objectApiName: 'contact', recordId: bId }],
  });

  const merged = await merge('contact', { masterId: aId, duplicateIds: [bId] });
  check('a merge returns the surviving record', merged.status === 200, `HTTP ${merged.status}`);
  check('blank master fields are filled from the duplicate', merged.json?.data?.master?.phone === '+27821111111', `phone=${merged.json?.data?.master?.phone}`);
  check('non-blank master fields are kept', merged.json?.data?.master?.email === 'a@x.com' && merged.json?.data?.master?.name === 'Alice', `name=${merged.json?.data?.master?.name}`);
  check('the duplicate is reported as merged away', (merged.json?.data?.mergedRecordIds || []).includes(String(bId)), `ids=${merged.json?.data?.mergedRecordIds}`);

  const loser = await DynamicRecord.findById(bId);
  check('the duplicate is soft-deleted and stamped', loser?.isDeleted === true && String(loser?.mergedIntoId) === String(aId), `deleted=${loser?.isDeleted} into=${loser?.mergedIntoId}`);

  const master = await DynamicRecord.findById(aId);
  check('the survivor records merge history', master?.mergeHistory?.length === 1, `entries=${master?.mergeHistory?.length}`);

  const dealAfter = await DynamicRecord.findById(dealId);
  check('references are repointed to the survivor', String(dealAfter?.data?.get('contact_id')) === String(aId), `contact_id=${dealAfter?.data?.get('contact_id')}`);

  const noteAfter = await Activity.findById(noteOnB._id).lean();
  const meetingAfter = await Activity.findById(meetingRelB._id).lean();
  check(
    "the duplicate's activities move to the survivor's timeline",
    String(noteAfter?.recordId) === String(aId) &&
      String(meetingAfter?.relatedRecords?.[0]?.recordId) === String(aId) &&
      String(meetingAfter?.recordId) === String(dealId),
    `note=${noteAfter?.recordId} related=${meetingAfter?.relatedRecords?.[0]?.recordId}`,
  );
  check(
    'moved activities are reported with the merge',
    merged.json?.data?.repointedReferences?.some((r) => r.objectApiName === 'activity' && r.count === 2),
    JSON.stringify(merged.json?.data?.repointedReferences),
  );

  const auditEntry = await AuditLog.findOne({ tenantId: tenantAId, action: 'merge' });
  check('the merge is written to the audit log', Boolean(auditEntry) && String(auditEntry.resourceId) === String(aId), `found=${Boolean(auditEntry)}`);

  // A second record read through the API must be gone.
  const deletedList = await req('/api/v1/records/contact', { cookie: cookieAdmin });
  check('the merged-away record no longer appears', (deletedList.json?.data || []).every((r) => r.id !== String(bId)), `count=${deletedList.json?.data?.length}`);

  // ── Explicit field override ─────────────────────────────────────────────
  const c = await createRecord('contact', { name: 'Carol', email: 'c@x.com', status: 'open' });
  const d = await createRecord('contact', { name: 'Dana', phone: '+27822222222', status: 'open' });
  const overridden = await merge('contact', {
    masterId: c.json?.data?.id, duplicateIds: [d.json?.data?.id], fieldValues: { phone: '+27000000000' },
  });
  check('an explicit field value wins over the duplicate', overridden.json?.data?.master?.phone === '+27000000000', `phone=${overridden.json?.data?.master?.phone}`);

  // ── Failed validation restores the duplicate ────────────────────────────
  const e = await createRecord('contact', { name: 'Eve', email: 'e@x.com', status: 'open' });
  const f = await createRecord('contact', { name: 'Finn', email: 'f@x.com', status: 'open' });
  const fId = f.json?.data?.id;
  const rejected = await merge('contact', {
    masterId: e.json?.data?.id, duplicateIds: [fId], fieldValues: { status: '' },
  });
  check('a merge that breaks validation is rejected', rejected.status === 400, `HTTP ${rejected.status}`);
  const fAfter = await DynamicRecord.findById(fId);
  check('a rejected merge restores the duplicate', fAfter?.isDeleted === false, `deleted=${fAfter?.isDeleted}`);

  // ── Guard rails ─────────────────────────────────────────────────────────
  const sameId = await merge('contact', { masterId: aId, duplicateIds: [aId] });
  check('the master cannot be its own duplicate', sameId.status === 400, `HTTP ${sameId.status}`);

  const noDupes = await merge('contact', { masterId: aId, duplicateIds: [] });
  check('at least one duplicate id is required', noDupes.status === 400, `HTTP ${noDupes.status}`);

  const missing = await merge('contact', { masterId: aId, duplicateIds: [new mongoose.Types.ObjectId().toString()] });
  check('an unknown duplicate is rejected', missing.status === 404, `HTTP ${missing.status}`);

  const stdAllowed = await req('/api/v1/records/contact/merge', {
    method: 'POST', cookie: cookieStd, body: { masterId: aId, duplicateIds: [String(fId)] },
  });
  check('a standard user can merge a contact they may delete', stdAllowed.status === 200, `HTTP ${stdAllowed.status}`);

  const widgetNoPerm = await req('/api/v1/records/widget/merge', {
    method: 'POST', cookie: cookieStd, body: { masterId: aId, duplicateIds: [String(fId)] },
  });
  check('an object without permission is refused', widgetNoPerm.status === 403, `HTTP ${widgetNoPerm.status}`);

  // ── Tenant isolation ────────────────────────────────────────────────────
  const tenantB = await Tenant.create({ name: `ZZ_MERGE_B_${RUN}`, slug: `zz-merge-b-${RUN}`, status: 'active', plan: 'enterprise' });
  tenantBId = tenantB._id;
  await seedDefaultRoles(tenantBId);
  const roleAdminB = await Role.findOne({ tenantId: tenantBId, name: 'admin' });
  const adminB = await User.create({
    tenantId: tenantBId, firstName: 'Other', lastName: 'Admin', email: `mergeadminb-${RUN}@example.com`,
    username: `mergeadminb_${RUN}`, password: PASSWORD, role: roleAdminB._id, status: 'active', emailVerified: true,
  });
  const cookieAdminB = await loginCookie(adminB.username);
  const crossTenant = await req('/api/v1/records/contact/merge', {
    method: 'POST', cookie: cookieAdminB, body: { masterId: aId, duplicateIds: [String(fId)] },
  });
  check('a merge cannot cross tenants', crossTenant.status === 404, `HTTP ${tenantBId}`);
} catch (err) {
  check('test harness ran without error', false, err.message);
} finally {
  const ids = [tenantAId, tenantBId].filter(Boolean);
  if (ids.length) {
    await Tenant.deleteMany({ _id: { $in: ids } });
    await Promise.all(models.map((M) => M.deleteMany({ tenantId: { $in: ids } }).catch(() => {})));
  }
  server.close();
  await mongoose.connection.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
