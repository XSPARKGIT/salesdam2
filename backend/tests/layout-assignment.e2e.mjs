/**
 * layout-assignment.e2e.mjs — BRD 4.2 Layout Assignment.
 *
 * Boots the real Express app and verifies, through the API:
 *  - Assignment by Profile: a Role sees its assigned default layout; a Role
 *    without an assignment sees the object's default layout
 *  - Assignment by condition: "use layout X when Type = value", first matching
 *    rule wins, Profile default when none match
 *  - New-record behaviour: without a saved record the Role default is used, and
 *    the conditional layout applies once the record is saved with the value
 *  - rules can't be used to read records the user can't see
 *  - only setup users can change assignments, and input is validated
 *  - deleting a layout removes the rules that pointed at it
 *
 * Run: node tests/layout-assignment.e2e.mjs   (from backend/)
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
import Layout from '../models/Layout.js';
import LayoutAssignment from '../models/LayoutAssignment.js';
import AuditLog from '../models/AuditLog.js';
import Workspace from '../models/Workspace.js';
import { seedDefaultRoles } from '../services/roleService.js';
import { seedWorkspace } from './helpers/workspace.mjs';

const RUN = Date.now().toString(36);
const PASSWORD = 'LayoutTest123!';

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
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
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
const models = [User, Role, Session, ObjectMeta, FieldMeta, DynamicRecord, Layout, LayoutAssignment, AuditLog, Workspace];

try {
  await connectDB();

  const tenant = await Tenant.create({ name: `ZZ_LAYOUT_${RUN}`, slug: `zz-layout-${RUN}`, status: 'active', plan: 'enterprise' });
  tenantId = tenant._id;
  await seedDefaultRoles(tenantId);
  const roleAdmin = await Role.findOne({ tenantId, name: 'admin' });
  const perm = (objectApiName) => ({ objectApiName, canCreate: true, canRead: true, canUpdate: true, canDelete: false });
  const roleRep = await Role.create({
    tenantId, name: `rep_${RUN}`, label: 'Rep', dataAccess: 'own',
    objectPermissions: [perm('policy'), perm('memo')],
  });

  const mkUser = (key, role) => User.create({
    tenantId, firstName: 'Lay', lastName: key, email: `lay-${key}-${RUN}@example.com`,
    username: `lay_${key}_${RUN}`, password: PASSWORD, role: role._id, status: 'active', emailVerified: true,
  });
  const adminU = await mkUser('admin', roleAdmin);
  const repU = await mkUser('rep', roleRep);
  await seedWorkspace(tenantId, [adminU._id, repU._id], ['policy', 'memo']);
  const adminC = await loginCookie(adminU.username);
  const repC = await loginCookie(repU.username);
  check('admin and rep can log in', Boolean(adminC && repC));

  const policy = await ObjectMeta.create({
    tenantId, name: 'Policy', label: 'Policy', pluralLabel: 'Policies', apiName: 'policy', nameFieldApiName: 'name', isActive: true,
  });
  const memo = await ObjectMeta.create({
    tenantId, name: 'Memo', label: 'Memo', pluralLabel: 'Memos', apiName: 'memo', nameFieldApiName: 'name', isActive: true,
  });
  const pf = { tenantId, objectId: policy._id, objectApiName: 'policy' };
  await FieldMeta.create([
    { ...pf, name: 'name', label: 'Name', apiName: 'name', type: 'text' },
    { ...pf, name: 'type', label: 'Type', apiName: 'type', type: 'picklist',
      picklistValues: ['individual', 'group', 'corporate'].map((v) => ({ label: v, value: v, isActive: true })) },
  ]);

  const section = (label) => [{ id: 's1', label, columns: 1, columnData: [{ fields: [{ fieldApiName: 'name' }] }] }];
  const mkLayout = (name, isDefault = false, obj = policy) => Layout.create({
    tenantId, objectId: obj._id, objectApiName: obj.apiName, name, isDefault, type: 'detail', sections: section(name),
  });
  const defaultL = await mkLayout('Default Layout', true);
  const repL = await mkLayout('Rep Layout');
  const groupL = await mkLayout('Group Layout');
  const notIndividualL = await mkLayout('Not Individual Layout');
  const memoL = await mkLayout('Memo Layout', true, memo);

  const mkRecord = async (owner, type) => {
    const r = new DynamicRecord({ ...pf, ownerId: owner._id, createdBy: owner._id, lastModifiedBy: owner._id });
    r.setField('name', `${type} policy`);
    r.setField('type', type);
    await r.save();
    return r;
  };
  const groupRec = await mkRecord(repU, 'group');
  const individualRec = await mkRecord(repU, 'individual');
  const adminsGroupRec = await mkRecord(adminU, 'group'); // rep can't see (dataAccess: own)

  const resolve = (cookie, recordId) =>
    req(`/api/v1/layouts/policy/resolve?type=detail${recordId ? `&recordId=${recordId}` : ''}`, { cookie });
  const nameOf = (r) => r.json?.data?.name;

  // ── Before any assignment ─────────────────────────────────────────────────
  let r = await resolve(repC, groupRec._id);
  check('without an assignment a role sees the object default layout', nameOf(r) === 'Default Layout', `${r.status} ${nameOf(r)}`);

  // ── Permissions and validation ────────────────────────────────────────────
  const goodBody = {
    assignments: [{
      roleId: roleRep._id,
      defaultLayoutId: repL._id,
      rules: [{ field: 'type', operator: 'eq', value: 'group', layoutId: groupL._id }],
    }],
  };
  r = await req('/api/v1/layouts/policy/assignments', { method: 'PUT', cookie: repC, body: goodBody });
  check('a non-setup user cannot change layout assignment', r.status === 403, `HTTP ${r.status}`);

  const bad = async (label, assignment) => {
    const res = await req('/api/v1/layouts/policy/assignments', { method: 'PUT', cookie: adminC, body: { assignments: [assignment] } });
    check(`rejects ${label}`, res.status === 400, `HTTP ${res.status} ${res.json?.message || ''}`);
  };
  await bad('a layout from another object', { roleId: roleRep._id, defaultLayoutId: memoL._id, rules: [] });
  await bad('a rule on an unknown field', { roleId: roleRep._id, rules: [{ field: 'nope', operator: 'eq', value: 'x', layoutId: groupL._id }] });
  await bad('an equals rule with no value', { roleId: roleRep._id, rules: [{ field: 'type', operator: 'eq', value: '', layoutId: groupL._id }] });
  await bad('an unknown role', { roleId: new mongoose.Types.ObjectId(), defaultLayoutId: repL._id });

  r = await req('/api/v1/layouts/policy/assignments', { method: 'PUT', cookie: adminC, body: goodBody });
  check('admin saves a profile default and a conditional rule', r.status === 200 && r.json?.data?.length === 1, `HTTP ${r.status} ${r.json?.message || ''}`);

  // ── Assignment by Profile / by condition ─────────────────────────────────
  r = await resolve(repC);
  check('new record (no saved Type) shows the role default', nameOf(r) === 'Rep Layout' && r.json?.assignment?.source === 'profile', `${nameOf(r)} ${r.json?.assignment?.source}`);

  r = await resolve(repC, individualRec._id);
  check('record not matching any rule shows the role default', nameOf(r) === 'Rep Layout', nameOf(r));

  r = await resolve(repC, groupRec._id);
  check('record matching Type = group shows the conditional layout', nameOf(r) === 'Group Layout' && r.json?.assignment?.source === 'rule', `${nameOf(r)} ${r.json?.assignment?.source}`);

  r = await resolve(adminC, groupRec._id);
  check('a role with no assignment still sees the object default', nameOf(r) === 'Default Layout', nameOf(r));

  r = await resolve(repC, adminsGroupRec._id);
  check('rules are not applied to a record the user cannot see', nameOf(r) === 'Rep Layout', nameOf(r));

  // ── New-record behaviour: switches after save ────────────────────────────
  const patch = await req(`/api/v1/records/policy/${individualRec._id}`, { method: 'PATCH', cookie: repC, body: { type: 'group' } });
  r = await resolve(repC, individualRec._id);
  check('after saving Type = group the record switches to the conditional layout', patch.status === 200 && nameOf(r) === 'Group Layout', `PATCH ${patch.status} → ${nameOf(r)}`);

  // ── First matching rule wins ─────────────────────────────────────────────
  await req('/api/v1/layouts/policy/assignments', {
    method: 'PUT', cookie: adminC,
    body: { assignments: [{
      roleId: roleRep._id,
      defaultLayoutId: repL._id,
      rules: [
        { field: 'type', operator: 'neq', value: 'individual', layoutId: notIndividualL._id },
        { field: 'type', operator: 'eq', value: 'group', layoutId: groupL._id },
      ],
    }] },
  });
  r = await resolve(repC, groupRec._id);
  check('when two rules match, the first one wins', nameOf(r) === 'Not Individual Layout' && r.json?.assignment?.ruleIndex === 0, `${nameOf(r)} rule ${r.json?.assignment?.ruleIndex}`);

  r = await req('/api/v1/layouts/policy/assignments', { cookie: adminC });
  const saved = r.json?.data?.[0];
  check('rule order is kept', saved?.rules?.map((x) => x.operator).join(',') === 'neq,eq', saved?.rules?.map((x) => x.operator).join(','));

  // ── Deleting a layout cleans up ──────────────────────────────────────────
  const del = await req(`/api/v1/layouts/${notIndividualL._id}`, { method: 'DELETE', cookie: adminC });
  r = await resolve(repC, groupRec._id);
  check('deleting a layout drops the rules that used it', del.status === 200 && nameOf(r) === 'Group Layout', `DELETE ${del.status} → ${nameOf(r)}`);

  // ── Clearing the assignment ──────────────────────────────────────────────
  r = await req('/api/v1/layouts/policy/assignments', { method: 'PUT', cookie: adminC, body: { assignments: [] } });
  const left = await LayoutAssignment.countDocuments({ tenantId, objectApiName: 'policy' });
  const back = await resolve(repC, groupRec._id);
  check('clearing assignments returns the role to the object default', r.status === 200 && left === 0 && nameOf(back) === 'Default Layout', `left=${left} → ${nameOf(back)}`);
  check('object default layout is untouched', String(back.json?.data?._id) === String(defaultL._id));
} catch (err) {
  check('test harness ran without error', false, err.stack || err.message);
} finally {
  if (tenantId) {
    await Tenant.deleteMany({ _id: tenantId });
    await Promise.all(models.map((M) => M.deleteMany({ tenantId }).catch(() => {})));
  }
  server.close();
  await mongoose.connection.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
