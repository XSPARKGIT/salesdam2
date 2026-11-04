import 'dotenv/config';
import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import app from '../app.js';
import Tenant from '../models/Tenant.js';
import User from '../models/User.js';
import Role from '../models/Role.js';
import ObjectMeta from '../models/ObjectMeta.js';
import DynamicRecord from '../models/DynamicRecord.js';
import FieldMeta from '../models/FieldMeta.js';
import RetentionRule from '../models/RetentionRule.js';
import BackupJob from '../models/BackupJob.js';
import fs from 'fs';
import { seedWorkspace } from './helpers/workspace.mjs';

const RUN = Date.now().toString(36);
const PASSWORD = 'GovTest123!';
const results = [];
const check = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };

const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
const req = async (path, { method = 'GET', cookie, body } = {}) => {
  const res = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
};
const loginCookie = async (username) => {
  const res = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: PASSWORD }) });
  const sc = res.headers.getSetCookie?.() || [];
  const cookie = sc.map((c) => c.split(';')[0]).find((c) => c.startsWith('crm.sid=')) || '';
  return { status: res.status, cookie };
};

let tA, tB;
try {
  await connectDB();
  tA = await Tenant.create({ name: `ZZ_GOV_A_${RUN}`, slug: `zz-gov-a-${RUN}`, status: 'active', plan: 'enterprise' });
  tB = await Tenant.create({ name: `ZZ_GOV_B_${RUN}`, slug: `zz-gov-b-${RUN}`, status: 'active', plan: 'enterprise' });
  const adminRoleA = await Role.create({ tenantId: tA._id, name: 'admin', label: 'Admin', dataAccess: 'all', objectPermissions: [], appPermissions: { canManageTenantSettings: true } });
  const adminRoleB = await Role.create({ tenantId: tB._id, name: 'admin', label: 'Admin', dataAccess: 'all', objectPermissions: [], appPermissions: { canManageTenantSettings: true } });
  const adminA = await User.create({ tenantId: tA._id, firstName: 'AdminA', lastName: 'Test', email: `admina-${RUN}@example.com`, username: `admina_${RUN}`, password: PASSWORD, role: adminRoleA._id, status: 'active', emailVerified: true });
  const adminB = await User.create({ tenantId: tB._id, firstName: 'AdminB', lastName: 'Test', email: `adminb-${RUN}@example.com`, username: `adminb_${RUN}`, password: PASSWORD, role: adminRoleB._id, status: 'active', emailVerified: true });
  await ObjectMeta.create({ tenantId: tA._id, name: 'Policy', label: 'Policy', pluralLabel: 'Policies', apiName: 'policy', nameFieldApiName: 'name', isActive: true, searchable: true });
  const objA = await ObjectMeta.findOne({ tenantId: tA._id, apiName: 'policy' });
  await FieldMeta.create({ tenantId: tA._id, objectId: objA._id, objectApiName: 'policy', name: 'Name', label: 'Name', apiName: 'name', type: 'text' });
  const rec = await DynamicRecord.create({ tenantId: tA._id, objectId: objA._id, objectApiName: 'policy', ownerId: adminA._id, createdBy: adminA._id, data: { name: 'Gov Record' } });
  await seedWorkspace(tA._id, [adminA._id], ['policy']);
  await seedWorkspace(tB._id, [adminB._id], ['policy']);
  const CA = (await loginCookie(adminA.email)).cookie;
  const CB = (await loginCookie(adminB.email)).cookie;
  check('admins auth', Boolean(CA && CB));

  // ── Retention rules ──
  const setRule = await req('/api/v1/data-governance/retention-rules/business_records', { method: 'PUT', cookie: CA, body: { retentionDays: 30 } });
  check('set retention rule (200)', setRule.status === 200, `HTTP ${setRule.status}`);
  const rules = await req('/api/v1/data-governance/retention-rules', { cookie: CA });
  check('list retention rules (200)', rules.status === 200, `HTTP ${rules.status}`);
  check('rule persisted', (rules.json?.data || []).some((r) => r.category === 'business_records' && r.retentionDays === 30));
  // Different category
  await req('/api/v1/data-governance/retention-rules/audit_logs', { method: 'PUT', cookie: CA, body: { retentionDays: 90 } });
  const rules2 = await req('/api/v1/data-governance/retention-rules', { cookie: CA });
  check('different categories have different rules', (rules2.json?.data || []).filter((r) => r.category === 'business_records' || r.category === 'audit_logs').length >= 2);

  // Tenant isolation: B cannot see A's rules
  const rulesB = await req('/api/v1/data-governance/retention-rules', { cookie: CB });
  check('tenant isolation: B rules separate', (rulesB.json?.data || []).every((r) => r.tenantId === tB._id.toString() || r.tenantId === null), `count=${(rulesB.json?.data || []).length}`);

  // Unauthorized: non-admin cannot configure
  const nonAdminRole = await Role.create({ tenantId: tA._id, name: 'viewer', label: 'Viewer', dataAccess: 'own', objectPermissions: [], appPermissions: {} });
  const nonAdmin = await User.create({ tenantId: tA._id, firstName: 'Viewer', lastName: 'Test', email: `viewer-${RUN}@example.com`, username: `viewer_${RUN}`, password: PASSWORD, role: nonAdminRole._id, status: 'active', emailVerified: true });
  await seedWorkspace(tA._id, [nonAdmin._id], ['policy']);
  const loginNA = await loginCookie(nonAdmin.email);
  const naCookie = loginNA.cookie;
  const naRule = await req('/api/v1/data-governance/retention-rules/business_records', { method: 'PUT', cookie: naCookie, body: { retentionDays: 10 } });
  check('non-admin cannot set retention rule (403)', naRule.status === 403, `HTTP ${naRule.status}`);

  // ── Backup ──
  const backup = await req('/api/v1/data-governance/backups', { method: 'POST', cookie: CA, body: { type: 'full' } });
  check('create backup (201)', backup.status === 201, `HTTP ${backup.status}`);
  const backupId = backup.json?.data?._id;
  check('backup has componentCount', (backup.json?.data?.componentCount ?? 0) > 0, `count=${backup.json?.data?.componentCount}`);
  check('backup status completed', backup.json?.data?.status === 'completed', `status=${backup.json?.data?.status}`);

  // Verify backup artifact exists
  const job = await BackupJob.findById(backupId).lean();
  check('backup artifact path stored', !!job?.artifactPath, `path=${job?.artifactPath}`);
  check('backup artifact file exists', job?.artifactPath && fs.existsSync(job.artifactPath), `exists=${job?.artifactPath && fs.existsSync(job.artifactPath)}`);

  // List backups
  const backups = await req('/api/v1/data-governance/backups', { cookie: CA });
  check('list backups (200)', backups.status === 200, `HTTP ${backups.status}`);
  check('backup in list', (backups.json?.data || []).some((b) => b._id === backupId));

  // Tenant isolation: B cannot see A's backups
  const backupsB = await req('/api/v1/data-governance/backups', { cookie: CB });
  check('tenant isolation: B backups separate', (backupsB.json?.data || []).every((b) => b.tenantId === tB._id.toString()), `count=${(backupsB.json?.data || []).length}`);

  // Restore backup
  const restore = await req(`/api/v1/data-governance/backups/${backupId}/restore`, { method: 'POST', cookie: CA });
  check('restore backup (200)', restore.status === 200, `HTTP ${restore.status}`);
  check('restore reports success', restore.json?.data?.restored === true);
  const restoredJob = await BackupJob.findById(backupId).lean();
  check('backup status updated to restored', restoredJob?.status === 'restored');

  // Non-admin cannot create backup
  const naBackup = await req('/api/v1/data-governance/backups', { method: 'POST', cookie: naCookie, body: { type: 'full' } });
  check('non-admin cannot create backup (403)', naBackup.status === 403, `HTTP ${naBackup.status}`);

  // ── Anonymisation ──
  const anon = await req('/api/v1/data-governance/anonymise', { method: 'POST', cookie: CA, body: { objectApiName: 'policy', recordIds: [rec._id.toString()] } });
  check('anonymise records (200)', anon.status === 200, `HTTP ${anon.status}`);
  const anonRec = await DynamicRecord.findById(rec._id).lean();
  check('anonymisation masked PII field', anonRec?.data?.name === '[ANONYMISED]', `name=${anonRec?.data?.name}`);

  // ── Retention enforcement ──
  // Set a very short retention and enforce (won't affect recent records due to cutoff)
  await req('/api/v1/data-governance/retention-rules/business_records', { method: 'PUT', cookie: CA, body: { retentionDays: 1 } });
  const enforce = await req('/api/v1/data-governance/retention/enforce', { method: 'POST', cookie: CA, body: { category: 'business_records' } });
  check('enforce retention (200)', enforce.status === 200, `HTTP ${enforce.status}`);

  // ── Tenant isolation for retention ──
  const ruleA = await RetentionRule.findOne({ tenantId: tA._id, category: 'business_records' }).lean();
  const ruleB = await RetentionRule.findOne({ tenantId: tB._id, category: 'business_records' }).lean();
  check('retention rules isolated by tenant', ruleA?._id?.toString() !== ruleB?._id?.toString(), `A=${ruleA?._id} B=${ruleB?._id}`);

} catch (err) {
  console.error('TEST RUN ERROR:', err);
  check('test run completed without unexpected error', false, err.message);
} finally {
  try {
    if (tA) {
      const tid = tA._id;
      await Promise.all([
        DynamicRecord.deleteMany({ tenantId: tid }),
        FieldMeta.deleteMany({ tenantId: tid }),
        ObjectMeta.deleteMany({ tenantId: tid }),
        RetentionRule.deleteMany({ tenantId: tid }),
        BackupJob.deleteMany({ tenantId: tid }),
        User.deleteMany({ tenantId: tid }),
        Role.deleteMany({ tenantId: tid }),
        Tenant.deleteOne({ _id: tid }),
      ]);
    }
    if (tB) {
      const tid = tB._id;
      await Promise.all([
        DynamicRecord.deleteMany({ tenantId: tid }),
        ObjectMeta.deleteMany({ tenantId: tid }),
        User.deleteMany({ tenantId: tid }),
        Role.deleteMany({ tenantId: tid }),
        Tenant.deleteOne({ _id: tid }),
      ]);
    }
    await mongoose.connection.close();
  } catch (e) { console.error('cleanup', e.message); }
  server.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  process.exit(failed.length ? 1 : 0);
}
