/**
 * layout-assignment-changeset.e2e.mjs — layout assignments (BRD 4.2) travel
 * with change sets and sandbox clones (Core BRD 13).
 *
 * Boots the real Express app, seeds a source and a target tenant and verifies:
 *  - a role's layout assignment exports as a `layout_assignment` component
 *    keyed "<object>:<role name>", carrying layout and role names, not ids
 *  - validation reports a missing role, layout or rule field in the target
 *  - deployment recreates the assignment against the target's own role and
 *    layout ids, and the deployed rules resolve layouts in the target
 *  - rollback removes it (or restores the target's previous assignment)
 *  - a sandbox clone carries assignments for the default roles and skips,
 *    with a warning, assignments for custom roles the clone doesn't have
 *
 * Run: node tests/layout-assignment-changeset.e2e.mjs   (from backend/)
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
import LayoutAssignment from '../models/LayoutAssignment.js';
import ChangeSet from '../models/ChangeSet.js';
import DeploymentLog from '../models/DeploymentLog.js';
import AuditLog from '../models/AuditLog.js';
import { seedDefaultRoles } from '../services/roleService.js';
import { resolveLayout } from '../services/layoutResolver.js';

const RUN = Date.now().toString(36);
const PASSWORD = 'LayoutCs123!';

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

let srcId = null;
let dstId = null;
let cloneId = null;

const seedPolicy = async (tenantId, layoutNames) => {
  const obj = await ObjectMeta.create({
    tenantId, name: 'Policy', label: 'Policy', pluralLabel: 'Policies', apiName: 'policy', nameFieldApiName: 'name', isActive: true,
  });
  const pf = { tenantId, objectId: obj._id, objectApiName: 'policy' };
  await FieldMeta.create([
    { ...pf, name: 'name', label: 'Name', apiName: 'name', type: 'text' },
    { ...pf, name: 'type', label: 'Type', apiName: 'type', type: 'picklist',
      picklistValues: ['individual', 'group'].map((v) => ({ label: v, value: v, isActive: true })) },
  ]);
  const layouts = {};
  for (const [i, name] of layoutNames.entries()) {
    layouts[name] = await Layout.create({
      ...pf, name, isDefault: i === 0, type: 'detail',
      sections: [{ id: 's1', label: name, columns: 1, columnData: [{ fields: [{ fieldApiName: 'name' }] }] }],
    });
  }
  return { obj, layouts };
};

try {
  await connectDB();

  const src = await Tenant.create({ name: `ZZ_LACS_SRC_${RUN}`, slug: `zz-lacs-src-${RUN}`, status: 'active', plan: 'enterprise' });
  const dst = await Tenant.create({ name: `ZZ_LACS_DST_${RUN}`, slug: `zz-lacs-dst-${RUN}`, status: 'active', plan: 'enterprise' });
  srcId = src._id;
  dstId = dst._id;
  await seedDefaultRoles(srcId);
  await seedDefaultRoles(dstId);

  const roleSuperSrc = await Role.findOne({ tenantId: srcId, name: 'superuser' });
  const roleStdSrc = await Role.findOne({ tenantId: srcId, name: 'standard_user' });
  const roleBrokerSrc = await Role.create({ tenantId: srcId, name: `broker_${RUN}`, label: 'Broker', dataAccess: 'own' });
  const superSrc = await User.create({
    tenantId: srcId, firstName: 'Cs', lastName: 'Super', email: `lacs-super-${RUN}@example.com`,
    username: `lacs_super_${RUN}`, password: PASSWORD, role: roleSuperSrc._id, status: 'active', emailVerified: true,
  });
  const cookie = await loginCookie(superSrc.email);
  check('source superuser can log in', Boolean(cookie));

  const { layouts: srcL } = await seedPolicy(srcId, ['Standard Policy', 'Rep Policy', 'Group Policy']);
  await LayoutAssignment.create({
    tenantId: srcId, objectApiName: 'policy', roleId: roleStdSrc._id,
    defaultLayoutId: srcL['Rep Policy']._id,
    rules: [{ field: 'type', operator: 'eq', value: 'group', layoutId: srcL['Group Policy']._id }],
  });
  await LayoutAssignment.create({
    tenantId: srcId, objectApiName: 'policy', roleId: roleBrokerSrc._id,
    defaultLayoutId: srcL['Group Policy']._id, rules: [],
  });

  // ── Export ───────────────────────────────────────────────────────────────
  const key = 'policy:standard_user';
  const pkg = await req('/api/v1/change-sets', {
    method: 'POST', cookie,
    body: { name: `Layouts ${RUN}`, components: [{ componentType: 'layout_assignment', componentKey: key }] },
  });
  const snap = pkg.json?.data?.components?.[0]?.snapshot;
  check('a layout assignment exports as a change-set component', pkg.status === 201 && Boolean(snap), `HTTP ${pkg.status} ${pkg.json?.message || ''}`);
  check(
    'the export carries role and layout names, not tenant ids',
    snap?.roleName === 'standard_user' && snap?.defaultLayout === 'Rep Policy' && snap?.rules?.[0]?.layout === 'Group Policy' && !JSON.stringify(snap).includes(String(srcL['Group Policy']._id)),
    JSON.stringify(snap),
  );
  const pkgId = pkg.json?.data?._id;

  // ── Validation against a target missing the object, then the layouts ─────
  let v = await req(`/api/v1/change-sets/${pkgId}/validate`, { method: 'POST', cookie, body: { targetTenantId: String(dstId) } });
  let missing = (v.json?.data?.missing || []).map((m) => `${m.dependency}:${m.key}`);
  check('validation reports the missing object', v.json?.data?.valid === false && missing.includes('object:policy'), missing.join(','));

  const dstObj = await ObjectMeta.create({
    tenantId: dstId, name: 'Policy', label: 'Policy', pluralLabel: 'Policies', apiName: 'policy', nameFieldApiName: 'name', isActive: true,
  });
  await FieldMeta.create({ tenantId: dstId, objectId: dstObj._id, objectApiName: 'policy', name: 'name', label: 'Name', apiName: 'name', type: 'text' });
  v = await req(`/api/v1/change-sets/${pkgId}/validate`, { method: 'POST', cookie, body: { targetTenantId: String(dstId) } });
  missing = (v.json?.data?.missing || []).map((m) => `${m.dependency}:${m.key}`);
  check(
    'validation reports missing layouts and rule fields',
    v.json?.data?.valid === false && missing.includes('layout:policy:Rep Policy') && missing.includes('layout:policy:Group Policy') && missing.includes('field:policy.type'),
    missing.join(','),
  );
  const blocked = await req(`/api/v1/change-sets/${pkgId}/deploy`, { method: 'POST', cookie, body: { targetTenantId: String(dstId) } });
  check('deployment is blocked while dependencies are missing', blocked.status === 409, `HTTP ${blocked.status}`);

  // A package that brings its own layouts and field validates.
  const full = await req('/api/v1/change-sets', {
    method: 'POST', cookie,
    body: {
      name: `Layouts full ${RUN}`,
      components: [
        { componentType: 'field', componentKey: 'policy.type' },
        { componentType: 'layout', componentKey: 'policy:Standard Policy' },
        { componentType: 'layout', componentKey: 'policy:Rep Policy' },
        { componentType: 'layout', componentKey: 'policy:Group Policy' },
        { componentType: 'layout_assignment', componentKey: key },
      ],
    },
  });
  const fullId = full.json?.data?._id;
  v = await req(`/api/v1/change-sets/${fullId}/validate`, { method: 'POST', cookie, body: { targetTenantId: String(dstId) } });
  check('a package with its layouts and fields validates', v.json?.data?.valid === true, JSON.stringify(v.json?.data?.missing || []));

  // Custom role missing in the target is reported.
  const brokerPkg = await req('/api/v1/change-sets', {
    method: 'POST', cookie,
    body: { name: `Broker ${RUN}`, components: [{ componentType: 'layout_assignment', componentKey: `policy:broker_${RUN}` }] },
  });
  v = await req(`/api/v1/change-sets/${brokerPkg.json?.data?._id}/validate`, { method: 'POST', cookie, body: { targetTenantId: String(dstId) } });
  missing = (v.json?.data?.missing || []).map((m) => `${m.dependency}:${m.key}`);
  check('validation reports a role the target does not have', missing.includes(`role:broker_${RUN}`), missing.join(','));

  // ── Deploy ───────────────────────────────────────────────────────────────
  const dep = await req(`/api/v1/change-sets/${fullId}/deploy`, { method: 'POST', cookie, body: { targetTenantId: String(dstId) } });
  check('the package deploys', dep.status === 201, `HTTP ${dep.status} ${dep.json?.message || ''}`);

  const roleStdDst = await Role.findOne({ tenantId: dstId, name: 'standard_user' });
  const dstLayouts = await Layout.find({ tenantId: dstId, objectApiName: 'policy' }).lean();
  const dstId_ = Object.fromEntries(dstLayouts.map((l) => [l.name, String(l._id)]));
  const deployed = await LayoutAssignment.findOne({ tenantId: dstId, objectApiName: 'policy', roleId: roleStdDst._id }).lean();
  check(
    'the deployed assignment points at the target tenant\'s own role and layouts',
    Boolean(deployed) && String(deployed.defaultLayoutId) === dstId_['Rep Policy'] && String(deployed.rules?.[0]?.layoutId) === dstId_['Group Policy'],
    JSON.stringify({ def: deployed?.defaultLayoutId, rule: deployed?.rules?.[0]?.layoutId }),
  );

  const dstUser = { role: { _id: roleStdDst._id } };
  const asGroup = await resolveLayout({ tenantId: dstId, objectApiName: 'policy', user: dstUser, record: { data: { type: 'group' } } });
  const asNew = await resolveLayout({ tenantId: dstId, objectApiName: 'policy', user: dstUser });
  check('deployed rules resolve layouts in the target', asGroup.layout?.name === 'Group Policy' && asNew.layout?.name === 'Rep Policy', `${asGroup.layout?.name} / ${asNew.layout?.name}`);

  // ── Rollback ─────────────────────────────────────────────────────────────
  const depLog = await DeploymentLog.findOne({ tenantId: dstId, status: 'deployed' }).sort({ at: -1 });
  const rb = await req(`/api/v1/change-sets/deployment-log/${depLog._id}/rollback`, { method: 'POST', cookie });
  const afterRb = await LayoutAssignment.countDocuments({ tenantId: dstId });
  check('rollback removes the deployed assignment', rb.status === 200 && afterRb === 0, `HTTP ${rb.status} left=${afterRb}`);

  // Rollback restores a pre-existing assignment instead of deleting it.
  const redeploy = await req(`/api/v1/change-sets/${fullId}/deploy`, { method: 'POST', cookie, body: { targetTenantId: String(dstId) } });
  const preLayouts = await Layout.find({ tenantId: dstId, objectApiName: 'policy' }).lean();
  const standardDst = preLayouts.find((l) => l.name === 'Standard Policy');
  await LayoutAssignment.updateOne(
    { tenantId: dstId, objectApiName: 'policy', roleId: roleStdDst._id },
    { $set: { defaultLayoutId: standardDst._id, rules: [] } },
  );
  const again = await req(`/api/v1/change-sets/${fullId}/deploy`, { method: 'POST', cookie, body: { targetTenantId: String(dstId) } });
  const againLog = await DeploymentLog.findOne({ tenantId: dstId, status: 'deployed' }).sort({ at: -1 });
  await req(`/api/v1/change-sets/deployment-log/${againLog._id}/rollback`, { method: 'POST', cookie });
  const restored = await LayoutAssignment.findOne({ tenantId: dstId, objectApiName: 'policy', roleId: roleStdDst._id }).lean();
  check(
    'rollback restores the target\'s previous assignment',
    redeploy.status === 201 && again.status === 201 && String(restored?.defaultLayoutId) === String(standardDst._id) && (restored?.rules || []).length === 0,
    `def=${restored?.defaultLayoutId} rules=${restored?.rules?.length}`,
  );

  // ── Sandbox clone ────────────────────────────────────────────────────────
  const clone = await req('/api/v1/change-sets/sandbox', {
    method: 'POST', cookie, body: { sourceTenantId: String(srcId), name: `ZZ_LACS_CLONE_${RUN}` },
  });
  cloneId = clone.json?.data?.tenant?._id;
  const roleStdClone = await Role.findOne({ tenantId: cloneId, name: 'standard_user' });
  const cloneAssign = await LayoutAssignment.findOne({ tenantId: cloneId, objectApiName: 'policy', roleId: roleStdClone?._id }).lean();
  const cloneLayouts = await Layout.find({ tenantId: cloneId, objectApiName: 'policy' }).lean();
  const cloneIds = Object.fromEntries(cloneLayouts.map((l) => [l.name, String(l._id)]));
  check(
    'a sandbox clone carries layout assignments for the default roles',
    clone.status === 201 && String(cloneAssign?.defaultLayoutId) === cloneIds['Rep Policy'] && String(cloneAssign?.rules?.[0]?.layoutId) === cloneIds['Group Policy'],
    `HTTP ${clone.status}`,
  );
  const warnings = clone.json?.data?.warnings || [];
  check(
    'a custom role the clone lacks is skipped with a warning, not a failure',
    warnings.some((w) => w.includes(`broker_${RUN}`)) && (await LayoutAssignment.countDocuments({ tenantId: cloneId })) === 1,
    warnings.join(' | '),
  );
} catch (err) {
  check('test harness ran without error', false, err.stack || err.message);
} finally {
  const ids = [srcId, dstId, cloneId].filter(Boolean);
  if (ids.length) {
    await Tenant.deleteMany({ _id: { $in: ids } });
    const cleanup = [User, Role, Session, ObjectMeta, FieldMeta, Layout, LayoutAssignment, ChangeSet, DeploymentLog, AuditLog];
    await Promise.all(cleanup.map((M) => M.deleteMany({ tenantId: { $in: ids } }).catch(() => {})));
  }
  server.close();
  await mongoose.connection.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
