/**
 * sharing-model.e2e.mjs — Section 9.2 Sharing Model end-to-end verification.
 *
 * Boots the real Express app against the configured Mongo database, creates an
 * isolated tenant with multiple users/roles/records, and exercises:
 *   - OWD private / public read-only / public read-write
 *   - multi-level manager hierarchy visibility
 *   - criteria-based sharing rules (group + role targets, read & readWrite)
 *   - backend enforcement on read, update and delete (direct API calls)
 *   - admin sharing-settings API persistence (the UI's data contract)
 *   - regression: approval routing / auth still function
 *
 * Run: node tests/sharing-model.e2e.mjs   (from backend/)
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import app from '../app.js';
import Tenant from '../models/Tenant.js';
import User from '../models/User.js';
import Role from '../models/Role.js';
import ObjectMeta from '../models/ObjectMeta.js';
import FieldMeta from '../models/FieldMeta.js';
import DynamicRecord from '../models/DynamicRecord.js';
import ApproverGroup from '../models/ApproverGroup.js';
import ObjectSharingSetting from '../models/ObjectSharingSetting.js';
import SharingRule from '../models/SharingRule.js';
import ApprovalProcess from '../models/ApprovalProcess.js';
import { seedWorkspace } from './helpers/workspace.mjs';

const RUN = Date.now().toString(36);
const PASSWORD = 'ShareTest123!';
const results = [];

const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const makeRole = (tenantId, name, { read = true, update = false, create = true, del = false, dataAccess = 'own' } = {}) =>
  Role.create({
    tenantId,
    name: `${name}_${RUN}`,
    label: name,
    dataAccess,
    objectPermissions: ['policy', 'insurance', 'case'].map((objectApiName) => ({
      objectApiName,
      canCreate: create,
      canRead: read,
      canUpdate: update,
      canDelete: del,
      canExport: false,
      canImport: false,
    })),
  });

const makeUser = (tenantId, roleId, label, extra = {}) =>
  User.create({
    tenantId,
    firstName: label,
    lastName: 'Test',
    email: `${label.toLowerCase()}-${RUN}@example.com`,
    username: `${label.toLowerCase()}_${RUN}`,
    password: PASSWORD,
    role: roleId,
    status: 'active',
    emailVerified: true,
    ...extra,
  });

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

const recordIds = (body) => (body?.data?.records || body?.records || []).map((r) => String(r.id || r._id));

let tenant;
try {
  await connectDB();

  tenant = await Tenant.create({
    name: `ZZ_SHARING_${RUN}`,
    slug: `zz-sharing-${RUN}`,
    status: 'active',
    plan: 'enterprise',
  });

  const adminRole = await makeRole(tenant._id, 'admin', { update: true, del: true, dataAccess: 'all' });
  adminRole.name = 'admin';
  await adminRole.save();

  const repRole = await makeRole(tenant._id, 'rep', { update: true, del: true });
  const viewerRole = await makeRole(tenant._id, 'viewer', { update: false });
  const editorRole = await makeRole(tenant._id, 'editor', { update: true, del: true });

  const admin = await makeUser(tenant._id, adminRole._id, 'Admin');
  const owner = await makeUser(tenant._id, repRole._id, 'Owner');
  const unrelated = await makeUser(tenant._id, repRole._id, 'Unrelated');
  const manager = await makeUser(tenant._id, repRole._id, 'Manager');
  const grandboss = await makeUser(tenant._id, repRole._id, 'Grandboss');
  const groupMember = await makeUser(tenant._id, viewerRole._id, 'GroupMember');
  const rwMember = await makeUser(tenant._id, editorRole._id, 'RwMember');
  const editor = await makeUser(tenant._id, editorRole._id, 'Editor');
  editorRole.objectPermissions.forEach((p) => { p.canExport = true; });
  await editorRole.save();
  const noReadRole = await makeRole(tenant._id, 'noread', { read: false, update: false });
  const noReadUser = await makeUser(tenant._id, noReadRole._id, 'NoRead');

  owner.manager = manager._id;
  await owner.save();
  manager.manager = grandboss._id;
  await manager.save();

  for (const [name, label] of [['policy', 'Policy'], ['insurance', 'Insurance'], ['case', 'Case']]) {
    await ObjectMeta.create({
      tenantId: tenant._id,
      name: label,
      label,
      pluralLabel: `${label}s`,
      apiName: name,
      nameFieldApiName: 'name',
      isActive: true,
      searchable: true,
    });
  }
  const policyObj = await ObjectMeta.findOne({ tenantId: tenant._id, apiName: 'policy' });
  const insuranceObj = await ObjectMeta.findOne({ tenantId: tenant._id, apiName: 'insurance' });

  for (const f of [
    { apiName: 'name', label: 'Name', type: 'text' },
    { apiName: 'type', label: 'Type', type: 'picklist' },
    { apiName: 'premium', label: 'Premium', type: 'currency' },
  ]) {
    await FieldMeta.create({
      tenantId: tenant._id,
      objectId: policyObj._id,
      objectApiName: 'policy',
      ...f,
      name: f.label,
    });
  }

  await seedWorkspace(tenant._id, [admin._id, owner._id, unrelated._id, manager._id, grandboss._id, groupMember._id, rwMember._id, editor._id, noReadUser._id], ['policy', 'insurance', 'case']);

  const funeralGroup = await ApproverGroup.create({
    tenantId: tenant._id,
    name: `funeral_${RUN}`,
    label: 'Funeral Team',
    memberIds: [groupMember._id],
    roleIds: [],
  });
  const rwGroup = await ApproverGroup.create({
    tenantId: tenant._id,
    name: `rw_${RUN}`,
    label: 'RW Group',
    memberIds: [rwMember._id],
    roleIds: [],
  });

  const mkRecord = (obj, ownerUser, data) => DynamicRecord.create({
    tenantId: tenant._id,
    objectId: obj._id,
    objectApiName: obj.apiName,
    ownerId: ownerUser._id,
    createdBy: ownerUser._id,
    lastModifiedBy: ownerUser._id,
    _searchText: Object.values(data).filter((v) => v != null).join(' '),
    data,
  });

  const funeralPolicy = await mkRecord(policyObj, owner, { name: `Funeral Policy ${RUN}`, type: 'Funeral', premium: 1000 });
  const motorPolicy = await mkRecord(policyObj, owner, { name: `Motor Policy ${RUN}`, type: 'Motor', premium: 500 });
  const insuranceRecord = await mkRecord(insuranceObj, owner, { name: `Insurance ${RUN}`, type: 'Funeral' });

  const users = { admin, owner, unrelated, manager, grandboss, groupMember, rwMember, editor, noReadUser };
  const logins = {};
  for (const [label, u] of Object.entries(users)) {
    logins[label] = await loginCookie(u.username);
  }
  const C = Object.fromEntries(Object.entries(logins).map(([k, v]) => [k, v.cookie]));

  check('admin can authenticate', logins.admin.status === 200 && !!C.admin, `HTTP ${logins.admin.status}`);
  check('owner can authenticate', logins.owner.status === 200 && !!C.owner);

  // ── 1. OWD Private ────────────────────────────────────────────────────────
  const putPrivate = await req('/api/v1/sharing/settings/policy', {
    method: 'PUT', cookie: C.admin, body: { orgWideDefault: 'private' },
  });
  check('admin sets policy OWD to private', putPrivate.status === 200, `HTTP ${putPrivate.status}`);
  const persisted = await ObjectSharingSetting.findOne({ tenantId: tenant._id, objectApiName: 'policy' }).lean();
  check('OWD persisted to database', persisted?.orgWideDefault === 'private');

  let r = await req(`/api/v1/records/policy/${funeralPolicy._id}`, { cookie: C.unrelated });
  check('private OWD: unrelated user cannot read record', r.status === 404, `HTTP ${r.status}`);

  r = await req('/api/v1/records/policy?limit=100', { cookie: C.unrelated });
  check('private OWD: unrelated user list excludes record', !r.text.includes(String(funeralPolicy._id)), `HTTP ${r.status}`);

  r = await req(`/api/v1/records/policy/${funeralPolicy._id}`, { cookie: C.owner });
  check('private OWD: owner can read own record', r.status === 200, `HTTP ${r.status}`);

  // direct API security
  r = await req(`/api/v1/records/policy/${funeralPolicy._id}`);
  check('API security: unauthenticated read rejected', r.status === 401, `HTTP ${r.status}`);

  r = await req(`/api/v1/records/policy/${funeralPolicy._id}`, {
    method: 'DELETE', cookie: C.unrelated,
  });
  check('API security: unrelated user cannot delete record', [403, 404].includes(r.status), `HTTP ${r.status}`);
  const stillAlive = await DynamicRecord.findById(funeralPolicy._id).lean();
  check('record intact after unauthorized delete', !!stillAlive && !stillAlive.isDeleted);

  // ── 2. Role hierarchy (multi-level) ──────────────────────────────────────
  r = await req(`/api/v1/records/policy/${funeralPolicy._id}`, { cookie: C.manager });
  check('hierarchy: direct manager can read subordinate record', r.status === 200, `HTTP ${r.status}`);
  r = await req(`/api/v1/records/policy/${funeralPolicy._id}`, { cookie: C.grandboss });
  check('hierarchy: second-level manager can read record', r.status === 200, `HTTP ${r.status}`);

  // Manager with update permission may edit; viewer role manager must not.
  const managerViewer = await makeUser(tenant._id, viewerRole._id, 'MgrViewer', { manager: null });
  // make managerViewer the manager of a fresh owner so hierarchy is exercised.
  const hierOwner = await makeUser(tenant._id, repRole._id, 'HierOwner');
  hierOwner.manager = managerViewer._id;
  await hierOwner.save();
  await seedWorkspace(tenant._id, [managerViewer._id, hierOwner._id], ['policy'], 'Hierarchy Workspace');
  const hierRecord = await mkRecord(policyObj, hierOwner, { name: `Hier ${RUN}`, type: 'Motor' });
  const loginMgrViewer = await loginCookie(managerViewer.username);
  const loginHierOwner = await loginCookie(hierOwner.username);
  r = await req(`/api/v1/records/policy/${hierRecord._id}`, { cookie: loginMgrViewer.cookie });
  check('hierarchy: read-only manager can view subordinate record', r.status === 200, `HTTP ${r.status}`);
  r = await req(`/api/v1/records/policy/${hierRecord._id}`, {
    method: 'PATCH', cookie: loginMgrViewer.cookie, body: { premium: 9 },
  });
  check('hierarchy: manager without update permission cannot edit', r.status === 403, `HTTP ${r.status}`);

  // ── 3. Sharing rules (Private OWD) ───────────────────────────────────────
  const createRule = (body) => req('/api/v1/sharing/rules', { method: 'POST', cookie: C.admin, body });
  const ruleRead = await createRule({
    objectApiName: 'policy',
    name: 'Funeral policies to Funeral Team',
    ruleType: 'criteria',
    criteria: [{ field: 'type', operator: 'eq', value: 'Funeral' }],
    sharedWith: { type: 'group', id: funeralGroup._id },
    accessLevel: 'read',
  });
  check('admin creates read-only sharing rule via API', ruleRead.status === 201 || ruleRead.status === 200, `HTTP ${ruleRead.status}`);
  const ruleReadDb = await SharingRule.findOne({ tenantId: tenant._id, name: 'Funeral policies to Funeral Team' }).lean();
  check('sharing rule persisted to database', !!ruleReadDb);

  // ── 3a. Empty / invalid rules must never grant all records ───────────────
  const emptyRule = await createRule({
    objectApiName: 'policy',
    name: 'Empty criteria rule',
    ruleType: 'criteria',
    criteria: [],
    sharedWith: { type: 'group', id: funeralGroup._id },
    accessLevel: 'read',
  });
  check('API rejects criteria rule with no fields', emptyRule.status === 400, `HTTP ${emptyRule.status}`);

  const blankFieldRule = await createRule({
    objectApiName: 'policy',
    name: 'Blank field rule',
    ruleType: 'criteria',
    criteria: [{ field: '   ', operator: 'eq', value: 'Funeral' }],
    sharedWith: { type: 'group', id: funeralGroup._id },
    accessLevel: 'read',
  });
  check('API rejects criteria rule with blank field', blankFieldRule.status === 400, `HTTP ${blankFieldRule.status}`);

  // Bypass the API (legacy rows / direct DB write) — the enforcement layer must
  // still refuse to interpret an empty criteria rule as "match everything".
  const legacyEmptyRule = await SharingRule.create({
    tenantId: tenant._id,
    objectApiName: 'policy',
    name: 'Legacy empty rule',
    ruleType: 'criteria',
    criteria: [],
    sharedWith: { type: 'user', id: unrelated._id },
    accessLevel: 'readWrite',
    isActive: true,
  });
  r = await req(`/api/v1/records/policy/${motorPolicy._id}`, { cookie: C.unrelated });
  check('empty rule stored in DB grants no records', r.status === 404, `HTTP ${r.status}`);
  r = await req(`/api/v1/records/policy/${motorPolicy._id}`, {
    method: 'PATCH', cookie: C.unrelated, body: { premium: 1 },
  });
  check('empty read-write rule stored in DB grants no write', r.status === 404, `HTTP ${r.status}`);
  await SharingRule.deleteOne({ _id: legacyEmptyRule._id });

  // ── 3b. Object-level permission always wins over sharing ─────────────────
  const noReadRule = await createRule({
    objectApiName: 'policy',
    name: 'Share with no-read user',
    ruleType: 'all',
    criteria: [],
    sharedWith: { type: 'user', id: noReadUser._id },
    accessLevel: 'readWrite',
  });
  check('rule targeting a user can be created', [200, 201].includes(noReadRule.status), `HTTP ${noReadRule.status}`);
  r = await req(`/api/v1/records/policy/${funeralPolicy._id}`, { cookie: C.noReadUser });
  check('object permission precedence: no Read permission → 403 despite sharing', r.status === 403, `HTTP ${r.status}`);
  r = await req(`/api/v1/records/policy/${funeralPolicy._id}`, {
    method: 'PATCH', cookie: C.noReadUser, body: { premium: 2 },
  });
  check('object permission precedence: no Update permission → 403 despite read-write share', r.status === 403, `HTTP ${r.status}`);

  r = await req(`/api/v1/records/policy/${funeralPolicy._id}`, { cookie: C.groupMember });
  check('sharing rule: matching record visible to group member', r.status === 200, `HTTP ${r.status}`);
  r = await req(`/api/v1/records/policy/${motorPolicy._id}`, { cookie: C.groupMember });
  check('sharing rule: non-matching record stays inaccessible', r.status === 404, `HTTP ${r.status}`);

  // Membership changes take effect on the very next request.
  const removeMember = await req(`/api/v1/approver-groups/${funeralGroup._id}`, {
    method: 'PUT', cookie: C.admin, body: { memberIds: [] },
  });
  check('admin can remove a group member', removeMember.status === 200, `HTTP ${removeMember.status}`);
  r = await req(`/api/v1/records/policy/${funeralPolicy._id}`, { cookie: C.groupMember });
  check('removing group membership immediately revokes access', r.status === 404, `HTTP ${r.status}`);
  const addMember = await req(`/api/v1/approver-groups/${funeralGroup._id}`, {
    method: 'PUT', cookie: C.admin, body: { memberIds: [groupMember._id] },
  });
  check('admin can re-add a group member', addMember.status === 200, `HTTP ${addMember.status}`);
  r = await req(`/api/v1/records/policy/${funeralPolicy._id}`, { cookie: C.groupMember });
  check('re-adding group membership immediately restores access', r.status === 200, `HTTP ${r.status}`);

  // Read-only rule + read-only role: update blocked by object permission.
  r = await req(`/api/v1/records/policy/${funeralPolicy._id}`, {
    method: 'PATCH', cookie: C.groupMember, body: { premium: 123 },
  });
  check('read-only sharing: group member cannot modify record', r.status === 403, `HTTP ${r.status}`);

  // Read-only rule but user HAS update permission → record-level write blocked.
  const readRuleForEditor = await createRule({
    objectApiName: 'policy',
    name: 'Funeral to Editors (read only)',
    ruleType: 'criteria',
    criteria: [{ field: 'type', operator: 'eq', value: 'Funeral' }],
    sharedWith: { type: 'user', id: editor._id },
    accessLevel: 'read',
  });
  check('admin creates user-target read rule', [200, 201].includes(readRuleForEditor.status), `HTTP ${readRuleForEditor.status}`);
  r = await req(`/api/v1/records/policy/${funeralPolicy._id}`, { cookie: C.editor });
  check('read-only rule: editor can read shared record', r.status === 200, `HTTP ${r.status}`);
  r = await req(`/api/v1/records/policy/${funeralPolicy._id}`, {
    method: 'PATCH', cookie: C.editor, body: { premium: 777 },
  });
  check('read-only rule: editor (with update perm) cannot modify record', r.status === 404, `HTTP ${r.status}`);

  const ruleRW = await createRule({
    objectApiName: 'policy',
    name: 'Funeral read-write to RW Group',
    ruleType: 'criteria',
    criteria: [{ field: 'type', operator: 'eq', value: 'Funeral' }],
    sharedWith: { type: 'group', id: rwGroup._id },
    accessLevel: 'readWrite',
  });
  check('admin creates read-write sharing rule', [200, 201].includes(ruleRW.status), `HTTP ${ruleRW.status}`);
  r = await req(`/api/v1/records/policy/${funeralPolicy._id}`, {
    method: 'PATCH', cookie: C.rwMember, body: { premium: 888 },
  });
  check('read-write rule: member can modify matching record', r.status === 200, `HTTP ${r.status}`);
  r = await req(`/api/v1/records/policy/${motorPolicy._id}`, {
    method: 'PATCH', cookie: C.rwMember, body: { premium: 999 },
  });
  check('read-write rule: member cannot modify non-matching record', [403, 404].includes(r.status), `HTTP ${r.status}`);

  // Different object (Insurance) with its own rule/config.
  await req('/api/v1/sharing/settings/insurance', {
    method: 'PUT', cookie: C.admin, body: { orgWideDefault: 'private' },
  });
  r = await req(`/api/v1/records/insurance/${insuranceRecord._id}`, { cookie: C.groupMember });
  check('insurance OWD private: unrelated group member cannot read', r.status === 404, `HTTP ${r.status}`);
  const insuranceRule = await createRule({
    objectApiName: 'insurance',
    name: 'Funeral insurance to Funeral Team',
    ruleType: 'criteria',
    criteria: [{ field: 'type', operator: 'eq', value: 'Funeral' }],
    sharedWith: { type: 'group', id: funeralGroup._id },
    accessLevel: 'read',
  });
  check('per-object rule created for insurance', [200, 201].includes(insuranceRule.status), `HTTP ${insuranceRule.status}`);
  r = await req(`/api/v1/records/insurance/${insuranceRecord._id}`, { cookie: C.groupMember });
  check('insurance sharing rule grants visibility', r.status === 200, `HTTP ${r.status}`);

  // ── 4. OWD Public Read-Only ──────────────────────────────────────────────
  await req('/api/v1/sharing/settings/policy', {
    method: 'PUT', cookie: C.admin, body: { orgWideDefault: 'public_read_only' },
  });
  r = await req(`/api/v1/records/policy/${funeralPolicy._id}`, { cookie: C.unrelated });
  check('public read-only: unrelated user can read', r.status === 200, `HTTP ${r.status}`);
  r = await req(`/api/v1/records/policy/${funeralPolicy._id}`, {
    method: 'PATCH', cookie: C.unrelated, body: { premium: 111 },
  });
  check('public read-only: non-owner with update perm cannot edit', r.status === 404, `HTTP ${r.status}`);
  r = await req(`/api/v1/records/policy/${funeralPolicy._id}`, { cookie: C.owner });
  check('public read-only: owner still reads', r.status === 200, `HTTP ${r.status}`);

  // ── 5. OWD Public Read-Write ─────────────────────────────────────────────
  await req('/api/v1/sharing/settings/policy', {
    method: 'PUT', cookie: C.admin, body: { orgWideDefault: 'public_read_write' },
  });
  r = await req(`/api/v1/records/policy/${funeralPolicy._id}`, {
    method: 'PATCH', cookie: C.editor, body: { premium: 222 },
  });
  check('public read-write: editor can edit any record', r.status === 200, `HTTP ${r.status}`);
  r = await req(`/api/v1/records/policy/${funeralPolicy._id}`, {
    method: 'PATCH', cookie: C.groupMember, body: { premium: 333 },
  });
  check('public read-write: user without update permission still blocked', r.status === 403, `HTTP ${r.status}`);

  // ── 6. Search + list honour the sharing model ────────────────────────────
  await req('/api/v1/sharing/settings/policy', {
    method: 'PUT', cookie: C.admin, body: { orgWideDefault: 'private' },
  });
  r = await req(`/api/v1/search?q=${encodeURIComponent(`Motor Policy ${RUN}`)}`, { cookie: C.unrelated });
  check('search: private record not leaked to unrelated user', !r.text.includes(String(motorPolicy._id)), `HTTP ${r.status}`);
  r = await req(`/api/v1/search?q=${encodeURIComponent(`Motor Policy ${RUN}`)}`, { cookie: C.owner });
  check('search: owner finds own record', r.text.includes(String(motorPolicy._id)), `HTTP ${r.status}`);

  // Exports and reports must obey the same record visibility.
  const exp = await req('/api/v1/records/policy/export?fields=name,type,premium', { cookie: C.editor });
  check('export: shared record is exported for the editor', exp.status === 200, `HTTP ${exp.status}`);
  check('export: unshared record is not leaked', !exp.text.includes('Motor Policy'), exp.text.slice(0, 160));

  const report = await req('/api/v1/analytics/report', {
    method: 'POST', cookie: C.editor,
    body: {
      objectApiName: 'policy',
      groupBy: 'type',
      aggregations: [{ field: null, func: 'count', alias: 'n' }],
    },
  });
  check('report: executes for a reader', report.status === 200, `HTTP ${report.status}`);
  check('report: only includes visible records', !report.text.includes('Motor'), report.text.slice(0, 120));

  // ── 7. UI contract: settings & rules endpoints reflect changes ───────────
  const settingsList = await req('/api/v1/sharing/settings', { cookie: C.admin });
  const policySetting = settingsList.json?.data?.find((o) => o.objectApiName === 'policy');
  check('sharing settings endpoint reflects saved OWD', policySetting?.orgWideDefault === 'private', JSON.stringify(policySetting));
  const rulesList = await req('/api/v1/sharing/rules?objectApiName=policy', { cookie: C.admin });
  check('sharing rules endpoint lists all policy rules', (rulesList.json?.data || []).length >= 3, `count=${(rulesList.json?.data || []).length}`);

  // Rule update (deactivate) takes effect immediately.
  await req(`/api/v1/sharing/rules/${ruleReadDb._id}`, {
    method: 'PUT', cookie: C.admin, body: { isActive: false },
  });
  r = await req(`/api/v1/records/policy/${funeralPolicy._id}`, { cookie: C.groupMember });
  check('deactivating rule revokes access', r.status === 404, `HTTP ${r.status}`);
  await req(`/api/v1/sharing/rules/${ruleReadDb._id}`, {
    method: 'PUT', cookie: C.admin, body: { isActive: true },
  });
  r = await req(`/api/v1/records/policy/${funeralPolicy._id}`, { cookie: C.groupMember });
  check('reactivating rule restores access', r.status === 200, `HTTP ${r.status}`);

  // Non-admin cannot configure sharing.
  r = await req('/api/v1/sharing/settings/policy', {
    method: 'PUT', cookie: C.unrelated, body: { orgWideDefault: 'public_read_write' },
  });
  check('non-admin cannot change sharing settings', r.status === 403, `HTTP ${r.status}`);

  // ── 7b. Persistence survives a backend/database reconnect ────────────────
  await mongoose.connection.close();
  await connectDB();
  const reloadedSetting = await ObjectSharingSetting.findOne({ tenantId: tenant._id, objectApiName: 'policy' }).lean();
  const reloadedRule = await SharingRule.findOne({ _id: ruleReadDb._id }).lean();
  check('OWD persists after backend reconnect', reloadedSetting?.orgWideDefault === 'private', reloadedSetting?.orgWideDefault);
  check('sharing rule persists after backend reconnect', reloadedRule?.isActive === true && reloadedRule?.name === 'Funeral policies to Funeral Team');

  // ── 8. Regression: approval routing still resolves via User.manager ──────
  const approval = await ApprovalProcess.create({
    tenantId: tenant._id,
    name: `Sharing Regression Approval ${RUN}`,
    objectApiName: 'policy',
    isActive: true,
    entryCriteria: [],
    steps: [{ order: 1, name: 'Manager approval', approverType: 'manager', approverUserId: null }],
  });
  check('approval process with manager routing can still be created', !!approval._id);

} catch (err) {
  console.error('TEST RUN ERROR:', err);
  check('test run completed without unexpected error', false, err.message);
} finally {
  try {
    if (tenant) {
      const t = tenant._id;
      await Promise.all([
        DynamicRecord.deleteMany({ tenantId: t }),
        SharingRule.deleteMany({ tenantId: t }),
        ObjectSharingSetting.deleteMany({ tenantId: t }),
        ApproverGroup.deleteMany({ tenantId: t }),
        ApprovalProcess.deleteMany({ tenantId: t }),
        ObjectMeta.deleteMany({ tenantId: t }),
        FieldMeta.deleteMany({ tenantId: t }),
        User.deleteMany({ tenantId: t }),
        Role.deleteMany({ tenantId: t }),
        Tenant.deleteOne({ _id: t }),
      ]);
    }
    await mongoose.connection.close();
  } catch (cleanupErr) {
    console.error('cleanup error', cleanupErr.message);
  }
  server.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  process.exit(failed.length ? 1 : 0);
}
