import 'dotenv/config';
import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import app from '../app.js';
import Tenant from '../models/Tenant.js';
import User from '../models/User.js';
import Role from '../models/Role.js';
import Session from '../models/Session.js';
import AuditLog from '../models/AuditLog.js';
import { seedDefaultRoles } from '../services/roleService.js';

const RUN = Date.now().toString(36);
const PASSWORD = 'Audit123!';
const results = [];
const check = (name, pass, detail='') => { results.push({name,pass,detail}); console.log(`${pass?'PASS':'FAIL'}  ${name}${detail?`  (${detail})`:''}`); };

const server = app.listen(0);
await new Promise(r => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
const req = async (path, {method='GET', cookie, body}={}) => {
  const res = await fetch(`${base}${path}`, { method, headers: {'Content-Type':'application/json', ...(cookie?{Cookie:cookie}:{})}, body: body?JSON.stringify(body):undefined });
  let json=null; try{json=await res.json();}catch{}
  return {status:res.status, json};
};
const loginCookie = async (username) => {
  const res = await fetch(`${base}/api/v1/auth/login`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({username, password:PASSWORD}) });
  const sc = res.headers.getSetCookie?.() || [];
  return sc.map(c=>c.split(';')[0]).find(c=>c.startsWith('crm.sid=')) || '';
};

let tenantId=null;
try {
  await connectDB();
  const tenant = await Tenant.create({ name:`ZZ_AUDIT_${RUN}`, slug:`zz-audit-${RUN}`, status:'active', plan:'enterprise' });
  tenantId = tenant._id;
  await seedDefaultRoles(tenantId);
  const role = await Role.findOne({ tenantId, name:'admin' });
  const user = await User.create({ tenantId, firstName:'aud', lastName:'user', email:`aud-${RUN}@example.com`, username:`aud_${RUN}`, password:PASSWORD, role: role._id, status:'active', emailVerified:true });
  const cookie = await loginCookie(user.username);
  check('login succeeds', Boolean(cookie));
  // wait a moment for audit write
  await new Promise(r=>setTimeout(r,200));
  const logs = await req('/api/v1/admin/logs', { cookie });
  check('admin can list audit logs', logs.status===200, `HTTP ${logs.status}`);
  const loginEntry = (logs.json?.data?.items || logs.json?.data || []).find(l => l.action === 'login');
  check('login event was audited', Boolean(loginEntry), `found=${Boolean(loginEntry)}`);
} catch (err) {
  check('harness ran without error', false, err.message);
} finally {
  if (tenantId) {
    await Tenant.deleteMany({ _id: tenantId });
    await Promise.all([User, Role, Session, AuditLog].map(M => M.deleteMany({ tenantId }).catch(()=>{})));
  }
  server.close();
  await mongoose.connection.close();
}
const failed = results.filter(r=>!r.pass);
console.log(`\n${results.length-failed.length}/${results.length} checks passed`);
process.exit(failed.length?1:0);
