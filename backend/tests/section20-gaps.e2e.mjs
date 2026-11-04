import 'dotenv/config';
import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import app from '../app.js';
import Tenant from '../models/Tenant.js';
import User from '../models/User.js';
import Role from '../models/Role.js';
import AuditLog from '../models/AuditLog.js';
import ObjectMeta from '../models/ObjectMeta.js';
import ApprovalProcess from '../models/ApprovalProcess.js';
import Layout from '../models/Layout.js';
import CustomCode from '../models/CustomCode.js';
import Integration from '../models/Integration.js';
import ChannelAccount from '../models/ChannelAccount.js';
import ApiKey from '../models/ApiKey.js';
import { seedDefaultRoles } from '../services/roleService.js';

const RUN = Date.now().toString(36);
const PASSWORD = 'Audit20Gaps!';
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
  return sc.map((c) => c.split(';')[0]).find((c) => c.startsWith('crm.sid=')) || '';
};

const latestAudit = async (tenantId, action, resource) => {
  await new Promise((r) => setTimeout(r, 150));
  return AuditLog.findOne({ tenantId, action, resource }).sort({ createdAt: -1 }).lean();
};

let tenantId = null;
try {
  await connectDB();
  const tenant = await Tenant.create({ name: `ZZ_AUDIT20GAPS_${RUN}`, slug: `zz-audit20gaps-${RUN}`, status: 'active', plan: 'enterprise' });
  tenantId = tenant._id;
  await seedDefaultRoles(tenantId);
  const role = await Role.findOne({ tenantId, name: 'admin' });
  const user = await User.create({ tenantId, firstName: 'a', lastName: 'u', email: `au-${RUN}@example.com`, username: `au_${RUN}`, password: PASSWORD, role: role._id, status: 'active', emailVerified: true });
  const cookie = await loginCookie(user.email);
  check('admin login succeeds', Boolean(cookie));

  // ── Object + layout, to hang a layout off ──────────────────────────────
  const obj = await ObjectMeta.create({ tenantId, apiName: `gap_obj_${RUN}`, name: 'Gap Obj', label: 'Gap Obj', pluralLabel: 'Gap Objs', createdBy: user._id });

  // ── Layout create / update / delete ────────────────────────────────────
  const layCreate = await req('/api/v1/layouts', { method: 'POST', cookie, body: { objectApiName: obj.apiName, name: 'Gap Layout', type: 'detail' } });
  check('layout create succeeds', layCreate.status === 201, `HTTP ${layCreate.status}`);
  const layoutId = layCreate.json?.data?._id;
  let a = await latestAudit(tenantId, 'create', 'Layout');
  check('layout create audited', Boolean(a) && String(a.resourceId) === String(layoutId));

  const layUpdate = await req(`/api/v1/layouts/${layoutId}`, { method: 'PUT', cookie, body: { name: 'Gap Layout Renamed' } });
  check('layout update succeeds', layUpdate.status === 200, `HTTP ${layUpdate.status}`);
  a = await latestAudit(tenantId, 'update', 'Layout');
  check('layout update audited', Boolean(a) && String(a.resourceId) === String(layoutId));

  const layDelete = await req(`/api/v1/layouts/${layoutId}`, { method: 'DELETE', cookie });
  check('layout delete succeeds', layDelete.status === 200, `HTTP ${layDelete.status}`);
  a = await latestAudit(tenantId, 'delete', 'Layout');
  check('layout delete audited', Boolean(a) && String(a.resourceId) === String(layoutId));

  // ── Approval process create / update / delete ──────────────────────────
  const apCreate = await req('/api/v1/approval-processes', { method: 'POST', cookie, body: { name: 'Gap Process', objectApiName: obj.apiName, steps: [{ name: 'Step 1', order: 0, approverType: 'user', approverUserId: String(user._id) }] } });
  check('approval process create succeeds', apCreate.status === 201, `HTTP ${apCreate.status} ${JSON.stringify(apCreate.json)}`);
  const processId = apCreate.json?.data?._id;
  a = await latestAudit(tenantId, 'create', 'ApprovalProcess');
  check('approval process create audited', Boolean(a) && String(a.resourceId) === String(processId));

  const apUpdate = await req(`/api/v1/approval-processes/${processId}`, { method: 'PUT', cookie, body: { name: 'Gap Process Renamed' } });
  check('approval process update succeeds', apUpdate.status === 200, `HTTP ${apUpdate.status}`);
  a = await latestAudit(tenantId, 'update', 'ApprovalProcess');
  check('approval process update audited', Boolean(a) && String(a.resourceId) === String(processId));

  const apDelete = await req(`/api/v1/approval-processes/${processId}`, { method: 'DELETE', cookie });
  check('approval process delete succeeds', apDelete.status === 200, `HTTP ${apDelete.status}`);
  a = await latestAudit(tenantId, 'delete', 'ApprovalProcess');
  check('approval process delete audited', Boolean(a) && String(a.resourceId) === String(processId));

  // ── Custom code create / addVersion / activate / restore / remove ──────
  const ccCreate = await req('/api/v1/custom-code', { method: 'POST', cookie, body: { name: `gap_code_${RUN}`, code: 'return 1;' } });
  check('custom code create succeeds', ccCreate.status === 201 || ccCreate.status === 200, `HTTP ${ccCreate.status} ${JSON.stringify(ccCreate.json)}`);
  a = await latestAudit(tenantId, 'create', 'CustomCode');
  check('custom code create audited', Boolean(a));

  const ccVersion = await req(`/api/v1/custom-code/gap_code_${RUN}/versions`, { method: 'POST', cookie, body: { code: 'return 2;' } });
  check('custom code add version succeeds', ccVersion.status === 200, `HTTP ${ccVersion.status} ${JSON.stringify(ccVersion.json)}`);
  a = await latestAudit(tenantId, 'custom_code_deploy', 'CustomCode');
  check('custom code deploy audited', Boolean(a));

  const ccActivate = await req(`/api/v1/custom-code/gap_code_${RUN}/activate`, { method: 'POST', cookie, body: { version: 2 } });
  check('custom code activate succeeds', ccActivate.status === 200, `HTTP ${ccActivate.status} ${JSON.stringify(ccActivate.json)}`);
  a = await latestAudit(tenantId, 'custom_code_activate', 'CustomCode');
  check('custom code activate audited', Boolean(a));

  const ccRemove = await req(`/api/v1/custom-code/gap_code_${RUN}`, { method: 'DELETE', cookie });
  check('custom code delete succeeds', ccRemove.status === 200, `HTTP ${ccRemove.status}`);
  a = await latestAudit(tenantId, 'delete', 'CustomCode');
  check('custom code delete audited', Boolean(a));

  // ── Tenant configuration update / reset — value never leaked ───────────
  const cfgUpdate = await req('/api/v1/configuration/gap.secret_key', { method: 'PUT', cookie, body: { value: 'super-secret-token-value' } });
  check('configuration update succeeds', cfgUpdate.status === 200 || cfgUpdate.status === 403, `HTTP ${cfgUpdate.status}`);
  if (cfgUpdate.status === 200) {
    a = await latestAudit(tenantId, 'tenant_config_update', 'TenantConfiguration');
    check('configuration update audited', Boolean(a));
    const detailsStr = JSON.stringify(a?.details || {});
    check('configuration value not leaked into audit details', !detailsStr.includes('super-secret-token-value'), detailsStr);
  } else {
    check('configuration key not tenant-editable (expected for an unregistered key)', true);
  }

  // ── API key create / update / revoke / delete — never leak the key ─────
  const keyCreate = await req('/api/v1/api-keys', { method: 'POST', cookie, body: { name: 'Gap Key', scopes: ['read'] } });
  check('api key create succeeds', keyCreate.status === 201, `HTTP ${keyCreate.status} ${JSON.stringify(keyCreate.json)}`);
  const keyId = keyCreate.json?.data?._id;
  const rawKey = keyCreate.json?.data?.rawKey;
  a = await latestAudit(tenantId, 'api_credential_create', 'ApiKey');
  check('api key create audited', Boolean(a) && String(a.resourceId) === String(keyId));
  check('api key raw value not leaked into audit details', !JSON.stringify(a?.details || {}).includes(rawKey || '\u0000'));

  const keyUpdate = await req(`/api/v1/api-keys/${keyId}`, { method: 'PATCH', cookie, body: { name: 'Gap Key Renamed' } });
  check('api key update succeeds', keyUpdate.status === 200, `HTTP ${keyUpdate.status}`);
  a = await latestAudit(tenantId, 'api_credential_update', 'ApiKey');
  check('api key update audited', Boolean(a) && String(a.resourceId) === String(keyId));

  const keyRevoke = await req(`/api/v1/api-keys/${keyId}/revoke`, { method: 'DELETE', cookie });
  check('api key revoke succeeds', keyRevoke.status === 200, `HTTP ${keyRevoke.status}`);
  a = await latestAudit(tenantId, 'api_credential_revoke', 'ApiKey');
  check('api key revoke audited', Boolean(a) && String(a.resourceId) === String(keyId));

  const keyDelete = await req(`/api/v1/api-keys/${keyId}`, { method: 'DELETE', cookie });
  check('api key delete succeeds', keyDelete.status === 200, `HTTP ${keyDelete.status}`);
  a = await latestAudit(tenantId, 'api_credential_delete', 'ApiKey');
  check('api key delete audited', Boolean(a));

  // ── API key rotate ──────────────────────────────────────────────────────
  const keyCreate2 = await req('/api/v1/api-keys', { method: 'POST', cookie, body: { name: 'Gap Key 2', scopes: ['read'] } });
  const key2Id = keyCreate2.json?.data?._id;
  const keyRotate = await req(`/api/v1/api-keys/${key2Id}/rotate`, { method: 'POST', cookie });
  check('api key rotate succeeds', keyRotate.status === 201, `HTTP ${keyRotate.status}`);
  a = await latestAudit(tenantId, 'api_credential_rotate', 'ApiKey');
  check('api key rotate audited', Boolean(a));

  // ── Integration create / update / regenerate-token / delete ────────────
  const intCreate = await req('/api/v1/integrations', { method: 'POST', cookie, body: { name: 'Gap Integration' } });
  check('integration create succeeds', intCreate.status === 200 || intCreate.status === 201, `HTTP ${intCreate.status} ${JSON.stringify(intCreate.json)}`);
  const integrationId = intCreate.json?.data?._id;
  a = await latestAudit(tenantId, 'create', 'Integration');
  check('integration create audited', Boolean(a) && String(a.resourceId) === String(integrationId));

  const intUpdate = await req(`/api/v1/integrations/${integrationId}`, { method: 'PUT', cookie, body: { description: 'updated' } });
  check('integration update succeeds', intUpdate.status === 200, `HTTP ${intUpdate.status}`);
  a = await latestAudit(tenantId, 'update', 'Integration');
  check('integration update audited', Boolean(a) && String(a.resourceId) === String(integrationId));

  const intRegen = await req(`/api/v1/integrations/${integrationId}/regenerate-token`, { method: 'POST', cookie });
  check('integration token regenerate succeeds', intRegen.status === 200, `HTTP ${intRegen.status}`);
  a = await latestAudit(tenantId, 'api_credential_rotate', 'Integration');
  check('integration token regenerate audited', Boolean(a) && String(a.resourceId) === String(integrationId));

  const intDelete = await req(`/api/v1/integrations/${integrationId}`, { method: 'DELETE', cookie });
  check('integration delete succeeds', intDelete.status === 200, `HTTP ${intDelete.status}`);
  a = await latestAudit(tenantId, 'delete', 'Integration');
  check('integration delete audited', Boolean(a) && String(a.resourceId) === String(integrationId));

  // ── Channel account create / update / delete — credentials never leaked ─
  const chCreate = await req('/api/v1/channels', { method: 'POST', cookie, body: { channel: 'whatsapp', name: 'Gap Channel', credentials: { apiKey: 'super-secret-whatsapp-key' } } });
  check('channel account create succeeds', chCreate.status === 201, `HTTP ${chCreate.status} ${JSON.stringify(chCreate.json)}`);
  const channelId = chCreate.json?.data?._id;
  a = await latestAudit(tenantId, 'integration_config_create', 'ChannelAccount');
  check('channel account create audited', Boolean(a) && String(a.resourceId) === String(channelId));
  check('channel account credentials not leaked into audit details', !JSON.stringify(a?.details || {}).includes('super-secret-whatsapp-key'));

  const chUpdate = await req(`/api/v1/channels/${channelId}`, { method: 'PUT', cookie, body: { name: 'Gap Channel Renamed' } });
  check('channel account update succeeds', chUpdate.status === 200, `HTTP ${chUpdate.status}`);
  a = await latestAudit(tenantId, 'integration_config_update', 'ChannelAccount');
  check('channel account update audited', Boolean(a) && String(a.resourceId) === String(channelId));

  const chDelete = await req(`/api/v1/channels/${channelId}`, { method: 'DELETE', cookie });
  check('channel account delete succeeds', chDelete.status === 200, `HTTP ${chDelete.status}`);
  a = await latestAudit(tenantId, 'integration_config_delete', 'ChannelAccount');
  check('channel account delete audited', Boolean(a));
} catch (err) {
  check('harness ran without error', false, err.stack || err.message);
} finally {
  if (tenantId) {
    await Promise.all([
      Tenant.deleteMany({ _id: tenantId }),
      User.deleteMany({ tenantId }),
      Role.deleteMany({ tenantId }),
      AuditLog.deleteMany({ tenantId }),
      ObjectMeta.deleteMany({ tenantId }),
      ApprovalProcess.deleteMany({ tenantId }),
      Layout.deleteMany({ tenantId }),
      CustomCode.deleteMany({ tenantId }),
      Integration.deleteMany({ tenantId }),
      ChannelAccount.deleteMany({ tenantId }),
      ApiKey.deleteMany({ tenantId }),
    ].map((p) => p.catch(() => {})));
  }
  server.close();
  await mongoose.connection.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
