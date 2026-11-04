/**
 * section20-validation-rule-audit.e2e.mjs — BRD §20.1 Validation Rule
 * changes must produce distinct, searchable Audit Trail entries, not just
 * a generic ObjectMeta 'update' event.
 *
 * Boots the real Express app and verifies, through the real PUT
 * /api/v1/objects/:apiName persistence flow (validationRules is a
 * sub-array on ObjectMeta, there is no separate validation-rule route):
 *  - creating a rule produces a 'validation_rule_create' AuditLog entry
 *  - modifying a rule produces 'validation_rule_update' identifying the rule
 *  - deleting a rule produces 'validation_rule_delete'
 *  - an unrelated field change (no validationRules in the body) produces no
 *    validation_rule_* event
 *  - an unchanged rule sitting alongside a genuinely changed one produces no
 *    event for itself
 *  - a rejected (invalid formula) save produces no success audit event
 *  - tenant/user attribution is correct
 *  - sensitive-looking expression/errorMessage text is never echoed into the
 *    audit details for an update (only the fact that it changed)
 *  - the generic ObjectMeta 'update' event still fires alongside
 *  - every entry is actually persisted in AuditLog, not just returned by the API
 *
 * Run: node tests/section20-validation-rule-audit.e2e.mjs   (from backend/)
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import app from '../app.js';
import Tenant from '../models/Tenant.js';
import User from '../models/User.js';
import Role from '../models/Role.js';
import ObjectMeta from '../models/ObjectMeta.js';
import AuditLog from '../models/AuditLog.js';
import { seedDefaultRoles } from '../services/roleService.js';

const RUN = Date.now().toString(36);
const PASSWORD = 'VRAudit123!';
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
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const findAudit = async (query) => { await wait(150); return AuditLog.find(query).sort({ createdAt: 1 }).lean(); };
const countAll = async (tenantId) => AuditLog.countDocuments({ tenantId, resource: 'ValidationRule' });

let tenantId = null;
let tenantBId = null;
try {
  await connectDB();
  const tenant = await Tenant.create({ name: `ZZ_VRAUDIT_${RUN}`, slug: `zz-vraudit-${RUN}`, status: 'active', plan: 'enterprise' });
  tenantId = tenant._id;
  await seedDefaultRoles(tenantId);
  const role = await Role.findOne({ tenantId, name: 'admin' });
  const user = await User.create({ tenantId, firstName: 'v', lastName: 'r', email: `vr-${RUN}@example.com`, username: `vr_${RUN}`, password: PASSWORD, role: role._id, status: 'active', emailVerified: true });
  const cookie = await loginCookie(user.email);
  check('admin login succeeds', Boolean(cookie));

  const tenantB = await Tenant.create({ name: `ZZ_VRAUDIT_B_${RUN}`, slug: `zz-vraudit-b-${RUN}`, status: 'active', plan: 'enterprise' });
  tenantBId = tenantB._id;

  const obj = await ObjectMeta.create({ tenantId, apiName: `vr_obj_${RUN}`, name: 'VR Obj', label: 'VR Obj', pluralLabel: 'VR Objs', createdBy: user._id });
  const apiName = obj.apiName;

  // ── 1. Create a rule ────────────────────────────────────────────────────
  const rule1 = { name: 'Amount Required', description: 'blocks blank amount', expression: 'ISBLANK(amount)', errorMessage: 'Amount is required', errorField: '', isActive: true };
  const createRes = await req(`/api/v1/objects/${apiName}`, { method: 'PUT', cookie, body: { validationRules: [rule1] } });
  check('rule create request succeeds', createRes.status === 200, `HTTP ${createRes.status} ${createRes.text}`);
  const storedRule1 = createRes.json?.data?.validationRules?.[0];
  check('created rule has a stable _id', Boolean(storedRule1?._id));

  let entries = await findAudit({ tenantId, resource: 'ValidationRule', action: 'validation_rule_create' });
  check('exactly one validation_rule_create event written', entries.length === 1, `count=${entries.length}`);
  const createEvt = entries[0];
  check('create event identifies the rule by resourceId', String(createEvt?.resourceId) === String(storedRule1?._id));
  check('create event names the rule', createEvt?.details?.name === 'Amount Required');
  check('create event has correct objectApiName', createEvt?.objectApiName === apiName);
  check('create event has correct tenant attribution', String(createEvt?.tenantId) === String(tenantId));
  check('create event has correct user attribution', String(createEvt?.userId) === String(user._id));
  check('create event is persisted in AuditLog collection', Boolean(await AuditLog.findById(createEvt._id)));

  // Generic ObjectMeta update event should still fire alongside.
  const genericEntries1 = await findAudit({ tenantId, resource: 'ObjectMeta', action: 'update', resourceId: String(obj._id) });
  check('generic ObjectMeta update event still fires for this save', genericEntries1.length >= 1, `count=${genericEntries1.length}`);

  // ── 2. Modify the rule, with sensitive-looking text in the long fields ──
  const sensitiveExpr = 'amount < 0 || api_key == "sk_live_should_never_appear_in_audit"';
  const sensitiveMsg = 'Reject: token sk_live_should_never_appear_in_audit is invalid';
  const rule1Updated = { ...storedRule1, expression: sensitiveExpr, errorMessage: sensitiveMsg };
  const updateRes = await req(`/api/v1/objects/${apiName}`, { method: 'PUT', cookie, body: { validationRules: [rule1Updated] } });
  check('rule update request succeeds', updateRes.status === 200, `HTTP ${updateRes.status} ${updateRes.text}`);

  entries = await findAudit({ tenantId, resource: 'ValidationRule', action: 'validation_rule_update' });
  check('exactly one validation_rule_update event written', entries.length === 1, `count=${entries.length}`);
  const updateEvt = entries[0];
  check('update event identifies the same rule', String(updateEvt?.resourceId) === String(storedRule1?._id));
  check('update event lists expression and errorMessage as changed', (updateEvt?.details?.changedFields || []).includes('expression') && updateEvt.details.changedFields.includes('errorMessage'));
  const detailsStr = JSON.stringify(updateEvt?.details || {});
  check('sensitive expression text is not echoed into audit details', !detailsStr.includes('sk_live_should_never_appear_in_audit'), detailsStr);

  // ── 3. Add a second rule; the first (unchanged) must not get an event ──
  const rule2 = { name: 'Name Required', expression: 'ISBLANK(name)', errorMessage: 'Name is required', errorField: '', isActive: true };
  const beforeUpdateCount = (await findAudit({ tenantId, resource: 'ValidationRule', action: 'validation_rule_update' })).length;
  const addRes = await req(`/api/v1/objects/${apiName}`, { method: 'PUT', cookie, body: { validationRules: [rule1Updated, rule2] } });
  check('second rule add request succeeds', addRes.status === 200, `HTTP ${addRes.status} ${addRes.text}`);
  const storedRule2 = addRes.json?.data?.validationRules?.find((r) => r.name === 'Name Required');

  entries = await findAudit({ tenantId, resource: 'ValidationRule', action: 'validation_rule_create' });
  check('second rule produced its own create event', entries.length === 2, `count=${entries.length}`);
  const afterUpdateCount = (await findAudit({ tenantId, resource: 'ValidationRule', action: 'validation_rule_update' })).length;
  check('unchanged first rule produced no additional update event', afterUpdateCount === beforeUpdateCount, `before=${beforeUpdateCount} after=${afterUpdateCount}`);

  // ── 4. Delete the first rule ─────────────────────────────────────────────
  // Re-send rule2 with the _id the server actually assigned it, so it is
  // recognized as the same rule rather than a brand-new one.
  const deleteRes = await req(`/api/v1/objects/${apiName}`, { method: 'PUT', cookie, body: { validationRules: [storedRule2] } });
  check('rule delete request succeeds', deleteRes.status === 200, `HTTP ${deleteRes.status} ${deleteRes.text}`);
  entries = await findAudit({ tenantId, resource: 'ValidationRule', action: 'validation_rule_delete' });
  check('exactly one validation_rule_delete event written', entries.length === 1, `count=${entries.length}`);
  check('delete event identifies the deleted rule', String(entries[0]?.resourceId) === String(storedRule1?._id));
  check('delete event names the deleted rule', entries[0]?.details?.name === 'Amount Required');

  // ── 5. Unrelated ObjectMeta update must not touch validation-rule events ─
  const beforeAnyVRCount = await countAll(tenantId);
  const labelRes = await req(`/api/v1/objects/${apiName}`, { method: 'PUT', cookie, body: { label: 'VR Obj Renamed' } });
  check('unrelated label update succeeds', labelRes.status === 200, `HTTP ${labelRes.status}`);
  const afterAnyVRCount = await countAll(tenantId);
  check('unrelated ObjectMeta update produced no validation-rule event', afterAnyVRCount === beforeAnyVRCount, `before=${beforeAnyVRCount} after=${afterAnyVRCount}`);
  const genericEntries2 = await findAudit({ tenantId, resource: 'ObjectMeta', action: 'update', resourceId: String(obj._id) });
  check('generic ObjectMeta update event fired for the unrelated change too', genericEntries2.length > genericEntries1.length);

  // ── 6. A rejected save (invalid formula) must not write a success event ─
  const beforeFailCount = await countAll(tenantId);
  const badRule = { name: 'Broken Rule', expression: 'amount >', errorMessage: 'broken', errorField: '', isActive: true };
  const failRes = await req(`/api/v1/objects/${apiName}`, { method: 'PUT', cookie, body: { validationRules: [storedRule2, badRule] } });
  check('invalid formula is rejected', failRes.status === 400, `HTTP ${failRes.status}`);
  const afterFailCount = await countAll(tenantId);
  check('rejected save produced no validation-rule audit event', afterFailCount === beforeFailCount, `before=${beforeFailCount} after=${afterFailCount}`);

  // ── 7. Tenant isolation ──────────────────────────────────────────────────
  const crossTenantEntries = await AuditLog.find({ tenantId: tenantBId, resource: 'ValidationRule' }).lean();
  check('no validation-rule audit events leaked into another tenant', crossTenantEntries.length === 0, `count=${crossTenantEntries.length}`);
} catch (err) {
  check('harness ran without error', false, err.stack || err.message);
} finally {
  if (tenantId) {
    await Promise.all([
      Tenant.deleteMany({ _id: { $in: [tenantId, tenantBId].filter(Boolean) } }),
      User.deleteMany({ tenantId }),
      Role.deleteMany({ tenantId }),
      AuditLog.deleteMany({ tenantId: { $in: [tenantId, tenantBId].filter(Boolean) } }),
      ObjectMeta.deleteMany({ tenantId }),
    ].map((p) => p.catch(() => {})));
  }
  server.close();
  await mongoose.connection.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
