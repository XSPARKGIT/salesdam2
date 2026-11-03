/**
 * system-permissions.e2e.mjs — BRD 9.3 System Permissions.
 *
 * Boots the real Express app and verifies:
 *  - System permissions on Profiles (Roles) control access to admin routes
 *  - Permission Sets can grant additional system permissions
 *  - Effective permissions = Role ∪ Permission Sets (additive)
 *  - Users cannot self-grant permissions they don't have
 *  - Each permission is independently enforced
 *  - Permission separation: one permission does not imply another
 *  - Superuser/admin bypass all checks
 *
 * Run: node tests/system-permissions.e2e.mjs   (from backend/)
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import app from '../app.js';
import Tenant from '../models/Tenant.js';
import User from '../models/User.js';
import Role from '../models/Role.js';
import Session from '../models/Session.js';
import PermissionSet from '../models/PermissionSet.js';
import ObjectMeta from '../models/ObjectMeta.js';
import FieldMeta from '../models/FieldMeta.js';
import Workspace from '../models/Workspace.js';
import AuditLog from '../models/AuditLog.js';
import { seedDefaultRoles } from '../services/roleService.js';
import { seedWorkspace } from './helpers/workspace.mjs';

const RUN = Date.now().toString(36);
const PASSWORD = 'SysPerm123!';

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

let tenantId = null;
const models = [User, Role, Session, PermissionSet, ObjectMeta, FieldMeta, Workspace, AuditLog];

try {
  await connectDB();

  // ── Seed tenant, roles, admin + limited user ─────────────────────────────
  const tenant = await Tenant.create({
    name: `ZZ_SYSPERM_${RUN}`,
    slug: `zz-sysperm-${RUN}`,
    status: 'active',
    plan: 'enterprise',
  });
  tenantId = tenant._id;
  await seedDefaultRoles(tenantId);

  const roleAdmin = await Role.findOne({ tenantId, name: 'admin' });
  const roleStd = await Role.findOne({ tenantId, name: 'standard_user' });

  const admin = await User.create({
    tenantId, firstName: 'Sys', lastName: 'Admin',
    email: `sysadm-${RUN}@example.com`,
    username: `sysadm_${RUN}`, password: PASSWORD,
    role: roleAdmin._id, status: 'active', emailVerified: true,
  });

  const limited = await User.create({
    tenantId, firstName: 'Sys', lastName: 'Limited',
    email: `syslim-${RUN}@example.com`,
    username: `syslim_${RUN}`, password: PASSWORD,
    role: roleStd._id, status: 'active', emailVerified: true,
  });

  await seedWorkspace(tenantId, [admin._id, limited._id]);

  const adminCookie = await loginCookie(admin.email);
  const limitedCookie = await loginCookie(limited.email);
  check('admin logs in', Boolean(adminCookie));
  check('limited user logs in', Boolean(limitedCookie));

  // ── 1. Admin has all permissions (bypass) ─────────────────────────────────
  let r = await req('/api/v1/admin/logs', { cookie: adminCookie });
  check('admin can view audit logs', r.status === 200);

  r = await req('/api/v1/admin/export?objectApiName=lead', { cookie: adminCookie });
  check('admin can export data', r.status === 200 || r.status === 400);

  // ── 2. Limited user denied without permission ────────────────────────────
  r = await req('/api/v1/admin/logs', { cookie: limitedCookie });
  check('limited user denied audit logs', r.status === 403);

  r = await req('/api/v1/admin/export?objectApiName=lead', { cookie: limitedCookie });
  check('limited user denied export', r.status === 403);

  r = await req('/api/v1/users', { cookie: limitedCookie });
  check('limited user denied manage users', r.status === 403);

  r = await req('/api/v1/custom-code', { cookie: limitedCookie });
  check('limited user denied manage custom code', r.status === 403);

  r = await req('/api/v1/approval-processes', { cookie: limitedCookie });
  check('limited user denied manage approvals', r.status === 403);

  r = await req('/api/v1/admin/settings', { cookie: limitedCookie });
  check('limited user denied manage tenant settings', r.status === 403);

  // ── 3. Grant specific permission via Role ────────────────────────────────
  // Create a custom role with only canViewAuditLog
  const customRole = await Role.create({
    tenantId,
    name: `audit_viewer_${RUN}`,
    label: 'Audit Viewer',
    appPermissions: { canViewAuditLog: true },
    dataAccess: 'all',
  });

  limited.role = customRole._id;
  await limited.save();

  // Need new session — re-login
  const limitedCookie2 = await loginCookie(limited.email);
  check('limited user logs in with custom role', Boolean(limitedCookie2));

  r = await req('/api/v1/admin/logs', { cookie: limitedCookie2 });
  check('audit viewer CAN view audit logs', r.status === 200);

  r = await req('/api/v1/users', { cookie: limitedCookie2 });
  check('audit viewer CANNOT manage users', r.status === 403);

  r = await req('/api/v1/admin/export?objectApiName=lead', { cookie: limitedCookie2 });
  check('audit viewer CANNOT export data', r.status === 403);

  r = await req('/api/v1/admin/settings', { cookie: limitedCookie2 });
  check('audit viewer CANNOT manage tenant settings', r.status === 403);

  // ── 4. Permission Set grants additional permissions ──────────────────────
  const permSet = await PermissionSet.create({
    tenantId,
    name: `export_grant_${RUN}`,
    label: 'Export Grant',
    systemPermissions: { canExportData: true, canManageUsers: true },
    assignedUserIds: [limited._id],
  });

  // Re-login to pick up permission set
  const limitedCookie3 = await loginCookie(limited.email);

  r = await req('/api/v1/admin/export?objectApiName=lead', { cookie: limitedCookie3 });
  check('permission set grants export data', r.status === 200 || r.status === 400);

  r = await req('/api/v1/users', { cookie: limitedCookie3 });
  check('permission set grants manage users', r.status === 200);

  // The role permission still works too
  r = await req('/api/v1/admin/logs', { cookie: limitedCookie3 });
  check('role permission still works alongside permission set', r.status === 200);

  // But permissions NOT granted by either still blocked
  r = await req('/api/v1/custom-code', { cookie: limitedCookie3 });
  check('ungrantated permission still blocked', r.status === 403);

  r = await req('/api/v1/admin/settings', { cookie: limitedCookie3 });
  check('manage settings still blocked', r.status === 403);

  // ── 5. Permission separation ─────────────────────────────────────────────
  // canManageCustomCode should NOT grant canDeployCustomCode
  const codeRole = await Role.create({
    tenantId,
    name: `code_mgr_${RUN}`,
    label: 'Code Manager',
    appPermissions: { canManageCustomCode: true },
    dataAccess: 'all',
  });
  limited.role = codeRole._id;
  await limited.save();

  const limitedCookie4 = await loginCookie(limited.email);

  r = await req('/api/v1/custom-code', { cookie: limitedCookie4 });
  check('canManageCustomCode grants custom code access', r.status === 200);

  r = await req('/api/v1/custom-code/test/activate', { method: 'POST', cookie: limitedCookie4 });
  check('canManageCustomCode does NOT grant deploy (activate)', r.status === 403 || r.status === 404);

  // canManageUsers should NOT grant canManageRoles
  const userMgrRole = await Role.create({
    tenantId,
    name: `user_mgr_${RUN}`,
    label: 'User Manager',
    appPermissions: { canManageUsers: true },
    dataAccess: 'all',
  });
  limited.role = userMgrRole._id;
  await limited.save();

  const limitedCookie5 = await loginCookie(limited.email);

  r = await req('/api/v1/users', { cookie: limitedCookie5 });
  check('canManageUsers grants user list', r.status === 200);

  r = await req('/api/v1/roles', { method: 'POST', cookie: limitedCookie5, body: { name: 'test', label: 'Test' } });
  check('canManageUsers does NOT grant create role', r.status === 403);

  r = await req('/api/v1/permission-sets', { cookie: limitedCookie5 });
  check('canManageUsers does NOT grant permission set access', r.status === 403);

  // canViewAuditLog should NOT grant modify audit logs (there is no modify route — just verify read works)
  // canExportData should NOT grant canImportData
  const exportOnlyRole = await Role.create({
    tenantId,
    name: `export_only_${RUN}`,
    label: 'Export Only',
    appPermissions: { canExportData: true },
    dataAccess: 'all',
  });
  limited.role = exportOnlyRole._id;
  await limited.save();

  const limitedCookie6 = await loginCookie(limited.email);

  r = await req('/api/v1/admin/export?objectApiName=lead', { cookie: limitedCookie6 });
  check('canExportData grants export', r.status === 200 || r.status === 400);

  r = await req('/api/v1/admin/import', { method: 'POST', cookie: limitedCookie6 });
  check('canExportData does NOT grant import', r.status === 403);

  // ── 6. Self-grant prevention ─────────────────────────────────────────────
  // The user_mgr user tries to add canManageRoles to their own role
  limited.role = userMgrRole._id;
  await limited.save();
  const limitedCookie7 = await loginCookie(limited.email);

  r = await req(`/api/v1/roles/${userMgrRole._id}`, {
    method: 'PUT',
    cookie: limitedCookie7,
    body: { appPermissions: { canManageUsers: true, canManageRoles: true } },
  });
  check('self-grant prevention: cannot add canManageRoles they lack', r.status === 403);

  // ── 7. Effective permissions in getMe ────────────────────────────────────
  // Give limited user a role with canViewAuditLog + permSet with canExportData
  limited.role = customRole._id; // canViewAuditLog only
  await limited.save();
  // Re-assign perm set to limited user
  permSet.assignedUserIds = [limited._id];
  await permSet.save();

  const limitedCookie8 = await loginCookie(limited.email);
  r = await req('/api/v1/auth/me', { cookie: limitedCookie8 });
  const ep = r.json?.data?.user?.effectivePermissions;
  check(
    'getMe returns effective permissions with both role and permSet grants',
    ep?.canViewAuditLog === true && ep?.canExportData === true && ep?.canManageUsers === true,
    `canViewAuditLog=${ep?.canViewAuditLog} canExportData=${ep?.canExportData} canManageUsers=${ep?.canManageUsers}`,
  );
  check(
    'effective permissions does NOT include ungrantated perms',
    ep?.canManageCustomCode !== true && ep?.canDeployCustomCode !== true,
  );

  // ── 8. Permission changes take effect without re-auth ────────────────────
  // (The user already has a session. Change their role perms and verify immediately.)
  customRole.appPermissions.canManageTenantSettings = true;
  await customRole.save();

  r = await req('/api/v1/admin/settings', { cookie: limitedCookie8 });
  check('permission change takes effect without re-login', r.status === 200);

  // Remove it again
  customRole.appPermissions.canManageTenantSettings = false;
  await customRole.save();

  r = await req('/api/v1/admin/settings', { cookie: limitedCookie8 });
  check('revoked permission takes effect without re-login', r.status === 403);

  // ── 9. Permission Set CRUD via API ───────────────────────────────────────
  // Admin can create, update, delete permission sets
  r = await req('/api/v1/permission-sets', {
    method: 'POST',
    cookie: adminCookie,
    body: {
      label: 'Test Set',
      systemPermissions: { canManageApprovals: true },
      assignedUserIds: [limited._id.toString()],
    },
  });
  check('admin can create permission set with system permissions', r.status === 201);
  const newSetId = r.json?.data?._id;

  r = await req(`/api/v1/permission-sets/${newSetId}`, { cookie: adminCookie });
  check('permission set has systemPermissions stored', r.json?.data?.systemPermissions?.canManageApprovals === true);

  r = await req(`/api/v1/permission-sets/${newSetId}`, {
    method: 'PUT',
    cookie: adminCookie,
    body: { systemPermissions: { canManageApprovals: false, canImportData: true } },
  });
  check('admin can update permission set system permissions', r.status === 200);

  r = await req(`/api/v1/permission-sets/${newSetId}`, { cookie: adminCookie });
  check('updated permissions persisted', r.json?.data?.systemPermissions?.canImportData === true && !r.json?.data?.systemPermissions?.canManageApprovals);

  // ── 10. Profiles (Roles) CRUD with new permissions ──────────────────────
  r = await req('/api/v1/roles', {
    method: 'POST',
    cookie: adminCookie,
    body: {
      name: `full_test_${RUN}`,
      label: 'Full Test',
      appPermissions: {
        canCustomizeApplication: true,
        canManageLayouts: true,
        canManageApprovals: true,
        canManageCustomCode: true,
        canDeployCustomCode: true,
        canExportData: true,
        canImportData: true,
        canViewCallRecordings: true,
        canManageCommunicationTemplates: true,
        canManageDocumentTemplates: true,
      },
    },
  });
  check('admin can create role with new system permissions', r.status === 201);
  const newRoleData = r.json?.data;
  check('new role has new permissions stored', newRoleData?.appPermissions?.canManageApprovals === true && newRoleData?.appPermissions?.canDeployCustomCode === true);

  // ── 11. Regression: existing permissions still work ──────────────────────
  r = await req('/api/v1/admin/logs', { cookie: adminCookie });
  check('regression: admin still sees audit logs', r.status === 200);

  r = await req('/api/v1/roles', { cookie: adminCookie });
  check('regression: admin still sees roles', r.status === 200);

  r = await req('/api/v1/users', { cookie: adminCookie });
  check('regression: admin still manages users', r.status === 200);

  r = await req('/api/v1/webhooks', { cookie: adminCookie });
  check('regression: admin still manages webhooks', r.status === 200);

} catch (err) {
  check('test harness ran without error', false, err.stack || err.message);
} finally {
  if (tenantId) {
    await Tenant.deleteMany({ _id: tenantId });
    await Promise.all(models.map((M) => M.deleteMany({ tenantId }).catch(() => {})));
  }
  server.close();
  await mongoose.connection.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
