import 'dotenv/config';
import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import app from '../app.js';
import Tenant from '../models/Tenant.js';
import User from '../models/User.js';
import Role from '../models/Role.js';
import CustomCode from '../models/CustomCode.js';
import { seedWorkspace } from './helpers/workspace.mjs';

const RUN = Date.now().toString(36);
const PASSWORD = 'CcTest123!';
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
  const setCookie = res.headers.getSetCookie?.() || [];
  const sid = setCookie.map((c) => c.split(';')[0]).find((c) => c.startsWith('crm.sid='));
  return { status: res.status, cookie: sid };
};

let tA, tB;
try {
  await connectDB();
  tA = await Tenant.create({ name: `ZZ_CC_A_${RUN}`, slug: `zz-cc-a-${RUN}`, status: 'active', plan: 'enterprise' });
  tB = await Tenant.create({ name: `ZZ_CC_B_${RUN}`, slug: `zz-cc-b-${RUN}`, status: 'active', plan: 'enterprise' });

  const adminRoleA = await Role.create({ tenantId: tA._id, name: 'admin', label: 'Admin', dataAccess: 'all', objectPermissions: [], appPermissions: { canManageCustomCode: true, canDeployCustomCode: true } });
  const adminRoleB = await Role.create({ tenantId: tB._id, name: 'admin', label: 'Admin', dataAccess: 'all', objectPermissions: [], appPermissions: { canManageCustomCode: true, canDeployCustomCode: true } });
  const limitedRole = await Role.create({ tenantId: tA._id, name: 'limited', label: 'Limited', dataAccess: 'own', objectPermissions: [], appPermissions: {} });
  const adminA = await User.create({ tenantId: tA._id, firstName: 'AdminA', lastName: 'Test', email: `admina-${RUN}@example.com`, username: `admina_${RUN}`, password: PASSWORD, role: adminRoleA._id, status: 'active', emailVerified: true });
  const adminB = await User.create({ tenantId: tB._id, firstName: 'AdminB', lastName: 'Test', email: `adminb-${RUN}@example.com`, username: `adminb_${RUN}`, password: PASSWORD, role: adminRoleB._id, status: 'active', emailVerified: true });
  const limited = await User.create({ tenantId: tA._id, firstName: 'Limited', lastName: 'Test', email: `limited-${RUN}@example.com`, username: `limited_${RUN}`, password: PASSWORD, role: limitedRole._id, status: 'active', emailVerified: true });

  await seedWorkspace(tA._id, [adminA._id], []);
  await seedWorkspace(tB._id, [adminB._id], []);

  const loginA = await loginCookie(adminA.username);
  const loginB = await loginCookie(adminB.username);
  const loginLim = await loginCookie(limited.username);
  const CA = loginA.cookie, CB = loginB.cookie, CL = loginLim.cookie;
  check('admins auth', loginA.status === 200 && loginB.status === 200);

  // Create custom code (version 1 draft)
  const createRes = await req('/api/v1/custom-code', { method: 'POST', cookie: CA, body: { name: 'calc_discount', description: 'calc', code: 'result = (inputs.price || 0) * 0.1;', inputs: { price: 'number' } } });
  check('create custom code (draft v1)', createRes.status === 201, `HTTP ${createRes.status}`);

  // Execute without active version -> fail
  const execDraft = await req('/api/v1/custom-code/calc_discount/execute', { method: 'POST', cookie: CA, body: { inputs: { price: 100 } } });
  check('draft cannot execute (no active version)', execDraft.status >= 400, `HTTP ${execDraft.status}`);

  // Add version 2
  const v2 = await req('/api/v1/custom-code/calc_discount/versions', { method: 'POST', cookie: CA, body: { code: 'result = (inputs.price || 0) * 0.2;', inputs: { price: 'number' }, changeNote: 'v2' } });
  check('add version 2', v2.status === 200, `HTTP ${v2.status}`);

  // Activate version 2
  const act = await req('/api/v1/custom-code/calc_discount/activate', { method: 'POST', cookie: CA, body: { version: 2 } });
  check('activate version 2', act.status === 200, `HTTP ${act.status}`);

  // Execute with inputs
  const exec = await req('/api/v1/custom-code/calc_discount/execute', { method: 'POST', cookie: CA, body: { inputs: { price: 100 } } });
  check('execute active version returns output', exec.status === 200 && exec.json?.data?.output === 20, `HTTP ${exec.status} output=${exec.json?.data?.output}`);

  // Verify execution logged
  const doc = await CustomCode.findOne({ tenantId: tA._id, name: 'calc_discount' }).lean();
  check('execution logged', (doc?.executions?.length || 0) > 0, `logs=${doc?.executions?.length}`);

  // Tenant isolation: tenant B cannot access
  const cross = await req('/api/v1/custom-code/calc_discount', { cookie: CB });
  check('tenant isolation: other tenant cannot read', cross.status === 404, `HTTP ${cross.status}`);

  // Permission: limited user cannot create
  const limCreate = await req('/api/v1/custom-code', { method: 'POST', cookie: CL, body: { name: 'x', code: 'result=1;' } });
  check('permission: unauthorized user cannot create (403)', limCreate.status === 403, `HTTP ${limCreate.status}`);

  // Permission: limited user cannot execute
  const limExec = await req('/api/v1/custom-code/calc_discount/execute', { method: 'POST', cookie: CL, body: { inputs: { price: 1 } } });
  check('permission: unauthorized user cannot execute (403)', limExec.status === 403, `HTTP ${limExec.status}`);

  // Version history present
  check('version history has 2 versions', (doc?.versions?.length || 0) === 2, `versions=${doc?.versions?.length}`);

  // Deactivate by archiving? Test that inactive (archived) activeVersion null blocks execution
  // Create a second code, leave draft, verify cannot execute
  await req('/api/v1/custom-code', { method: 'POST', cookie: CA, body: { name: 'draft_only', description: 'd', code: 'result=1;' } });
  const execDraft2 = await req('/api/v1/custom-code/draft_only/execute', { method: 'POST', cookie: CA, body: { inputs: {} } });
  check('draft-only code cannot execute', execDraft2.status >= 400, `HTTP ${execDraft2.status}`);

  // Test execution via vm timeout protection (infinite loop should fail)
  await req('/api/v1/custom-code', { method: 'POST', cookie: CA, body: { name: 'loop_code', description: 'l', code: 'while(true){}' } });
  await req('/api/v1/custom-code/loop_code/versions', { method: 'POST', cookie: CA, body: { code: 'while(true){}', changeNote: 'v2' } });
  await req('/api/v1/custom-code/loop_code/activate', { method: 'POST', cookie: CA, body: { version: 2 } });
  const execLoop = await req('/api/v1/custom-code/loop_code/execute', { method: 'POST', cookie: CA, body: { inputs: {} } });
  check('timeout protection blocks infinite loop', execLoop.status >= 400, `HTTP ${execLoop.status}`);

} catch (err) {
  console.error('TEST RUN ERROR:', err);
  check('test run completed without unexpected error', false, err.message);
} finally {
  try {
    if (tA) {
      await CustomCode.deleteMany({ tenantId: tA._id });
      await User.deleteMany({ tenantId: tA._id });
      await Role.deleteMany({ tenantId: tA._id });
      await Tenant.deleteOne({ _id: tA._id });
    }
    if (tB) {
      await CustomCode.deleteMany({ tenantId: tB._id });
      await User.deleteMany({ tenantId: tB._id });
      await Role.deleteMany({ tenantId: tB._id });
      await Tenant.deleteOne({ _id: tB._id });
    }
    await mongoose.connection.close();
  } catch (e) { console.error('cleanup', e.message); }
  server.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  process.exit(failed.length ? 1 : 0);
}
