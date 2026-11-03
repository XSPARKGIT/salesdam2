/**
 * approver-group-changeset.e2e.mjs — approver groups (Core BRD §8) travel with
 * change sets and sandbox clones, so an approval process whose steps name a
 * group still works in the target tenant.
 *
 * Verifies, through the real API: a group exports with member emails and role
 * names (no tenant ids); validation reports a missing group; deployment remaps
 * members, roles and the process's group step to the target tenant's own ids;
 * and a sandbox clone carries both.
 *
 * Run: node tests/approver-group-changeset.e2e.mjs   (from backend/)
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
import ApprovalProcess from '../models/ApprovalProcess.js';
import ApproverGroup from '../models/ApproverGroup.js';
import ChangeSet from '../models/ChangeSet.js';
import DeploymentLog from '../models/DeploymentLog.js';
import AuditLog from '../models/AuditLog.js';
import { seedDefaultRoles } from '../services/roleService.js';

const RUN = Date.now().toString(36);
const PASSWORD = 'GroupCs123!';
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
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: PASSWORD }),
  });
  return (res.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).find((c) => c.startsWith('crm.sid=')) || '';
};

let srcId = null; let dstId = null; let cloneId = null;

try {
  await connectDB();
  const src = await Tenant.create({ name: `ZZ_AGCS_SRC_${RUN}`, slug: `zz-agcs-src-${RUN}`, status: 'active', plan: 'enterprise' });
  const dst = await Tenant.create({ name: `ZZ_AGCS_DST_${RUN}`, slug: `zz-agcs-dst-${RUN}`, status: 'active', plan: 'enterprise' });
  srcId = src._id; dstId = dst._id;
  await seedDefaultRoles(srcId);
  await seedDefaultRoles(dstId);

  const mk = (tenantId, role, key, email) => User.create({
    tenantId, firstName: key, lastName: 'U', email, username: `${key}_${RUN}`,
    password: PASSWORD, role: role._id, status: 'active', emailVerified: true,
  });
  const superSrcRole = await Role.findOne({ tenantId: srcId, name: 'superuser' });
  const stdSrc = await Role.findOne({ tenantId: srcId, name: 'standard_user' });
  const stdDst = await Role.findOne({ tenantId: dstId, name: 'standard_user' });
  const superUser = await mk(srcId, superSrcRole, 'agsuper', `agsuper-${RUN}@example.com`);
  const memberSrc = await mk(srcId, stdSrc, 'agmember', `agmember-${RUN}@example.com`);
  const memberDst = await mk(dstId, stdDst, 'agmember', `agmember-${RUN}@example.com`); // same email in the target
  const cookie = await loginCookie(superUser.email);
  check('source superuser can log in', Boolean(cookie));

  const obj = await ObjectMeta.create({ tenantId: srcId, name: 'Claim', label: 'Claim', pluralLabel: 'Claims', apiName: 'claim', nameFieldApiName: 'name', isActive: true });
  await FieldMeta.create({ tenantId: srcId, objectId: obj._id, objectApiName: 'claim', name: 'name', apiName: 'name', label: 'Name', type: 'text' });
  const dstObj = await ObjectMeta.create({ tenantId: dstId, name: 'Claim', label: 'Claim', pluralLabel: 'Claims', apiName: 'claim', nameFieldApiName: 'name', isActive: true });
  await FieldMeta.create({ tenantId: dstId, objectId: dstObj._id, objectApiName: 'claim', name: 'name', apiName: 'name', label: 'Name', type: 'text' });

  const group = await ApproverGroup.create({ tenantId: srcId, name: 'claims_panel', label: 'Claims Panel', memberIds: [memberSrc._id], roleIds: [stdSrc._id] });
  await ApprovalProcess.create({
    tenantId: srcId, name: 'Panel review', objectApiName: 'claim', active: true,
    steps: [{ order: 1, name: 'Panel', approverType: 'group', approverGroupId: group._id }],
  });

  // Export
  const pkg = await req('/api/v1/change-sets', {
    method: 'POST', cookie,
    body: { name: `Panel ${RUN}`, components: [{ componentType: 'approver_group', componentKey: 'claims_panel' }, { componentType: 'approval_process', componentKey: 'claim:Panel review' }] },
  });
  const [gSnap, pSnap] = (pkg.json?.data?.components || []).map((c) => c.snapshot);
  check('a group exports with member emails and role names, not ids', pkg.status === 201 && gSnap?.memberEmails?.[0] === memberSrc.email && gSnap?.roleNames?.[0] === 'standard_user' && !JSON.stringify(gSnap).includes(String(group._id)), JSON.stringify(gSnap));
  check("the process exports its group's name, not its id", pSnap?.steps?.[0]?.approverGroupName === 'claims_panel' && !pSnap?.steps?.[0]?.approverGroupId, JSON.stringify(pSnap?.steps?.[0]));

  // Validation: the process alone is blocked, with the group it needs named
  const procOnly = await req('/api/v1/change-sets', { method: 'POST', cookie, body: { name: `Proc only ${RUN}`, components: [{ componentType: 'approval_process', componentKey: 'claim:Panel review' }] } });
  let v = await req(`/api/v1/change-sets/${procOnly.json?.data?._id}/validate`, { method: 'POST', cookie, body: { targetTenantId: String(dstId) } });
  const missing = (v.json?.data?.missing || []).map((m) => `${m.dependency}:${m.key}`);
  check('validation reports an approver group the target lacks', v.json?.data?.valid === false && missing.includes('approver_group:claims_panel'), missing.join(','));

  // Deploy both
  v = await req(`/api/v1/change-sets/${pkg.json?.data?._id}/validate`, { method: 'POST', cookie, body: { targetTenantId: String(dstId) } });
  check('with the group in the package it validates', v.json?.data?.valid === true, JSON.stringify(v.json?.data?.missing));
  const dep = await req(`/api/v1/change-sets/${pkg.json?.data?._id}/deploy`, { method: 'POST', cookie, body: { targetTenantId: String(dstId) } });
  const dGroup = await ApproverGroup.findOne({ tenantId: dstId, name: 'claims_panel' }).lean();
  const dProc = await ApprovalProcess.findOne({ tenantId: dstId, name: 'Panel review' }).lean();
  check('the group deploys with the target tenant\'s own member and role ids', dep.status === 201 && String(dGroup?.memberIds?.[0]) === String(memberDst._id) && String(dGroup?.roleIds?.[0]) === String(stdDst._id), `HTTP ${dep.status} ${dep.json?.message || ''}`);
  check("the process's step points at the target's group", String(dProc?.steps?.[0]?.approverGroupId) === String(dGroup?._id), String(dProc?.steps?.[0]?.approverGroupId));

  // Rollback removes it
  const log = await DeploymentLog.findOne({ tenantId: dstId, status: 'deployed' }).sort({ at: -1 });
  const rb = await req(`/api/v1/change-sets/deployment-log/${log._id}/rollback`, { method: 'POST', cookie });
  check('rollback removes the deployed group and process', rb.status === 200 && !(await ApproverGroup.exists({ tenantId: dstId, name: 'claims_panel' })) && !(await ApprovalProcess.exists({ tenantId: dstId, name: 'Panel review' })), `HTTP ${rb.status}`);

  // Sandbox clone
  const clone = await req('/api/v1/change-sets/sandbox', { method: 'POST', cookie, body: { sourceTenantId: String(srcId), name: `ZZ_AGCS_CLONE_${RUN}` } });
  cloneId = clone.json?.data?.tenant?._id;
  const cGroup = await ApproverGroup.findOne({ tenantId: cloneId, name: 'claims_panel' }).lean();
  const cProc = await ApprovalProcess.findOne({ tenantId: cloneId, name: 'Panel review' }).lean();
  check('a sandbox clone carries the group and a process that points at it', clone.status === 201 && Boolean(cGroup) && String(cProc?.steps?.[0]?.approverGroupId) === String(cGroup?._id), `HTTP ${clone.status}`);
} catch (err) {
  check('test harness ran without error', false, err.stack || err.message);
} finally {
  const ids = [srcId, dstId, cloneId].filter(Boolean);
  if (ids.length) {
    await Tenant.deleteMany({ _id: { $in: ids } });
    await Promise.all([User, Role, Session, ObjectMeta, FieldMeta, ApprovalProcess, ApproverGroup, ChangeSet, DeploymentLog, AuditLog]
      .map((M) => M.deleteMany({ tenantId: { $in: ids } }).catch(() => {})));
  }
  server.close();
  await mongoose.connection.close();
}
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
