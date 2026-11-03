/**
 * change-set.e2e.mjs - metadata deployment & change sets (Core BRD 13).
 *
 * Boots the real Express app, seeds two tenants (source sandbox + target
 * production) and exercises package export, dependency validation (missing
 * objects/fields block deployment, 13.2), cross-tenant deployment, the
 * deployment log (13), role/user remapping, superuser-only RBAC and tenant
 * isolation.
 *
 * Run: node tests/change-set.e2e.mjs   (from backend/)
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
import Layout from '../models/Layout.js';
import Automation from '../models/Automation.js';
import ApprovalProcess from '../models/ApprovalProcess.js';
import DuplicateRule from '../models/DuplicateRule.js';
import TenantConfiguration from '../models/TenantConfiguration.js';
import ChangeSet from '../models/ChangeSet.js';
import DeploymentLog from '../models/DeploymentLog.js';
import DynamicRecord from '../models/DynamicRecord.js';
import { seedDefaultRoles } from '../services/roleService.js';

const RUN = Date.now().toString(36);
const PASSWORD = 'ChangeSet123!';

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

let sandboxId = null;
let prodId = null;
let cloneId = null;

try {
  await connectDB();

  // Two tenants: A = source sandbox, B = target production.
  const sandbox = await Tenant.create({
    name: `ZZ_SRC_${RUN}`, slug: `zz-src-${RUN}`, status: 'active', plan: 'enterprise',
  });
  sandboxId = sandbox._id;
  await seedDefaultRoles(sandboxId);
  const roleStdA = await Role.findOne({ tenantId: sandboxId, name: 'standard_user' });
  const roleAdminA = await Role.findOne({ tenantId: sandboxId, name: 'admin' });
  const roleSuperA = await Role.findOne({ tenantId: sandboxId, name: 'superuser' });

  const makeUser = async (tenantId, roleId, first, last, tag) =>
    User.create({
      tenantId, firstName: first, lastName: last,
      email: `${tag}-${RUN}@example.com`, username: `${tag}_${RUN}`,
      password: PASSWORD, role: roleId, status: 'active', emailVerified: true,
    });

  const adminA = await makeUser(sandboxId, roleAdminA._id, 'Admin', 'One', 'csadmin1');
  const superA = await makeUser(sandboxId, roleSuperA._id, 'Super', 'One', 'cssuper1');
  const approverA = await makeUser(sandboxId, roleStdA._id, 'Claim', 'Approver', 'csapprover');
  const cookieAdminA = await loginCookie(adminA.email);
  const cookieSuperA = await loginCookie(superA.email);
  check('sandbox users can log in', Boolean(cookieAdminA && cookieSuperA));

  // Source metadata: two objects, fields, layouts, a flow, an approval
  // process, a duplicate rule and a tenant configuration override.
  const objClaim = await ObjectMeta.create({
    tenantId: sandboxId, name: 'Claim', label: 'Claim', pluralLabel: 'Claims',
    apiName: 'claim', nameFieldApiName: 'name', isActive: true, searchable: true,
  });
  const objContact = await ObjectMeta.create({
    tenantId: sandboxId, name: 'Contact', label: 'Contact', pluralLabel: 'Contacts',
    apiName: 'contact', nameFieldApiName: 'name', isActive: true, searchable: true,
  });
  await FieldMeta.create({
    tenantId: sandboxId, objectId: objClaim._id, objectApiName: 'claim',
    name: 'Claim Number', label: 'Claim Number', apiName: 'claim_number', type: 'text',
  });
  await FieldMeta.create({
    tenantId: sandboxId, objectId: objClaim._id, objectApiName: 'claim',
    name: 'Claim Amount', label: 'Claim Amount', apiName: 'claim_amount', type: 'currency',
  });
  await FieldMeta.create({
    tenantId: sandboxId, objectId: objClaim._id, objectApiName: 'claim',
    name: 'Legacy Field', label: 'Legacy', apiName: 'legacy_field', type: 'text',
  });

  // Broken layout: references an unpackaged field and a related object that is
  // not in the package - must be blocked as missing dependencies.
  await Layout.create({
    tenantId: sandboxId, objectId: objClaim._id, objectApiName: 'claim',
    name: 'Claim Broken', type: 'detail',
    sections: [{ id: 's1', label: 'Details', columns: 1, columnData: [{ fields: [{ fieldApiName: 'legacy_field' }] }] }],
    relatedLists: [{ objectApiName: 'contact', relationshipField: 'contact_id', label: 'Contact' }],
  });
  // Clean layout: only packaged fields.
  await Layout.create({
    tenantId: sandboxId, objectId: objClaim._id, objectApiName: 'claim',
    name: 'Claim Detail', type: 'detail',
    sections: [{ id: 's1', label: 'Details', columns: 1, columnData: [{ fields: [{ fieldApiName: 'claim_number' }, { fieldApiName: 'claim_amount' }] }] }],
    assignedRoles: [roleAdminA._id],
  });

  await Automation.create({
    tenantId: sandboxId, apiName: 'claim_flow', name: 'Claim Flow',
    trigger: { objectApiName: 'claim', events: ['create'] },
    nodes: [{ id: 'n1', type: 'trigger', label: 'On claim created' }],
    stats: { runCount: 42 },
  });
  await ApprovalProcess.create({
    tenantId: sandboxId, objectApiName: 'claim', name: 'Claim Approval',
    description: 'Two-step claim approval',
    steps: [
      { order: 1, name: 'Queue review', approverType: 'queue', approverRoleId: roleStdA._id, dueHours: 48 },
      { order: 2, name: 'Named review', approverType: 'user', approverUserId: approverA._id, dueHours: 48 },
    ],
  });
  await DuplicateRule.create({
    tenantId: sandboxId, objectApiName: 'claim', name: 'Claim Number Match',
    conditions: [{ field: 'claim_number', matchType: 'exact' }], onMatch: 'block',
  });
  await TenantConfiguration.create({
    tenantId: sandboxId, key: 'approvals.threshold_amount', value: 5000,
    dataType: 'number', category: 'Approvals',
  });

  // Target production tenant.
  const prod = await Tenant.create({
    name: `ZZ_TGT_${RUN}`, slug: `zz-tgt-${RUN}`, status: 'active', plan: 'enterprise',
  });
  prodId = prod._id;
  await seedDefaultRoles(prodId);
  const roleStdB = await Role.findOne({ tenantId: prodId, name: 'standard_user' });
  const roleAdminB = await Role.findOne({ tenantId: prodId, name: 'admin' });
  const adminB = await makeUser(prodId, roleAdminB._id, 'Admin', 'Two', 'csadmin2');
  const cookieAdminB = await loginCookie(adminB.email);

  const manifestIncomplete = [
    { componentType: 'object', componentKey: 'claim' },
    { componentType: 'field', componentKey: 'claim.claim_number' },
    { componentType: 'field', componentKey: 'claim.claim_amount' },
    { componentType: 'layout', componentKey: 'claim:Claim Broken' },
  ];
  const manifestFull = [
    { componentType: 'object', componentKey: 'claim' },
    { componentType: 'object', componentKey: 'contact' },
    { componentType: 'field', componentKey: 'claim.claim_number' },
    { componentType: 'field', componentKey: 'claim.claim_amount' },
    { componentType: 'layout', componentKey: 'claim:Claim Detail' },
    { componentType: 'flow', componentKey: 'claim_flow' },
    { componentType: 'approval_process', componentKey: 'claim:Claim Approval' },
    { componentType: 'duplicate_rule', componentKey: 'claim:Claim Number Match' },
    { componentType: 'tenant_config', componentKey: 'approvals.threshold_amount' },
  ];

  const createPkg = (name, components) =>
    req('/api/v1/change-sets', { method: 'POST', cookie: cookieAdminA, body: { name, components } });

  // Export.
  const pkg1 = await createPkg('Incomplete Pack', manifestIncomplete);
  check('a package can be exported from the sandbox', pkg1.status === 201 && pkg1.json?.data?.components?.length === 4, `components=${pkg1.json?.data?.components?.length}`);

  const pkg2 = await createPkg('Full Pack', manifestFull);
  check('a package can carry every metadata type', pkg2.status === 201 && pkg2.json?.data?.components?.length === 9, `components=${pkg2.json?.data?.components?.length}`);
  const pkg2Id = pkg2.json?.data?._id;

  const badType = await createPkg('Bad Type', [{ componentType: 'wallpaper', componentKey: 'x' }]);
  check('an unknown component type is rejected', badType.status === 400, `HTTP ${badType.status}`);
  const missingComp = await createPkg('Missing Comp', [{ componentType: 'field', componentKey: 'claim.no_such_field' }]);
  check('a missing source component is reported', missingComp.status === 404, `HTTP ${missingComp.status}`);

  const listed = await req('/api/v1/change-sets', { cookie: cookieAdminA });
  check('the sandbox lists its own packages', listed.status === 200 && listed.json?.data?.length === 2, `count=${listed.json?.data?.length}`);

  // RBAC: cross-tenant promotion is superuser-only.
  const adminValidate = await req(`/api/v1/change-sets/${pkg2Id}/validate`, { method: 'POST', cookie: cookieAdminA, body: { targetTenantId: String(prodId) } });
  check('an admin cannot validate against another tenant', adminValidate.status === 403, `HTTP ${adminValidate.status}`);
  const adminDeploy = await req(`/api/v1/change-sets/${pkg2Id}/deploy`, { method: 'POST', cookie: cookieAdminA, body: { targetTenantId: String(prodId) } });
  check('an admin cannot deploy into another tenant', adminDeploy.status === 403, `HTTP ${adminDeploy.status}`);

  // Dependency validation (13.2).
  const validate1 = await req(`/api/v1/change-sets/${pkg1.json?.data?._id}/validate`, { method: 'POST', cookie: cookieSuperA, body: { targetTenantId: String(prodId) } });
  const missingKeys = (validate1.json?.data?.missing || []).map((m) => m.key);
  check('validation reports a missing related object', validate1.status === 200 && validate1.json?.data?.valid === false && missingKeys.includes('contact'), `missing=${missingKeys.join(',')}`);
  check('validation reports a missing required field', missingKeys.includes('claim.legacy_field'), `missing=${missingKeys.join(',')}`);

  const deploy1 = await req(`/api/v1/change-sets/${pkg1.json?.data?._id}/deploy`, { method: 'POST', cookie: cookieSuperA, body: { targetTenantId: String(prodId) } });
  check('deployment is blocked when dependencies are missing', deploy1.status === 409, `HTTP ${deploy1.status}`);
  const blockedLog = await DeploymentLog.findOne({ tenantId: prodId, status: 'blocked' });
  check('a blocked deployment is written to the log', Boolean(blockedLog), `status=${blockedLog?.status}`);

  const pkg1Doc = await ChangeSet.findOne({ _id: pkg1.json?.data?._id });
  check('a blocked package is marked failed', pkg1Doc?.status === 'failed', `status=${pkg1Doc?.status}`);

  // Deployment.
  const validate2 = await req(`/api/v1/change-sets/${pkg2Id}/validate`, { method: 'POST', cookie: cookieSuperA, body: { targetTenantId: String(prodId) } });
  check('a complete package validates against the target', validate2.status === 200 && validate2.json?.data?.valid === true, `valid=${validate2.json?.data?.valid}`);
  const pkg2Doc = await ChangeSet.findOne({ _id: pkg2Id });
  check('a validated package is marked validated', pkg2Doc?.status === 'validated', `status=${pkg2Doc?.status}`);

  const selfDeploy = await req(`/api/v1/change-sets/${pkg2Id}/deploy`, { method: 'POST', cookie: cookieSuperA, body: { targetTenantId: String(sandboxId) } });
  check('deploying into the source tenant is rejected', selfDeploy.status === 400, `HTTP ${selfDeploy.status}`);

  const deploy2 = await req(`/api/v1/change-sets/${pkg2Id}/deploy`, { method: 'POST', cookie: cookieSuperA, body: { targetTenantId: String(prodId) } });
  check('a complete package deploys into the target tenant', deploy2.status === 201, `HTTP ${deploy2.status}`);

  // Resulting target metadata.
  const prodClaim = await ObjectMeta.findOne({ tenantId: prodId, apiName: 'claim' });
  const prodContact = await ObjectMeta.findOne({ tenantId: prodId, apiName: 'contact' });
  check('the target receives the packaged objects', Boolean(prodClaim && prodContact), `claim=${Boolean(prodClaim)} contact=${Boolean(prodContact)}`);

  const prodFields = await FieldMeta.find({ tenantId: prodId, objectApiName: 'claim' }).select('apiName').lean();
  const fieldNames = prodFields.map((f) => f.apiName).sort();
  check('the target receives the packaged fields', fieldNames.includes('claim_number') && fieldNames.includes('claim_amount'), `fields=${fieldNames.join(',')}`);
  check('the target does not receive the unpackaged field', !fieldNames.includes('legacy_field'), `fields=${fieldNames.join(',')}`);

  const prodLayout = await Layout.findOne({ tenantId: prodId, objectApiName: 'claim', name: 'Claim Detail' });
  check('the target layout points at the target object', Boolean(prodLayout) && String(prodLayout.objectId) === String(prodClaim?._id), `matches=${String(prodLayout?.objectId) === String(prodClaim?._id)}`);
  const assignedOk = (prodLayout?.assignedRoles || []).map(String).includes(String(roleAdminB._id));
  check('layout roles are remapped by name to the target tenant', assignedOk, `roles=${(prodLayout?.assignedRoles || []).join(',')}`);

  const prodFlow = await Automation.findOne({ tenantId: prodId, apiName: 'claim_flow' });
  check('the target receives the flow without sandbox counters', Boolean(prodFlow) && !prodFlow.stats?.runCount, `runCount=${prodFlow?.stats?.runCount}`);

  const prodApproval = await ApprovalProcess.findOne({ tenantId: prodId, name: 'Claim Approval' });
  const queueStep = prodApproval?.steps?.find((s) => s.approverType === 'queue');
  const userStep = prodApproval?.steps?.find((s) => s.approverType === 'user');
  check('approval queue approvers are remapped to target roles', String(queueStep?.approverRoleId) === String(roleStdB._id), `roleId=${queueStep?.approverRoleId}`);
  check('approval named approvers are not carried across tenants', !userStep?.approverUserId, `approverUserId=${userStep?.approverUserId}`);

  const prodRule = await DuplicateRule.findOne({ tenantId: prodId, name: 'Claim Number Match' });
  check('the target receives the duplicate rule', Boolean(prodRule), `found=${Boolean(prodRule)}`);

  const prodConfig = await TenantConfiguration.findOne({ tenantId: prodId, key: 'approvals.threshold_amount' });
  check('tenant configuration is copied as a target override', String(prodConfig?.value) === '5000', `value=${prodConfig?.value}`);

  const deployWarnings = deploy2.json?.data?.warnings || [];
  check('unresolvable named approvers are reported as warnings', deployWarnings.some((w) => w.includes('Claim Approval')), `warnings=${deployWarnings.length}`);

  // Deployment log.
  const logRes = await req(`/api/v1/change-sets/deployment-log?targetTenantId=${prodId}`, { cookie: cookieSuperA });
  const logData = logRes.json?.data || [];
  const deployedLog = logData.find((l) => l.status === 'deployed');
  check('the deployment log records the successful deployment', logRes.status === 200 && Boolean(deployedLog) && deployedLog.componentCount === 9, `entries=${logData.length} count=${deployedLog?.componentCount}`);
  check('the deployment log records who deployed', String(deployedLog?.by?._id || deployedLog?.by) === String(superA._id), `by=${deployedLog?.by}`);

  // RBAC: log is operator-only.
  const adminLog = await req(`/api/v1/change-sets/deployment-log?targetTenantId=${prodId}`, { cookie: cookieAdminA });
  check('an admin cannot read another tenant deployment log', adminLog.status === 403, `HTTP ${adminLog.status}`);

  // Rollback (13): undo a deployment by restoring pre-deployment state.
  const rollbackRes = await req(
    `/api/v1/change-sets/deployment-log/${deployedLog._id}/rollback`,
    { method: 'POST', cookie: cookieSuperA },
  );
  check('a deployed change set can be rolled back', rollbackRes.status === 200, `HTTP ${rollbackRes.status}`);
  check('rollback removes objects created by the deployment', !(await ObjectMeta.findOne({ tenantId: prodId, apiName: 'claim' })));
  check('rollback removes the deployed flow', !(await Automation.findOne({ tenantId: prodId, apiName: 'claim_flow' })));
  check('rollback removes the deployed tenant-config override', !(await TenantConfiguration.findOne({ tenantId: prodId, key: 'approvals.threshold_amount' })));

  const rolledLog = await DeploymentLog.findById(deployedLog._id);
  check('the deployment log is marked rolled back', rolledLog?.status === 'rolled_back', `status=${rolledLog?.status}`);

  const rollbackAgain = await req(
    `/api/v1/change-sets/deployment-log/${deployedLog._id}/rollback`,
    { method: 'POST', cookie: cookieSuperA },
  );
  check('a deployment cannot be rolled back twice', rollbackAgain.status === 409, `HTTP ${rollbackAgain.status}`);

  // Rollback restores a pre-existing component instead of deleting it.
  await ObjectMeta.create({
    tenantId: prodId, name: 'Claim', label: 'PRE-EXISTING', pluralLabel: 'Claims',
    apiName: 'claim', nameFieldApiName: 'name', isActive: true,
  });
  await req(`/api/v1/change-sets/${pkg2Id}/deploy`, { method: 'POST', cookie: cookieSuperA, body: { targetTenantId: String(prodId) } });
  const restoreLog = await DeploymentLog.findOne({ tenantId: prodId, status: 'deployed' }).sort({ at: -1 });
  await req(`/api/v1/change-sets/deployment-log/${restoreLog._id}/rollback`, { method: 'POST', cookie: cookieSuperA });
  const restored = await ObjectMeta.findOne({ tenantId: prodId, apiName: 'claim' });
  check('rollback restores a pre-existing component instead of deleting it', restored?.label === 'PRE-EXISTING', `label=${restored?.label}`);
  check('rollback still removes components that did not pre-exist', !(await Automation.findOne({ tenantId: prodId, apiName: 'claim_flow' })));

  // Sandbox cloning (13): clone configuration into an isolated tenant, no data.
  await DynamicRecord.create({
    tenantId: sandboxId, objectId: objClaim._id, objectApiName: 'claim',
    data: { name: 'CLAIM-1' },
  });
  const cloneRes = await req('/api/v1/change-sets/sandbox', {
    method: 'POST', cookie: cookieSuperA,
    body: { sourceTenantId: String(sandboxId), name: `ZZ_CLONE_${RUN}` },
  });
  cloneId = cloneRes.json?.data?.tenant?._id;
  check('a sandbox tenant can be cloned from a source tenant', cloneRes.status === 201 && Boolean(cloneId), `HTTP ${cloneRes.status}`);
  check('the clone is marked as a sandbox of its source', cloneRes.json?.data?.tenant?.isSandbox === true && String(cloneRes.json?.data?.tenant?.clonedFromTenantId) === String(sandboxId), `from=${cloneRes.json?.data?.tenant?.clonedFromTenantId}`);

  const cloneObj = await ObjectMeta.findOne({ tenantId: cloneId, apiName: 'claim' });
  const cloneFields = await FieldMeta.find({ tenantId: cloneId, objectApiName: 'claim' }).select('apiName').lean();
  const cloneConfig = await TenantConfiguration.findOne({ tenantId: cloneId, key: 'approvals.threshold_amount' });
  check('the clone receives the source objects and fields', Boolean(cloneObj) && cloneFields.length === 3, `fields=${cloneFields.length}`);
  check('the clone receives tenant-config overrides', String(cloneConfig?.value) === '5000', `value=${cloneConfig?.value}`);

  const cloneLayout = await Layout.findOne({ tenantId: cloneId, objectApiName: 'claim', name: 'Claim Detail' });
  const cloneAdminRole = await Role.findOne({ tenantId: cloneId, name: 'admin' });
  check('clone role references resolve to the clone tenant', (cloneLayout?.assignedRoles || []).map(String).includes(String(cloneAdminRole?._id)), `roles=${(cloneLayout?.assignedRoles || []).join(',')}`);

  const cloneRecords = await DynamicRecord.countDocuments({ tenantId: cloneId });
  check('the clone receives no business data', cloneRecords === 0, `records=${cloneRecords}`);

  // RBAC: sandbox cloning is operator-level.
  const adminClone = await req('/api/v1/change-sets/sandbox', {
    method: 'POST', cookie: cookieAdminA,
    body: { sourceTenantId: String(sandboxId), name: `ZZ_NOPE_${RUN}` },
  });
  check('an admin cannot clone a tenant', adminClone.status === 403, `HTTP ${adminClone.status}`);

  // Tenant isolation.
  const prodPackages = await req('/api/v1/change-sets', { cookie: cookieAdminB });
  check('packages are scoped to the tenant that exported them', prodPackages.status === 200 && prodPackages.json?.data?.length === 0, `count=${prodPackages.json?.data?.length}`);
} catch (err) {
  check('test harness ran without error', false, err.message);
} finally {
  const ids = [sandboxId, prodId, cloneId].filter(Boolean);
  if (ids.length) {
    await Tenant.deleteMany({ _id: { $in: ids } });
    const cleanup = [
      User, Role, Session, ObjectMeta, FieldMeta, Layout, Automation,
      ApprovalProcess, DuplicateRule, TenantConfiguration, ChangeSet, DeploymentLog,
      DynamicRecord,
    ];
    await Promise.all(cleanup.map((M) => M.deleteMany({ tenantId: { $in: ids } }).catch(() => {})));
  }
  server.close();
  await mongoose.connection.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
