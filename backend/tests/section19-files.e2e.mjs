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
import File from '../models/File.js';
import { seedWorkspace } from './helpers/workspace.mjs';

const RUN = Date.now().toString(36);
const PASSWORD = 'FileTest123!';
const results = [];
const check = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };

const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
const req = async (path, { method = 'GET', cookie, body, formData, headers = {} } = {}) => {
  const init = { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...headers } };
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

let tA, tB;
try {
  await connectDB();
  tA = await Tenant.create({ name: `ZZ_FILE_A_${RUN}`, slug: `zz-file-a-${RUN}`, status: 'active', plan: 'enterprise' });
  tB = await Tenant.create({ name: `ZZ_FILE_B_${RUN}`, slug: `zz-file-b-${RUN}`, status: 'active', plan: 'enterprise' });

  const adminRoleA = await Role.create({ tenantId: tA._id, name: 'admin', label: 'Admin', dataAccess: 'all', objectPermissions: [{ objectApiName: 'policy', canCreate: true, canRead: true, canUpdate: true, canDelete: true, canExport: true, canImport: true }], appPermissions: { canManageTenantSettings: true } });
  const adminRoleB = await Role.create({ tenantId: tB._id, name: 'admin', label: 'Admin', dataAccess: 'all', objectPermissions: [{ objectApiName: 'policy', canCreate: true, canRead: true, canUpdate: true, canDelete: true, canExport: true, canImport: true }], appPermissions: {} });
  const adminA = await User.create({ tenantId: tA._id, firstName: 'AdminA', lastName: 'Test', email: `admina-${RUN}@example.com`, username: `admina_${RUN}`, password: PASSWORD, role: adminRoleA._id, status: 'active', emailVerified: true });
  const adminB = await User.create({ tenantId: tB._id, firstName: 'AdminB', lastName: 'Test', email: `adminb-${RUN}@example.com`, username: `adminb_${RUN}`, password: PASSWORD, role: adminRoleB._id, status: 'active', emailVerified: true });

  await ObjectMeta.create({ tenantId: tA._id, name: 'Policy', label: 'Policy', pluralLabel: 'Policies', apiName: 'policy', nameFieldApiName: 'name', isActive: true, searchable: true });
  const objA = await ObjectMeta.findOne({ tenantId: tA._id, apiName: 'policy' });
  await FieldMeta.create({ tenantId: tA._id, objectId: objA._id, objectApiName: 'policy', name: 'Name', label: 'Name', apiName: 'name', type: 'text' });
  const record = await DynamicRecord.create({ tenantId: tA._id, objectId: objA._id, objectApiName: 'policy', ownerId: adminA._id, createdBy: adminA._id, data: { name: 'Test Record' } });
  await seedWorkspace(tA._id, [adminA._id], ['policy']);
  await seedWorkspace(tB._id, [adminB._id], ['policy']);

  const loginA = await loginCookie(adminA.email);
  const loginB = await loginCookie(adminB.email);
  const CA = loginA.cookie, CB = loginB.cookie;
  check('admins auth', loginA.status === 200 && loginB.status === 200);

  // Upload a file
  const fd = new FormData();
  fd.append('file', new Blob(['hello world'], { type: 'text/plain' }), 'test.txt');
  fd.append('objectApiName', 'policy');
  fd.append('recordId', record._id.toString());
  const upload = await req('/api/v1/files/upload', { method: 'POST', cookie: CA, formData: fd });
  check('upload file (201)', upload.status === 201, `HTTP ${upload.status}`);
  const fileId = upload.json?.data?._id;
  check('upload returns file id', !!fileId);

  // Verify persisted in DB
  const dbFile = await File.findOne({ _id: fileId, tenantId: tA._id }).lean();
  check('file persisted in DB', !!dbFile && dbFile.name === 'test.txt' && dbFile.sizeBytes === 11);
  check('file associated with correct record', String(dbFile?.relatedTo?.recordId) === String(record._id));

  // List files for record
  const list = await req(`/api/v1/files?objectApiName=policy&recordId=${record._id}`, { cookie: CA });
  check('list files (200)', list.status === 200, `HTTP ${list.status}`);
  check('list contains uploaded file', (list.json?.data?.items || list.json?.data || []).some((f) => f._id === fileId));

  // Get file metadata
  const meta = await req(`/api/v1/files/${fileId}`, { cookie: CA });
  check('get file metadata (200)', meta.status === 200, `HTTP ${meta.status}`);
  check('metadata has correct fields', meta.json?.data?.name === 'test.txt' && meta.json?.data?.mimeType === 'text/plain');

  // Download file
  const dl = await fetch(`${base}/api/v1/files/${fileId}/download`, { headers: { Cookie: CA } });
  const dlText = await dl.text();
  check('download file (200)', dl.status === 200, `HTTP ${dl.status}`);
  check('download content correct', dlText === 'hello world');

  // Preview file
  const preview = await fetch(`${base}/api/v1/files/${fileId}/preview`, { headers: { Cookie: CA } });
  check('preview file (200)', preview.status === 200, `HTTP ${preview.status}`);

  // Replace file (creates new version)
  const fd2 = new FormData();
  fd2.append('file', new Blob(['updated content'], { type: 'text/plain' }), 'updated.txt');
  const replace = await req(`/api/v1/files/${fileId}/replace`, { method: 'PUT', cookie: CA, formData: fd2 });
  check('replace file (200)', replace.status === 200, `HTTP ${replace.status}`);
  const newFileId = replace.json?.data?._id;
  check('replace returns new file id', !!newFileId && newFileId !== fileId);
  const dbFile2 = await File.findById(newFileId).lean();
  check('replace persisted (new version)', dbFile2?.name === 'updated.txt' && dbFile2?.version === 2);
  const oldFile = await File.findById(fileId).lean();
  check('old version superseded', oldFile?.isActive === false && String(oldFile?.supersededBy) === String(newFileId));

  // Version history
  const versions = await req(`/api/v1/files/${fileId}/versions`, { cookie: CA });
  check('versions endpoint (200)', versions.status === 200, `HTTP ${versions.status}`);
  check('version history has 2 entries', (versions.json?.data || []).length === 2, `count=${(versions.json?.data || []).length}`);

  // Delete file
  const del = await req(`/api/v1/files/${fileId}`, { method: 'DELETE', cookie: CA });
  check('delete file (200)', del.status === 200, `HTTP ${del.status}`);
  const dbFile3 = await File.findById(fileId).lean();
  check('delete soft-deletes', dbFile3?.isActive === false);

  // Deleted file not in list
  const list2 = await req(`/api/v1/files?objectApiName=policy&recordId=${record._id}`, { cookie: CA });
  check('deleted file not in list', !(list2.json?.data?.items || list2.json?.data || []).some((f) => f._id === fileId));

  // Tenant isolation: B cannot access A's file
  const cross = await req(`/api/v1/files/${fileId}`, { cookie: CB });
  check('tenant isolation: B cannot read A file (404)', cross.status === 404, `HTTP ${cross.status}`);

  // Permission enforcement: create a user without read permission
  const noReadRole = await Role.create({ tenantId: tA._id, name: 'noread', label: 'NoRead', dataAccess: 'own', objectPermissions: [{ objectApiName: 'policy', canRead: false, canUpdate: false, canCreate: false, canDelete: false }] });
  const noReadUser = await User.create({ tenantId: tA._id, firstName: 'NoRead', lastName: 'User', email: `noread-${RUN}@example.com`, username: `noread_${RUN}`, password: PASSWORD, role: noReadRole._id, status: 'active', emailVerified: true });
  await seedWorkspace(tA._id, [noReadUser._id], ['policy']);
  const loginNR = await loginCookie(noReadUser.email);
  const CNR = loginNR.cookie;

  // Upload a new file as admin for permission test
  const fd3 = new FormData();
  fd3.append('file', new Blob(['secret'], { type: 'text/plain' }), 'secret.txt');
  fd3.append('objectApiName', 'policy');
  fd3.append('recordId', record._id.toString());
  const upload2 = await req('/api/v1/files/upload', { method: 'POST', cookie: CA, formData: fd3 });
  const fileId2 = upload2.json?.data?._id;
  const permCheck = await req(`/api/v1/files/${fileId2}`, { cookie: CNR });
  check('permission enforcement: no-read user cannot access file (403)', permCheck.status === 403, `HTTP ${permCheck.status}`);

  // Invalid file type rejected
  const fdBad = new FormData();
  fdBad.append('file', new Blob(['<script>alert(1)</script>'], { type: 'application/x-javascript' }), 'bad.js');
  fdBad.append('objectApiName', 'policy');
  fdBad.append('recordId', record._id.toString());
  const badUpload = await req('/api/v1/files/upload', { method: 'POST', cookie: CA, formData: fdBad });
  check('invalid file type rejected (400)', badUpload.status === 400, `HTTP ${badUpload.status}`);

  // Storage usage endpoint
  const storage = await req('/api/v1/files/storage-usage', { cookie: CA });
  check('storage usage endpoint (200)', storage.status === 200, `HTTP ${storage.status}`);
  check('storage usage has allocated/used', storage.json?.data?.allocatedMB > 0 && storage.json?.data?.usedMB >= 0);

} catch (err) {
  console.error('TEST RUN ERROR:', err);
  check('test run completed without unexpected error', false, err.message);
} finally {
  try {
    if (tA) {
      const tid = tA._id;
      await Promise.all([
        File.deleteMany({ tenantId: tid }),
        DynamicRecord.deleteMany({ tenantId: tid }),
        FieldMeta.deleteMany({ tenantId: tid }),
        ObjectMeta.deleteMany({ tenantId: tid }),
        User.deleteMany({ tenantId: tid }),
        Role.deleteMany({ tenantId: tid }),
        Tenant.deleteOne({ _id: tid }),
      ]);
    }
    if (tB) {
      const tid = tB._id;
      await Promise.all([
        File.deleteMany({ tenantId: tid }),
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
