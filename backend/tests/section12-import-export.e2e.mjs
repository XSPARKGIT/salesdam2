/**
 * section12-import-export.e2e.mjs — Section 12 Data Import & Export verification.
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
import Automation from '../models/Automation.js';
import DynamicRecord from '../models/DynamicRecord.js';
import { seedWorkspace } from './helpers/workspace.mjs';

const RUN = Date.now().toString(36);
const PASSWORD = 'ImpExp123!';
const results = [];
const check = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };

const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
const req = async (path, { method = 'GET', cookie, body, formData } = {}) => {
  const init = { method, headers: {} };
  if (cookie) init.headers.Cookie = cookie;
  if (formData) { init.body = formData; }
  else if (body) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
  const res = await fetch(`${base}${path}`, init);
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
};
const loginCookie = async (username) => {
  const res = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: PASSWORD }) });
  const setCookie = res.headers.getSetCookie?.() || [];
  const sid = setCookie.map((c) => c.split(';')[0]).find((c) => c.startsWith('crm.sid='));
  return { status: res.status, cookie: sid };
};

let tenant;
try {
  await connectDB();
  tenant = await Tenant.create({ name: `ZZ_IMP_${RUN}`, slug: `zz-imp-${RUN}`, status: 'active', plan: 'enterprise' });
  const adminRole = await Role.create({ tenantId: tenant._id, name: 'admin', label: 'Admin', dataAccess: 'all', objectPermissions: [], appPermissions: { canImportData: true, canExportData: true, canManageObjects: true } });
  const admin = await User.create({ tenantId: tenant._id, firstName: 'Admin', lastName: 'Test', email: `admin-${RUN}@example.com`, username: `admin_${RUN}`, password: PASSWORD, role: adminRole._id, status: 'active', emailVerified: true });
  await ObjectMeta.create({ tenantId: tenant._id, name: 'Policy', label: 'Policy', pluralLabel: 'Policies', apiName: 'policy', nameFieldApiName: 'name', isActive: true, searchable: true, validationRules: [{ name: 'Premium min', expression: 'premium < 100', errorMessage: 'Premium must be >= 100', isActive: true }] });
  const obj = await ObjectMeta.findOne({ tenantId: tenant._id, apiName: 'policy' });
  for (const f of [{ apiName: 'name', label: 'Name', type: 'text', isRequired: true }, { apiName: 'type', label: 'Type', type: 'text' }, { apiName: 'premium', label: 'Premium', type: 'number' }, { apiName: 'calc', label: 'Calc', type: 'formula', formula: 'premium * 2' }]) {
    await FieldMeta.create({ tenantId: tenant._id, objectId: obj._id, objectApiName: 'policy', name: f.label, ...f });
  }
  // Flow (automation) that marks imported records
  await Automation.create({
    tenantId: tenant._id,
    name: 'Mark Flow Ran',
    apiName: `mark_flow_ran_${RUN}`,
    type: 'record_triggered',
    isActive: true,
    isValid: true,
    trigger: { objectApiName: 'policy', events: ['create'], runWhen: 'always' },
    nodes: [
      { id: 'trigger', type: 'trigger', label: 'Trigger', position: { x: 0, y: 0 }, config: {}, nextNodes: [{ nodeId: 'update', condition: null, label: '' }] },
      { id: 'update', type: 'action_update_record', label: 'Mark flow ran', position: { x: 100, y: 0 }, config: { fields: { flow_ran: 'yes' } }, nextNodes: [{ nodeId: 'end', condition: null, label: '' }] },
      { id: 'end', type: 'end', label: 'End', position: { x: 200, y: 0 }, config: {}, nextNodes: [] },
    ],
  });
  await seedWorkspace(tenant._id, [admin._id], ['policy']);
  const login = await loginCookie(admin.email);
  const C = login.cookie;
  check('admin auth', login.status === 200 && !!C);

  // Import normal with invalid row (premium 50) -> should fail validation
  const csvBad = 'name,type,premium\nBadRow,Funeral,50\n';
  const fdBad = new FormData();
  fdBad.append('file', new Blob([csvBad], { type: 'text/csv' }), 'bad.csv');
  fdBad.append('object', 'policy');
  fdBad.append('mapping', JSON.stringify({ name: 'name', type: 'type', premium: 'premium' }));
  const impBad = await req('/api/v1/admin/import', { method: 'POST', cookie: C, formData: fdBad });
  check('normal import rejects invalid validation rule', impBad.status === 200 && (impBad.json?.data?.failed ?? 0) > 0, `HTTP ${impBad.status} failed=${impBad.json?.data?.failed}`);

  // Import normal valid row
  const csvGood = 'name,type,premium\nGoodRow,Funeral,200\n';
  const fdGood = new FormData();
  fdGood.append('file', new Blob([csvGood], { type: 'text/csv' }), 'good.csv');
  fdGood.append('object', 'policy');
  fdGood.append('mapping', JSON.stringify({ name: 'name', type: 'type', premium: 'premium' }));
  const impGood = await req('/api/v1/admin/import', { method: 'POST', cookie: C, formData: fdGood });
  check('normal import creates valid record', impGood.status === 200 && (impGood.json?.data?.created ?? 0) === 1, `HTTP ${impGood.status} created=${impGood.json?.data?.created}`);
  const created = await DynamicRecord.findOne({ tenantId: tenant._id, objectApiName: 'policy', 'data.name': 'GoodRow' }).lean();
  check('imported value persisted', !!created && created.data.premium === 200);

  // Wait for non-blocking Flow execution
  await new Promise((r) => setTimeout(r, 2000));
  const createdAfterFlow = await DynamicRecord.findOne({ tenantId: tenant._id, objectApiName: 'policy', 'data.name': 'GoodRow' }).lean();
  check('flow executes on normal import', createdAfterFlow?.data?.flow_ran === 'yes', `flow_ran=${createdAfterFlow?.data?.flow_ran}`);

  // Bypass import with invalid row should succeed
  const csvBypass = 'name,type,premium\nBypassRow,Funeral,50\n';
  const fdBypass = new FormData();
  fdBypass.append('file', new Blob([csvBypass], { type: 'text/csv' }), 'bypass.csv');
  fdBypass.append('object', 'policy');
  fdBypass.append('mapping', JSON.stringify({ name: 'name', type: 'type', premium: 'premium' }));
  fdBypass.append('bypassValidation', 'true');
  const impBypass = await req('/api/v1/admin/import', { method: 'POST', cookie: C, formData: fdBypass });
  check('admin bypass imports invalid row', impBypass.status === 200 && (impBypass.json?.data?.created ?? 0) === 1, `HTTP ${impBypass.status} created=${impBypass.json?.data?.created}`);

  await new Promise((r) => setTimeout(r, 2000));
  const bypassed = await DynamicRecord.findOne({ tenantId: tenant._id, objectApiName: 'policy', 'data.name': 'BypassRow' }).lean();
  check('flow skipped on bypass import', bypassed?.data?.flow_ran !== 'yes', `flow_ran=${bypassed?.data?.flow_ran}`);

  // Non-admin bypass (create non-admin user)
  const nonAdminRole = await Role.create({ tenantId: tenant._id, name: 'rep', label: 'Rep', dataAccess: 'own', objectPermissions: [{ objectApiName: 'policy', canCreate: true, canRead: true, canUpdate: true, canDelete: true, canExport: true, canImport: true }], appPermissions: { canImportData: true, canExportData: true } });
  const nonAdmin = await User.create({ tenantId: tenant._id, firstName: 'Non', lastName: 'Admin', email: `nonadmin-${RUN}@example.com`, username: `nonadmin_${RUN}`, password: PASSWORD, role: nonAdminRole._id, status: 'active', emailVerified: true });
  await seedWorkspace(tenant._id, [nonAdmin._id], ['policy']);
  const loginNA = await loginCookie(nonAdmin.email);
  const fdNA = new FormData();
  fdNA.append('file', new Blob(['name,type,premium\nX,Funeral,10\n'], { type: 'text/csv' }), 'na.csv');
  fdNA.append('object', 'policy');
  fdNA.append('mapping', JSON.stringify({ name: 'name', type: 'type', premium: 'premium' }));
  fdNA.append('bypassValidation', 'true');
  const impNA = await req('/api/v1/admin/import', { method: 'POST', cookie: loginNA.cookie, formData: fdNA });
  check('non-admin bypass rejected (403)', impNA.status === 403, `HTTP ${impNA.status}`);

  // Direct API bypass as non-admin should also be 403 (same endpoint)
  check('direct API bypass enforcement', impNA.status === 403);

  // Export selected fields
  const exp = await req(`/api/v1/admin/export?object=policy&format=CSV&fields=name,premium`, { cookie: C });
  check('export returns 200', exp.status === 200, `HTTP ${exp.status}`);
  check('export contains only selected fields', exp.text.includes('Name') && exp.text.includes('Premium') && !exp.text.includes('Calc'), exp.text.slice(0, 120));
  check('export contains imported record', exp.text.includes('GoodRow'));

  // Unauthorized field export via direct API
  const expUnauth = await req(`/api/v1/admin/export?object=policy&format=CSV&fields=name,premium,secret`, { cookie: C });
  check('unauthorized export field rejected or ignored', !expUnauth.text.includes('secret') || expUnauth.status === 400, `HTTP ${expUnauth.status}`);

  // Subsequent manual save still executes validation (create via records API with invalid premium)
  const rec = await req('/api/v1/records/policy', { method: 'POST', cookie: C, body: { name: 'ManualBad', type: 'Funeral', premium: 10 } });
  check('manual save still validates (invalid rejected)', rec.status === 400, `HTTP ${rec.status}`);

  // Custom field auto-appears
  await FieldMeta.create({ tenantId: tenant._id, objectId: obj._id, objectApiName: 'policy', name: 'CustomField', label: 'CustomField', apiName: 'custom_field', type: 'text' });
  const objReload = await req('/api/v1/objects/policy', { cookie: C });
  const hasCustom = (objReload.json?.data?.data?.fields || objReload.json?.data?.fields || []).some((f) => f.apiName === 'custom_field');
  check('new custom field appears in metadata', hasCustom);

} catch (err) {
  console.error('TEST RUN ERROR:', err);
  check('test run completed without unexpected error', false, err.message);
} finally {
  try {
    if (tenant) {
      const t = tenant._id;
      await Promise.all([
        DynamicRecord.deleteMany({ tenantId: t }),
        FieldMeta.deleteMany({ tenantId: t }),
        ObjectMeta.deleteMany({ tenantId: t }),
        User.deleteMany({ tenantId: t }),
        Role.deleteMany({ tenantId: t }),
        Tenant.deleteOne({ _id: t }),
      ]);
    }
    await mongoose.connection.close();
  } catch (e) { console.error('cleanup', e.message); }
  server.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  process.exit(failed.length ? 1 : 0);
}
