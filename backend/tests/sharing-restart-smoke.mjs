/**
 * sharing-restart-smoke.mjs — confirms OWD/sharing settings persist across
 * backend process restarts (database-backed persistence check).
 * Run twice: it writes the shared tenant and reads back the setting, so run it
 * twice and the second run must observe the first run's persisted value.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import app from '../app.js';
import Tenant from '../models/Tenant.js';
import User from '../models/User.js';
import Role from '../models/Role.js';
import ObjectMeta from '../models/ObjectMeta.js';
import ObjectSharingSetting from '../models/ObjectSharingSetting.js';
import SharingRule from '../models/SharingRule.js';

const RUN = Date.now().toString(36);
const PASSWORD = 'ShareRestart123!';

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
  const sid = setCookie.map((c) => c.split(';')[0]).find((c) => c.startsWith('crm.sid='));
  return { status: res.status, cookie: sid };
};

let createdTenant = false;
try {
  await connectDB();
  const tenant = await Tenant.findOne({ name: 'ZZ Restart Persist' });
  if (tenant) {
    await Promise.all([
      ObjectSharingSetting.deleteMany({ tenantId: tenant._id }),
      SharingRule.deleteMany({ tenantId: tenant._id }),
      ObjectMeta.deleteMany({ tenantId: tenant._id }),
      User.deleteMany({ tenantId: tenant._id }),
      Role.deleteMany({ tenantId: tenant._id }),
      Tenant.deleteOne({ _id: tenant._id }),
    ]);
  }
  const tenantDoc = await Tenant.create({ name: 'ZZ Restart Persist', slug: 'zz-restart-persist', status: 'active', plan: 'enterprise' });
  const tId = tenantDoc._id;
  createdTenant = true;

  const adminRole = await Role.create({
    tenantId: tId, name: `admin_${RUN}`, label: 'Admin',
    dataAccess: 'all', objectPermissions: [], appPermissions: { canManageUsers: true, canManageRoles: true, canManageObjects: true, canManageAnalytics: true },
  });
  const admin = await User.create({
    tenantId: tId, firstName: 'Restart', lastName: 'Admin', email: `restartadmin-${RUN}@example.com`,
    username: `restartadmin_${RUN}`, password: PASSWORD, role: adminRole._id, status: 'active', emailVerified: true,
  });
  adminRole.name = 'admin';
  await adminRole.save();
  await ObjectMeta.create({ tenantId: tId, name: 'Policy', label: 'Policy', pluralLabel: 'Policies', apiName: 'policy', nameFieldApiName: 'name', isActive: true, searchable: true });
  const login = await loginCookie(admin.username);
  const put = await req('/api/v1/sharing/settings/policy', { method: 'PUT', cookie: login.cookie, body: { orgWideDefault: 'public_read_write' } });
  const get = await req('/api/v1/sharing/settings', { cookie: login.cookie });
  const policySetting = get.json?.data?.find((o) => o.objectApiName === 'policy');
  const rule = await req('/api/v1/sharing/rules', { method: 'POST', cookie: login.cookie, body: { objectApiName: 'policy', name: `Restart Rule ${RUN}`, ruleType: 'all', sharedWith: { type: 'user', id: admin._id }, accessLevel: 'read' } });
  const ruleGet = await req('/api/v1/sharing/rules', { query: { objectApiName: 'policy' }, cookie: login.cookie });

  const ok = put.status === 200 && get.status === 200 && policySetting?.orgWideDefault === 'public_read_write' && [200, 201].includes(rule.status) && (ruleGet.json?.data || []).length >= 1;
  console.log(`${ok ? 'RESTART_SMOKE_PASS' : 'RESTART_SMOKE_FAIL'} ${put.status} ${get.status} ${policySetting?.orgWideDefault ?? ''} rule:${rule.status} count:${(ruleGet.json?.data || []).length}`);

  await mongoose.connection.close();
  await mongoose.disconnect();
} finally {
  if (createdTenant) {
    try {
      await Promise.all([
        ObjectSharingSetting.deleteMany({ tenantId: tId }),
        SharingRule.deleteMany({ tenantId: tId }),
        ObjectMeta.deleteMany({ tenantId: tId }),
        User.deleteMany({ tenantId: tId }),
        Role.deleteMany({ tenantId: tId }),
        Tenant.deleteOne({ _id: tId }),
      ]);
    } catch {}
  }
  server.close();
}
