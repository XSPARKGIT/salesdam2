import 'dotenv/config';
import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import app from '../app.js';
import Tenant from '../models/Tenant.js';
import User from '../models/User.js';
import Role from '../models/Role.js';
import TenantConfiguration from '../models/TenantConfiguration.js';
import { seedWorkspace } from './helpers/workspace.mjs';

const RUN = Date.now().toString(36);
const PASSWORD = 'Cfg14Test!';
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
  tA = await Tenant.create({ name: `ZZ_CFGA_${RUN}`, slug: `zz-cfga-${RUN}`, status: 'active', plan: 'enterprise' });
  tB = await Tenant.create({ name: `ZZ_CFGB_${RUN}`, slug: `zz-cfgb-${RUN}`, status: 'active', plan: 'enterprise' });

  const adminRoleA = await Role.create({ tenantId: tA._id, name: 'admin', label: 'Admin', dataAccess: 'all', objectPermissions: [], appPermissions: { canManageTenantSettings: true } });
  const adminRoleB = await Role.create({ tenantId: tB._id, name: 'admin', label: 'Admin', dataAccess: 'all', objectPermissions: [], appPermissions: { canManageTenantSettings: true } });
  const adminA = await User.create({ tenantId: tA._id, firstName: 'AdminA', lastName: 'Test', email: `admina-${RUN}@example.com`, username: `admina_${RUN}`, password: PASSWORD, role: adminRoleA._id, status: 'active', emailVerified: true });
  const adminB = await User.create({ tenantId: tB._id, firstName: 'AdminB', lastName: 'Test', email: `adminb-${RUN}@example.com`, username: `adminb_${RUN}`, password: PASSWORD, role: adminRoleB._id, status: 'active', emailVerified: true });

  await seedWorkspace(tA._id, [adminA._id], []);
  await seedWorkspace(tB._id, [adminB._id], []);

  const loginA = await loginCookie(adminA.email);
  const loginB = await loginCookie(adminB.email);
  const CA = loginA.cookie, CB = loginB.cookie;
  check('admins auth', loginA.status === 200 && loginB.status === 200);

  // Tenant A sets branding override
  const setBrand = await req('/api/v1/configuration/branding.primary_color', { method: 'PUT', cookie: CA, body: { value: '#FF0000' } });
  check('tenant A can set branding override', setBrand.status === 200, `HTTP ${setBrand.status}`);

  // Tenant A sets secret
  const setSecret = await req('/api/v1/configuration/integration.email.smtp_password', { method: 'PUT', cookie: CA, body: { value: 'supersecret123' } });
  check('tenant A can set secret', setSecret.status === 200, `HTTP ${setSecret.status}`);

  // Secret encrypted at rest
  const secretDoc = await TenantConfiguration.findOne({ tenantId: tA._id, key: 'integration.email.smtp_password' }).lean();
  check('secret encrypted at rest', secretDoc?.value?.startsWith('enc:'), `stored=${secretDoc?.value?.slice(0,6)}`);

  // Effective config for A: branding overridden, secret masked
  const cfgA = await req('/api/v1/configuration', { cookie: CA });
  const brandA = cfgA.json?.data?.find((e) => e.key === 'branding.primary_color');
  const secretA = cfgA.json?.data?.find((e) => e.key === 'integration.email.smtp_password');
  check('tenant A branding override applied', brandA?.value === '#FF0000' && brandA?.source === 'tenant', JSON.stringify(brandA));
  check('secret masked in API response', secretA?.value === '••••••••', `value=${secretA?.value}`);

  // Tenant B does not see A's override
  const cfgB = await req('/api/v1/configuration', { cookie: CB });
  const brandB = cfgB.json?.data?.find((e) => e.key === 'branding.primary_color');
  check('tenant B branding uses default (not A override)', brandB?.value !== '#FF0000', `value=${brandB?.value}`);
  const secretB = cfgB.json?.data?.find((e) => e.key === 'integration.email.smtp_password');
  check('tenant B secret not leaked', secretB?.value !== '••••••••' || secretB?.value === '', `value=${secretB?.value}`);

  // Reset A branding override -> falls back to default
  const resetBrand = await req('/api/v1/configuration/branding.primary_color', { method: 'DELETE', cookie: CA });
  check('reset override succeeds', resetBrand.status === 200, `HTTP ${resetBrand.status}`);
  const cfgA2 = await req('/api/v1/configuration', { cookie: CA });
  const brandA2 = cfgA2.json?.data?.find((e) => e.key === 'branding.primary_color');
  check('after reset falls back to default', brandA2?.value === '#0066FF', `value=${brandA2?.value}`);

  // System default update affects tenant without override
  // Need superuser: make adminA superuser? Use existing admin role name 'superuser' approach: create superuser role
  const suRole = await Role.create({ tenantId: tA._id, name: 'superuser', label: 'Superuser', dataAccess: 'all', objectPermissions: [], appPermissions: {} });
  const su = await User.create({ tenantId: tA._id, firstName: 'Super', lastName: 'User', email: `su-${RUN}@example.com`, username: `su_${RUN}`, password: PASSWORD, role: suRole._id, status: 'active', emailVerified: true });
  await seedWorkspace(tA._id, [su._id], []);
  const loginSU = await loginCookie(su.email);
  const CSU = loginSU.cookie;
  check('superuser auth', loginSU.status === 200);

  const setDefault = await req('/api/v1/configuration/defaults/branding.primary_color', { method: 'PUT', cookie: CSU, body: { value: '#00FF00' } });
  check('superuser can set system default', setDefault.status === 200, `HTTP ${setDefault.status}`);

  // Tenant B (no override) should see new default
  const cfgB2 = await req('/api/v1/configuration', { cookie: CB });
  const brandB2 = cfgB2.json?.data?.find((e) => e.key === 'branding.primary_color');
  check('system default propagates to tenant without override', brandB2?.value === '#00FF00', `value=${brandB2?.value}`);

  // Tenant admin cannot set system default
  const tenantSetDefault = await req('/api/v1/configuration/defaults/branding.primary_color', { method: 'PUT', cookie: CA, body: { value: '#000000' } });
  check('tenant admin cannot set system default (403)', tenantSetDefault.status === 403, `HTTP ${tenantSetDefault.status}`);

  // Tenant admin cannot read other tenant's config (tenant isolation)
  // (already implied by tenant-scoped queries)

  // Reset system default cleanup
  await req('/api/v1/configuration/defaults/branding.primary_color', { method: 'DELETE', cookie: CSU });

} catch (err) {
  console.error('TEST RUN ERROR:', err);
  check('test run completed without unexpected error', false, err.message);
} finally {
  try {
    for (const t of [tA, tB]) {
      if (t) {
        const tid = t._id;
        await Promise.all([
          TenantConfiguration.deleteMany({ tenantId: tid }),
          TenantConfiguration.deleteMany({ tenantId: null, key: { $regex: '^branding\\.' } }),
          User.deleteMany({ tenantId: tid }),
          Role.deleteMany({ tenantId: tid }),
          Tenant.deleteOne({ _id: tid }),
        ]);
      }
    }
    await mongoose.connection.close();
  } catch (e) { console.error('cleanup', e.message); }
  server.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  process.exit(failed.length ? 1 : 0);
}
