/**
 * section13-deployment.e2e.mjs - BRD 13: validation rules, custom code, document
 * templates and integrations in change sets; dependency blocking per type;
 * custom-code versioning, rollback and sandbox cloning without data.
 * Run: node tests/section13-deployment.e2e.mjs   (from backend/)
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
import Automation from '../models/Automation.js';
import ChangeSet from '../models/ChangeSet.js';
import DeploymentLog from '../models/DeploymentLog.js';
import DynamicRecord from '../models/DynamicRecord.js';
import CustomCode from '../models/CustomCode.js';
import PdfTemplate from '../models/PdfTemplate.js';
import ExternalObject from '../models/ExternalObject.js';
import Workspace from '../models/Workspace.js';
import { seedDefaultRoles } from '../services/roleService.js';

const RUN = Date.now().toString(36);
const PASSWORD = 'Section13Pw1!';
const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
let cookie = '';
const req = async (path, { method = 'GET', body, tenant, ck } = {}) => {
  const res = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', Cookie: ck ?? cookie, ...(tenant ? { 'X-Tenant-ID': String(tenant) } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch {}
  return { status: res.status, json };
};
const ids = [];
try {
  await connectDB();
  const mk = async (tag) => { const t = await Tenant.create({ name: `ZZ_S13${tag}_${RUN}`, slug: `zz-s13${tag.toLowerCase()}-${RUN}`, status: 'active', plan: 'enterprise' }); ids.push(t._id); await seedDefaultRoles(t._id); return t; };
  const src = await mk('SRC'); const tgt = await mk('TGT');
  const role = await Role.findOne({ tenantId: src._id, name: 'superuser' });
  const su = await User.create({ tenantId: src._id, firstName: 'S', lastName: 'U', email: `s13-${RUN}@example.com`, username: `s13_${RUN}`, password: PASSWORD, role: role._id, status: 'active', emailVerified: true });
  const lr = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: su.email, password: PASSWORD }) });
  cookie = (lr.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).find((c) => c.startsWith('crm.sid=')) || '';
  check('superuser can log in', Boolean(cookie));

  const obj = await ObjectMeta.create({ tenantId: src._id, name: 'Case', label: 'Case', pluralLabel: 'Cases', apiName: 'case13', nameFieldApiName: 'name', isActive: true,
    validationRules: [{ name: 'Amount positive', expression: 'amount < 0', errorMessage: 'Amount must be positive' }] });
  for (const [apiName, type] of [['amount', 'number'], ['stage', 'text']])
    await FieldMeta.create({ tenantId: src._id, objectId: obj._id, objectApiName: 'case13', name: apiName, label: apiName, apiName, type });
  await DynamicRecord.create({ tenantId: src._id, objectApiName: 'case13', data: { amount: 5 } }).catch(() => {});
  await Workspace.create({ tenantId: src._id, name: 'Cases App', apiName: 'cases13', allowedObjects: ['case13'], memberIds: [su._id] });
  const tpl = await PdfTemplate.create({ tenantId: src._id, name: 'Letter', apiName: 'letter13' });
  const xo = await ExternalObject.create({ tenantId: src._id, name: 'Slack13', baseUrl: 'https://example.com' });
  const cc = await CustomCode.create({ tenantId: src._id, name: 'calc13', apiName: 'calc13', activeVersion: 1, versions: [
    { version: 1, code: 'return 1;', status: 'active' }, { version: 2, code: 'return 2;', status: 'draft' }] });
  await CustomCode.create({ tenantId: src._id, name: 'draftonly13', apiName: 'draftonly13', versions: [{ version: 1, code: 'x', status: 'draft' }] });
  await Automation.create({ tenantId: src._id, apiName: 'flow13', name: 'Flow13', trigger: { objectApiName: 'case13', events: ['create'] }, nodes: [
    { id: 'a', type: 'custom_code', label: 'Calc', config: { name: 'calc13' } },
    { id: 'b', type: 'action_generate_pdf', label: 'Pdf', config: { templateId: tpl._id } },
    { id: 'c', type: 'action_http_request', label: 'Http', config: { externalObjectId: xo._id, url: '/x' } }] });

  const build = async (name, components) => req('/api/v1/change-sets', { method: 'POST', body: { name: `${name}-${RUN}`, components } });
  const deploy = async (cs, target = tgt) => req(`/api/v1/change-sets/${cs.json?.data?._id}/deploy`, { method: 'POST', body: { targetTenantId: String(target._id) } });
  const missingOf = (r) => (r.json?.data?.missing || r.json?.missing || []);

  const sets = {
    rule: await build('rule', [{ componentType: 'validation_rule', componentKey: 'case13:Amount positive' }]),
    flow: await build('flow', [{ componentType: 'flow', componentKey: 'flow13' }]),
    draft: await build('draft', [{ componentType: 'custom_code', componentKey: 'draftonly13' }]),
  };
  check('a validation rule can be packaged on its own', sets.rule.status === 201 || sets.rule.status === 200, `HTTP ${sets.rule.status}`);
  check('custom code and a template can be packaged', (await build('cc', [{ componentType: 'custom_code', componentKey: 'calc13' }, { componentType: 'pdf_template', componentKey: 'letter13' }])).status < 300);
  const csSnap = await ChangeSet.findOne({ tenantId: src._id, name: `flow-${RUN}` }).lean();
  check('package carries template and integration by name, not by id', csSnap?.components?.[0]?.snapshot?.nodes?.some((n) => n.config?.templateApiName === 'letter13') && csSnap.components[0].snapshot.nodes.some((n) => n.config?.externalObjectName === 'Slack13'));

  // 13.2 blocking, each dependency type
  const blockedWhy = async (key) => { const r = await deploy(sets[key]); const log = await DeploymentLog.findOne({ tenantId: tgt._id, changeSetId: sets[key].json.data._id, status: 'blocked' }).lean(); return { r, deps: (log?.missing || []).map((m) => m.dependency) }; };
  let b = await blockedWhy('rule');
  check('rule is blocked when its object is missing (13.2.1)', b.r.status === 409 && b.deps.includes('object'));
  b = await blockedWhy('flow');
  check('flow is blocked for custom code, template and integration (13.2.6-8)', b.r.status === 409 && ['custom_code', 'document_template', 'integration'].every((d) => b.deps.includes(d)), b.deps.join(','));
  b = await blockedWhy('draft');
  check('custom code without an approved active version is blocked (13.1.3)', b.r.status === 409 && b.deps.includes('custom_code_approved_version'));

  // object without the rule's field
  const tobj = await ObjectMeta.create({ tenantId: tgt._id, name: 'Case', label: 'Case', pluralLabel: 'Cases', apiName: 'case13', nameFieldApiName: 'name', isActive: true });
  const r2 = await deploy(sets.rule);
  const l2 = await DeploymentLog.findOne({ tenantId: tgt._id, changeSetId: sets.rule.json.data._id }).sort({ at: -1 }).lean();
  check('rule is blocked when a field it uses is missing (13.2.2)', r2.status === 409 && l2.missing.some((m) => m.dependency === 'field' && m.key === 'case13.amount'));
  await FieldMeta.create({ tenantId: tgt._id, objectId: tobj._id, objectApiName: 'case13', name: 'amount', label: 'amount', apiName: 'amount', type: 'number' });
  const r3 = await deploy(sets.rule);
  const tAfter = await ObjectMeta.findOne({ tenantId: tgt._id, apiName: 'case13' }).lean();
  check('rule deploys once the field exists', r3.status < 300 && tAfter.validationRules.length === 1, `HTTP ${r3.status}`);
  const logId = (await DeploymentLog.findOne({ tenantId: tgt._id, changeSetId: sets.rule.json.data._id, status: 'deployed' }).lean())?._id;
  const rb = await req(`/api/v1/change-sets/deployment-log/${logId}/rollback`, { method: 'POST' });
  check('rolling back removes the deployed rule', rb.status === 200 && (await ObjectMeta.findOne({ tenantId: tgt._id, apiName: 'case13' }).lean()).validationRules.length === 0);

  // prerequisites supplied one by one -> flow deploys with remapped ids
  await CustomCode.create({ tenantId: tgt._id, name: 'calc13', apiName: 'calc13', activeVersion: 1, versions: [{ version: 1, code: 'return 0;', status: 'active' }] });
  const tt = await PdfTemplate.create({ tenantId: tgt._id, name: 'Letter', apiName: 'letter13' });
  const tx = await ExternalObject.create({ tenantId: tgt._id, name: 'Slack13', baseUrl: 'https://example.org' });
  const rf = await deploy(sets.flow);
  const tf = await Automation.findOne({ tenantId: tgt._id, apiName: 'flow13' }).lean();
  check('flow deploys when prerequisites exist, ids remapped to the target', rf.status < 300 && String(tf.nodes[1].config.templateId) === String(tt._id) && String(tf.nodes[2].config.externalObjectId) === String(tx._id), `HTTP ${rf.status}`);

  // custom code promotion + rollback to the immediately preceding version
  const ccSet = await build('cc2', [{ componentType: 'custom_code', componentKey: 'calc13' }]);
  const rc = await deploy(ccSet);
  let tcc = await CustomCode.findOne({ tenantId: tgt._id, name: 'calc13' }).lean();
  check('promoted code becomes the new active version; the old one is kept', rc.status < 300 && tcc.activeVersion === 2 && tcc.versions.length === 2 && tcc.versions[0].status === 'archived' && tcc.versions[1].code === 'return 1;');
  const cclog = await DeploymentLog.findOne({ tenantId: tgt._id, changeSetId: ccSet.json.data._id, status: 'deployed' }).lean();
  const rbc = await req(`/api/v1/change-sets/deployment-log/${cclog._id}/rollback`, { method: 'POST' });
  tcc = await CustomCode.findOne({ tenantId: tgt._id, name: 'calc13' }).lean();
  check('rollback restores the preceding active custom-code version (13.3.2)', rbc.status === 200 && tcc.activeVersion === 1 && tcc.versions.length === 1 && tcc.versions[0].code === 'return 0;');

  // ── Flow dependencies (13.2.1-3) ──
  const subSrc = await Automation.create({ tenantId: src._id, apiName: 'sub13', name: 'Sub13', trigger: { objectApiName: 'case13', events: ['create'] }, nodes: [{ id: 's', type: 'end', label: 'End' }] });
  await Automation.create({ tenantId: src._id, apiName: 'flowdeps13', name: 'FlowDeps13', trigger: { objectApiName: 'case13', events: ['create'] }, nodes: [
    { id: 'u', type: 'action_update_record', label: 'U', config: { fields: { stage: 'x' } } },
    { id: 'c', type: 'action_create_record', label: 'C', config: { objectApiName: 'ghost13', fields: { a: '1' } } },
    { id: 'f', type: 'subflow', label: 'S', config: { automationId: subSrc._id } },
    { id: 'h', type: 'action_http_request', label: 'H', config: { url: '/x', headers: { Authorization: 'Bearer SECRET-VALUE' } } }] });
  const fd = await build('fdeps', [{ componentType: 'flow', componentKey: 'flowdeps13' }]);
  await deploy(fd);
  const fdLog = await DeploymentLog.findOne({ tenantId: tgt._id, changeSetId: fd.json.data._id, status: 'blocked' }).lean();
  const fdm = fdLog?.missing || [];
  check('flow blocked for a missing field it writes (13.2.2)', fdm.some((m) => m.dependency === 'field' && m.key === 'case13.stage'));
  check('flow blocked for a missing object it creates records on (13.2.1)', fdm.some((m) => m.dependency === 'object' && m.key === 'ghost13'));
  check('flow blocked for a sub-flow that is neither packaged nor in the target (13.2.3)', fdm.some((m) => m.dependency === 'flow' && m.key === 'sub13'));
  const fd2 = await build('fdeps2', [{ componentType: 'flow', componentKey: 'flowdeps13' }, { componentType: 'flow', componentKey: 'sub13' }, { componentType: 'object', componentKey: 'ghost13' }].slice(0, 2));
  await deploy(fd2);
  const fd2m = (await DeploymentLog.findOne({ tenantId: tgt._id, changeSetId: fd2.json.data._id, status: 'blocked' }).lean())?.missing || [];
  check('a sub-flow carried in the same package satisfies the dependency', !fd2m.some((m) => m.dependency === 'flow'));

  // ── Package files (13.2) ──
  const suCookie = async (tenantId, tag) => {
    const r = await Role.findOne({ tenantId, name: 'superuser' });
    const u = await User.create({ tenantId, firstName: 'S', lastName: tag, email: `s13${tag}-${RUN}@example.com`, username: `s13${tag}_${RUN}`, password: PASSWORD, role: r._id, status: 'active', emailVerified: true });
    const l = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u.email, password: PASSWORD }) });
    return (l.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).find((c) => c.startsWith('crm.sid=')) || '';
  };
  const dst = await mk('DST');
  const tgtCk = await suCookie(tgt._id, 'T');
  const ex = await req(`/api/v1/change-sets/${fd.json.data._id}/export`);
  const pkg = ex.json?.data;
  check('a change set exports as a versioned package with a checksum', ex.status === 200 && pkg?.format === 'salesdam-change-set' && pkg.version === 1 && /^[0-9a-f]{64}$/.test(pkg.checksum) && pkg.source?.tenantName === src.name && pkg.components.length === 1);
  check('credentials are never exported', !JSON.stringify(pkg).includes('SECRET-VALUE'));
  const imp = (p, extra = {}) => req('/api/v1/change-sets/import', { method: 'POST', body: { package: p }, ck: tgtCk, ...extra });
  const before = await ChangeSet.countDocuments({});
  const okImp = await imp(pkg);
  const impCs = okImp.json?.data;
  check('a package file imports as a draft change set in the chosen tenant', okImp.status === 201 && String(impCs?.tenantId) === String(tgt._id) && impCs.status === 'draft' && impCs.origin?.type === 'file', `HTTP ${okImp.status}`);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const refused = async (label, mutate, re) => {
    const p = clone(pkg); mutate(p);
    const n0 = await ChangeSet.countDocuments({});
    const r = await imp(p);
    check(`tampered file refused: ${label}`, r.status === 400 && re.test(r.json?.message || '') && (await ChangeSet.countDocuments({})) === n0, `${r.status} ${(r.json?.message || '').slice(0, 70)}`);
  };
  await refused('payload changed', (p) => { p.components[0].snapshot.name = 'Changed'; }, /checksum/);
  await refused('wrong checksum', (p) => { p.checksum = 'a'.repeat(64); }, /checksum/);
  await refused('no checksum', (p) => { delete p.checksum; }, /checksum/);
  await refused('wrong version', (p) => { p.version = 2; }, /version/);
  await refused('not a package', (p) => { p.format = 'other'; }, /not a Salesdam/);
  const reseal = (p) => { /* recompute a valid checksum so the later checks are reached */ return p; };
  const sealed = async (label, mutate, re) => {
    // build a package with a VALID checksum but bad content, by round-tripping through the service
    const svc = (await import('../services/changeSetService.js')).default;
    const p = clone(pkg); mutate(p);
    const crypto = await import('crypto');
    const canon = (v) => Array.isArray(v) ? `[${v.map(canon).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}` : JSON.stringify(v) ?? 'null';
    p.checksum = crypto.createHash('sha256').update(canon({ version: p.version, name: p.name, description: p.description || '', components: p.components })).digest('hex');
    const n0 = await ChangeSet.countDocuments({});
    const r = await imp(p);
    check(`valid checksum but unsafe content refused: ${label}`, r.status === 400 && re.test(r.json?.message || '') && (await ChangeSet.countDocuments({})) === n0, `${r.status} ${(r.json?.message || '').slice(0, 70)}`);
    void svc;
  };
  await sealed('unknown component type', (p) => { p.components[0].componentType = 'user'; }, /unknown component type/);
  await sealed('key does not match payload', (p) => { p.components[0].componentKey = 'someotherflow'; }, /does not match/);
  await sealed('operator key in payload', (p) => { p.components[0].snapshot.$where = 'x'; }, /forbidden|checksum/);
  await sealed('oversized', (p) => { p.components[0].snapshot.blob = 'x'.repeat(5.5 * 1024 * 1024); }, /larger than/);
  const adminRole = await Role.findOne({ tenantId: src._id, name: 'admin' });
  const adm = await User.create({ tenantId: src._id, firstName: 'A', lastName: 'D', email: `s13a-${RUN}@example.com`, username: `s13a_${RUN}`, password: PASSWORD, role: adminRole._id, status: 'active', emailVerified: true });
  const alr = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: adm.email, password: PASSWORD }) });
  const adminCookie = (alr.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).find((c) => c.startsWith('crm.sid=')) || '';
  const noPerm = await imp(pkg, { ck: adminCookie });
  check('a non-superuser cannot import a package', noPerm.status === 403, `HTTP ${noPerm.status}`);
  // imported package goes through the same validate -> deploy -> log -> rollback path
  const pkg2 = (await req(`/api/v1/change-sets/${sets.rule.json.data._id}/export`)).json.data;
  const imp2 = await imp(pkg2);
  const csId = imp2.json?.data?._id;
  const vres = await req(`/api/v1/change-sets/${csId}/validate`, { method: 'POST', ck: tgtCk, body: { targetTenantId: String(dst._id) } });
  check('an imported package validates against a target (blocked: object missing there)', vres.status === 200 && vres.json?.data?.valid === false && vres.json.data.missing.some((m) => m.dependency === 'object'));
  const dobj = await ObjectMeta.create({ tenantId: dst._id, name: 'Case', label: 'Case', pluralLabel: 'Cases', apiName: 'case13', nameFieldApiName: 'name', isActive: true });
  await FieldMeta.create({ tenantId: dst._id, objectId: dobj._id, objectApiName: 'case13', name: 'amount', label: 'amount', apiName: 'amount', type: 'number' });
  const dres = await req(`/api/v1/change-sets/${csId}/deploy`, { method: 'POST', ck: tgtCk, body: { targetTenantId: String(dst._id) } });
  const dlog = await DeploymentLog.findOne({ tenantId: dst._id, changeSetId: csId, status: 'deployed' }).lean();
  check('an imported package deploys and is logged in the target', dres.status < 300 && !!dlog && (await ObjectMeta.findOne({ tenantId: dst._id, apiName: 'case13' }).lean()).validationRules.length === 1);
  const rbk = await req(`/api/v1/change-sets/deployment-log/${dlog?._id}/rollback`, { method: 'POST', ck: tgtCk });
  check('and can be rolled back', rbk.status === 200 && (await ObjectMeta.findOne({ tenantId: dst._id, apiName: 'case13' }).lean()).validationRules.length === 0);
  void before;

  // ── Sandbox delete ──
  const cl2 = await req('/api/v1/change-sets/sandbox', { method: 'POST', body: { sourceTenantId: String(src._id), name: `ZZ_S13DEL_${RUN}` } });
  const delId = cl2.json?.data?.tenant?._id; if (delId) ids.push(delId);
  await User.create({ tenantId: delId, firstName: 'X', lastName: 'Y', email: `s13x-${RUN}@example.com`, username: `s13x_${RUN}`, password: PASSWORD, role: (await Role.findOne({ tenantId: delId, name: 'admin' }))._id, status: 'active', emailVerified: true });
  await DynamicRecord.create({ tenantId: delId, objectApiName: 'case13', data: { amount: 1 } }).catch(() => {});
  const del = (id, name, extra = {}) => req(`/api/v1/change-sets/sandbox/${id}`, { method: 'DELETE', body: { confirmName: name }, ...extra });
  let r = await del(src._id, src.name);
  check('delete refused for a tenant that is not a clone sandbox', r.status === 403, `HTTP ${r.status}`);
  const fake = await Tenant.create({ name: `ZZ_S13FAKE_${RUN}`, slug: `zz-s13fake-${RUN}`, status: 'active', plan: 'enterprise', isSandbox: true }); ids.push(fake._id);
  r = await del(fake._id, fake.name);
  check('delete refused for a sandbox flag without a clone origin', r.status === 403, `HTTP ${r.status}`);
  r = await del(delId, `ZZ_S13DEL_${RUN}`, { ck: await suCookie(delId, 'D') });
  check('delete refused for the tenant you are working in', r.status === 409, `HTTP ${r.status}`);
  r = await del(delId, 'wrong name');
  check('delete refused without the typed name', r.status === 400 && !!(await Tenant.findById(delId)), `HTTP ${r.status}`);
  r = await del(delId, `ZZ_S13DEL_${RUN}`, { ck: adminCookie });
  check('delete refused for a non-superuser', r.status === 403, `HTTP ${r.status}`);
  r = await del(delId, `ZZ_S13DEL_${RUN}`);
  const left = (await Promise.all([User, Role, ObjectMeta, FieldMeta, Automation, DynamicRecord, CustomCode].map((M) => M.countDocuments({ tenantId: delId })))).reduce((a, b) => a + b, 0);
  check('typed name deletes the sandbox with its data, users and roles', r.status === 200 && !(await Tenant.findById(delId)) && left === 0, `HTTP ${r.status} left=${left}`);
  check('the source tenant is untouched by the delete', !!(await Tenant.findById(src._id)) && (await ObjectMeta.countDocuments({ tenantId: src._id })) > 0);

  // sandbox clone: configuration yes, data no
  const cl = await req('/api/v1/change-sets/sandbox', { method: 'POST', body: { sourceTenantId: String(src._id), name: `ZZ_S13CLONE_${RUN}` } });
  const cid = cl.json?.data?.tenant?._id; if (cid) ids.push(cid);
  const cloneCode = cid && await CustomCode.findOne({ tenantId: cid, name: 'calc13' }).lean();
  check('sandbox clone copies rule, code, template, flow', cl.status < 300 && (await ObjectMeta.findOne({ tenantId: cid, apiName: 'case13' }).lean())?.validationRules?.length === 1 && !!cloneCode && !!(await PdfTemplate.findOne({ tenantId: cid, apiName: 'letter13' }).lean()) && !!(await Automation.findOne({ tenantId: cid, apiName: 'flow13' }).lean()), `HTTP ${cl.status}`);
  const cws = cid && await Workspace.findOne({ tenantId: cid, apiName: 'cases13' }).lean();
  check('sandbox clone carries the App so its objects are visible, without members', !!cws && cws.allowedObjects.includes('case13') && cws.memberIds.length === 0);
  check('sandbox clone holds no records', cid && (await DynamicRecord.countDocuments({ tenantId: cid })) === 0);
} catch (err) {
  check('test harness ran without error', false, err.stack);
} finally {
  if (ids.length) {
    await Tenant.deleteMany({ _id: { $in: ids } });
    await Promise.all([User, Role, Session, Workspace, ObjectMeta, FieldMeta, Automation, ChangeSet, DeploymentLog, DynamicRecord, CustomCode, PdfTemplate, ExternalObject].map((M) => M.deleteMany({ tenantId: { $in: ids } }).catch(() => {})));
  }
  server.close(); await mongoose.connection.close();
}
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
