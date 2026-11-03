/**
 * action-buttons.e2e.mjs — BRD 4.4 Actions & Buttons.
 *
 * Boots the real Express app and verifies, through the API:
 *  - the previously hardcoded buttons (Convert to Deal, Generate Quote,
 *    Convert to Order, …) are seeded as configuration, once — a deleted
 *    default is not added back
 *  - each action is wired to a Flow, a screen flow or a platform action, and
 *    mismatched or invalid configuration is rejected
 *  - conditional display: Convert to Order is configured for Stage = closed_won
 *    and the server refuses to run it for a record that doesn't match
 *  - saving a deal as Closed Won no longer converts it automatically; the
 *    Convert to Order action does, once
 *  - running an action respects object permissions and record visibility
 *
 * Run: node tests/action-buttons.e2e.mjs   (from backend/)
 * Exits non-zero if any check fails.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import app from '../app.js';
import Tenant from '../models/Tenant.js';
import User from '../models/User.js';
import Role from '../models/Role.js';
import Session from '../models/Session.js';
import ObjectMeta from '../models/ObjectMeta.js';
import FieldMeta from '../models/FieldMeta.js';
import DynamicRecord from '../models/DynamicRecord.js';
import Automation from '../models/Automation.js';
import AuditLog from '../models/AuditLog.js';
import Workspace from '../models/Workspace.js';
import AutoNumberCounter from '../models/AutoNumberCounter.js';
import { seedDefaultRoles } from '../services/roleService.js';
import { ensureDefaultActions } from '../services/actionService.js';
import { seedWorkspace } from './helpers/workspace.mjs';

const RUN = Date.now().toString(36);
const PASSWORD = 'ActionTest123!';

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
const models = [User, Role, Session, ObjectMeta, FieldMeta, DynamicRecord, Automation, AuditLog, Workspace, AutoNumberCounter];

try {
  await connectDB();

  const tenant = await Tenant.create({ name: `ZZ_ACT_${RUN}`, slug: `zz-act-${RUN}`, status: 'active', plan: 'enterprise' });
  tenantId = tenant._id;
  await seedDefaultRoles(tenantId);
  const roleAdmin = await Role.findOne({ tenantId, name: 'admin' });
  const perm = (objectApiName, u) => ({ objectApiName, canCreate: true, canRead: true, canUpdate: u, canDelete: false });
  const roleRep = await Role.create({
    tenantId, name: `rep_${RUN}`, label: 'Rep', dataAccess: 'own',
    objectPermissions: [perm('deal', true), perm('order', true), perm('lead', true)],
  });
  const roleViewer = await Role.create({
    tenantId, name: `viewer_${RUN}`, label: 'Viewer', dataAccess: 'all',
    objectPermissions: [perm('deal', false), perm('order', false), perm('lead', false)],
  });

  const mkUser = (key, role) => User.create({
    tenantId, firstName: 'Act', lastName: key, email: `act-${key}-${RUN}@example.com`,
    username: `act_${key}_${RUN}`, password: PASSWORD, role: role._id, status: 'active', emailVerified: true,
  });
  const adminU = await mkUser('admin', roleAdmin);
  const repU = await mkUser('rep', roleRep);
  const viewerU = await mkUser('viewer', roleViewer);
  await seedWorkspace(tenantId, [adminU._id, repU._id, viewerU._id], ['deal', 'order', 'lead']);
  const adminC = await loginCookie(adminU.email);
  const repC = await loginCookie(repU.email);
  const viewerC = await loginCookie(viewerU.email);
  check('users can log in', Boolean(adminC && repC && viewerC));

  const mkObject = async (apiName, label, fields) => {
    const obj = await ObjectMeta.create({
      tenantId, name: label, label, pluralLabel: `${label}s`, apiName, nameFieldApiName: 'name', isActive: true,
    });
    await FieldMeta.create(fields.map((f) => ({ tenantId, objectId: obj._id, objectApiName: apiName, name: f.apiName, ...f })));
    return obj;
  };
  const dealObj = await mkObject('deal', 'Deal', [
    { apiName: 'name', label: 'Name', type: 'text' },
    { apiName: 'stage', label: 'Stage', type: 'picklist',
      picklistValues: ['open', 'closed_won', 'closed_lost'].map((v) => ({ label: v, value: v, isActive: true })) },
    { apiName: 'is_converted', label: 'Converted', type: 'boolean' },
    { apiName: 'converted_order', label: 'Converted Order', type: 'text' },
  ]);
  await mkObject('order', 'Order', [
    { apiName: 'name', label: 'Name', type: 'text' },
    { apiName: 'converted_deal', label: 'Converted Deal', type: 'text' },
  ]);
  await mkObject('lead', 'Lead', [
    { apiName: 'name', label: 'Name', type: 'text' },
    { apiName: 'is_converted', label: 'Converted', type: 'boolean' },
  ]);

  // ── Defaults seeded as configuration ─────────────────────────────────────
  const added = await ensureDefaultActions(tenantId);
  const again = await ensureDefaultActions(tenantId);
  const dealButtons = () => ObjectMeta.findOne({ tenantId, apiName: 'deal' }).lean().then((o) => o.actionButtons);
  let buttons = await dealButtons();
  const convertBtn = buttons.find((b) => b.systemKey === 'deal.convert_to_order');
  const quoteBtn = buttons.find((b) => b.systemKey === 'deal.generate_quote');
  check('hardcoded buttons are seeded as configured actions', added > 0 && Boolean(convertBtn) && Boolean(quoteBtn), `added=${added}`);
  check('seeding twice adds nothing', again === 0, `second run added ${again}`);
  check(
    'Convert to Order is a platform action shown only when Stage = closed_won',
    convertBtn?.actionType === 'native' && convertBtn?.nativeAction === 'convert_deal_to_order' &&
      convertBtn?.conditions?.some((c) => c.field === 'stage' && c.operator === 'eq' && c.value === 'closed_won'),
    JSON.stringify(convertBtn?.conditions),
  );
  const leadButtons = (await ObjectMeta.findOne({ tenantId, apiName: 'lead' }).lean()).actionButtons;
  check('lead gets Convert to Deal and Submit for Approval actions',
    ['convert_lead_to_deal', 'submit_lead_for_approval'].every((n) => leadButtons.some((b) => b.nativeAction === n)),
    leadButtons.map((b) => b.label).join(', '));

  // ── Configuring actions ──────────────────────────────────────────────────
  const screenFlow = await Automation.create({
    tenantId, apiName: `collect_${RUN}`, name: 'Collect details', type: 'screen_flow',
    nodes: [{ id: 'n1', type: 'trigger', label: 'Start' }],
  });
  const autoFlow = await Automation.create({
    tenantId, apiName: `notify_${RUN}`, name: 'Notify team', type: 'autolaunched',
    nodes: [{ id: 'n1', type: 'trigger', label: 'Start' }],
  });
  const create = (cookie, body, obj = 'deal') => req(`/api/v1/action-buttons/${obj}`, { method: 'POST', cookie, body });

  let r = await create(adminC, {
    label: 'Collect details', actionType: 'screen_flow', automationId: screenFlow._id,
    conditions: [{ field: 'stage', operator: 'eq', value: 'open' }],
  });
  check('admin adds a screen-flow action with a condition', r.status === 201 && r.json?.data?.actionType === 'screen_flow' && r.json?.data?.conditions?.length === 1, `HTTP ${r.status} ${r.json?.message || ''}`);
  const screenBtnId = r.json?.data?._id;

  r = await create(adminC, { label: 'Notify', actionType: 'flow', automationId: autoFlow._id });
  check('admin adds a flow action', r.status === 201 && r.json?.data?.actionType === 'flow', `HTTP ${r.status} ${r.json?.message || ''}`);

  r = await create(adminC, { label: 'Clone', actionType: 'native', nativeAction: 'clone_record', location: 'both' });
  check('a platform action is limited to the record page', r.status === 201 && r.json?.data?.location === 'record_detail', `HTTP ${r.status} location=${r.json?.data?.location}`);

  const bad = async (label, body, obj) => {
    const res = await create(adminC, { label: 'Bad', ...body }, obj);
    check(`rejects ${label}`, res.status === 400, `HTTP ${res.status} ${res.json?.message || ''}`);
  };
  await bad('a platform action from another object', { actionType: 'native', nativeAction: 'convert_deal_to_order' }, 'lead');
  await bad('a screen flow wired as a plain flow', { actionType: 'flow', automationId: screenFlow._id });
  await bad('a plain flow wired as a screen flow', { actionType: 'screen_flow', automationId: autoFlow._id });
  await bad('a condition on an unknown field', { actionType: 'native', nativeAction: 'clone_record', conditions: [{ field: 'nope', operator: 'eq', value: 'x' }] });
  await bad('an equals condition with no value', { actionType: 'native', nativeAction: 'clone_record', conditions: [{ field: 'stage', operator: 'eq', value: '' }] });

  r = await create(repC, { label: 'Sneaky', actionType: 'native', nativeAction: 'clone_record' });
  check('a non-admin cannot configure actions', r.status === 403, `HTTP ${r.status}`);

  r = await req(`/api/v1/action-buttons/deal/${screenBtnId}`, {
    method: 'PUT', cookie: adminC, body: { conditions: [{ field: 'stage', operator: 'neq', value: 'closed_lost' }] },
  });
  check('editing only the conditions keeps the wired flow', r.status === 200 && r.json?.data?.actionType === 'screen_flow' && String(r.json?.data?.automationId) === String(screenFlow._id) && r.json?.data?.conditions?.[0]?.operator === 'neq', `HTTP ${r.status} ${r.json?.message || ''}`);

  // ── Closed Won no longer converts on save ────────────────────────────────
  const mkDeal = async (owner, stage) => {
    const d = new DynamicRecord({ tenantId, objectId: dealObj._id, objectApiName: 'deal', ownerId: owner._id, createdBy: owner._id, lastModifiedBy: owner._id });
    d.setField('name', `Deal ${stage}`);
    d.setField('stage', stage);
    await d.save();
    return d;
  };
  const deal = await mkDeal(repU, 'open');
  const run = (cookie, recordId, btnId = convertBtn._id) =>
    req(`/api/v1/action-buttons/deal/${btnId}/run`, { method: 'POST', cookie, body: { recordId } });

  r = await run(repC, deal._id);
  check('Convert to Order is refused while Stage is not closed_won', r.status === 409, `HTTP ${r.status} ${r.json?.message || ''}`);

  const patch = await req(`/api/v1/records/deal/${deal._id}`, { method: 'PATCH', cookie: repC, body: { stage: 'closed_won' } });
  const ordersAfterSave = await DynamicRecord.countDocuments({ tenantId, objectApiName: 'order' });
  check('saving a deal as Closed Won no longer creates an order by itself', patch.status === 200 && ordersAfterSave === 0, `PATCH ${patch.status} orders=${ordersAfterSave}`);

  r = await run(viewerC, deal._id);
  check('a user who cannot edit deals cannot run Convert to Order', r.status === 403, `HTTP ${r.status}`);

  const adminsDeal = await mkDeal(adminU, 'closed_won');
  r = await run(repC, adminsDeal._id);
  check('a user cannot run an action on a record they cannot see', r.status === 404, `HTTP ${r.status}`);

  r = await run(repC, deal._id);
  const order = await DynamicRecord.findOne({ tenantId, objectApiName: 'order' }).lean();
  const converted = await DynamicRecord.findById(deal._id).lean();
  check(
    'Convert to Order creates the order and marks the deal converted',
    r.status === 200 && Boolean(order) && converted?.data?.is_converted === true && r.json?.data?.navigate?.recordId === String(order?._id),
    `HTTP ${r.status} ${r.json?.message || ''}`,
  );

  r = await run(repC, deal._id);
  const orderCount = await DynamicRecord.countDocuments({ tenantId, objectApiName: 'order' });
  check('it cannot run twice on the same deal', r.status === 409 && orderCount === 1, `HTTP ${r.status} orders=${orderCount}`);

  r = await run(repC, deal._id, quoteBtn._id);
  check('client-side actions cannot be run through the server endpoint', r.status === 400, `HTTP ${r.status}`);

  // The qualifying stage is configuration, not hardcoded: point the condition
  // at another stage and that stage converts.
  await req(`/api/v1/action-buttons/deal/${convertBtn._id}`, {
    method: 'PUT', cookie: adminC,
    body: { conditions: [{ field: 'stage', operator: 'eq', value: 'closed_lost' }, { field: 'is_converted', operator: 'neq', value: 'true' }] },
  });
  const lostDeal = await mkDeal(repU, 'closed_lost');
  const wonDeal = await mkDeal(repU, 'closed_won');
  const lostRun = await run(repC, lostDeal._id);
  const wonRun = await run(repC, wonDeal._id);
  check('changing the condition changes which deals can convert', lostRun.status === 200 && wonRun.status === 409, `closed_lost ${lostRun.status}, closed_won ${wonRun.status}`);

  // ── A deleted default stays deleted ──────────────────────────────────────
  const del = await req(`/api/v1/action-buttons/deal/${quoteBtn._id}`, { method: 'DELETE', cookie: adminC });
  const reAdded = await ensureDefaultActions(tenantId);
  buttons = await dealButtons();
  check('a deleted default button is not added back', del.status === 200 && reAdded === 0 && !buttons.some((b) => b.systemKey === 'deal.generate_quote'), `DELETE ${del.status} re-added=${reAdded}`);
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
