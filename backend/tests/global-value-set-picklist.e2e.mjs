/**
 * global-value-set-picklist.e2e.mjs — linking a system picklist (Lead Status)
 * to a Global Value Set, and back to inline values.
 *
 * Boots the real Express app, seeds a tenant with a Lead object whose Status
 * field is a system picklist, and verifies that:
 *  - the field can be linked to a Global Value Set (values replaced by the set's)
 *  - a lead's Status can then be set to one of the set's values (kanban move)
 *  - updating the set fans the new values out to the field
 *  - the field can be unlinked again, keeping its values as inline values
 *  - other system-field properties stay locked
 *
 * Run: node tests/global-value-set-picklist.e2e.mjs   (from backend/)
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
import GlobalValueSet from '../models/GlobalValueSet.js';
import AuditLog from '../models/AuditLog.js';
import { seedDefaultRoles } from '../services/roleService.js';
import Workspace from '../models/Workspace.js';
import { seedWorkspace } from './helpers/workspace.mjs';

const RUN = Date.now().toString(36);
const PASSWORD = 'GvsTest123!';

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
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
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

const values = (field) => (field?.picklistValues || []).map((v) => v.value).join(',');

let tenantId = null;
const models = [User, Role, Session, ObjectMeta, FieldMeta, DynamicRecord, GlobalValueSet, AuditLog, Workspace];

try {
  await connectDB();

  const tenant = await Tenant.create({ name: `ZZ_GVS_${RUN}`, slug: `zz-gvs-${RUN}`, status: 'active', plan: 'enterprise' });
  tenantId = tenant._id;
  await seedDefaultRoles(tenantId);
  const roleAdmin = await Role.findOne({ tenantId, name: 'admin' });
  const admin = await User.create({
    tenantId, firstName: 'Gvs', lastName: 'Admin', email: `gvsadmin-${RUN}@example.com`,
    username: `gvsadmin_${RUN}`, password: PASSWORD, role: roleAdmin._id, status: 'active', emailVerified: true,
  });
  await seedWorkspace(tenantId, [admin._id], ['lead']);
  const cookie = await loginCookie(admin.email);
  check('admin can log in', Boolean(cookie));

  const leadObj = await ObjectMeta.create({
    tenantId, name: 'Lead', label: 'Lead', pluralLabel: 'Leads',
    apiName: 'lead', nameFieldApiName: 'name', isActive: true,
    kanbanConfig: { enabled: true, fieldApiName: 'status' },
  });
  await FieldMeta.create({ tenantId, objectId: leadObj._id, objectApiName: 'lead', name: 'name', label: 'Name', apiName: 'name', type: 'text' });
  await FieldMeta.create({
    tenantId, objectId: leadObj._id, objectApiName: 'lead', name: 'status', label: 'Status', apiName: 'status',
    type: 'picklist', isSystem: true,
    picklistValues: ['open', 'contacted', 'qualified'].map((v) => ({ label: v, value: v })),
  });

  const lead = await req('/api/v1/records/lead', { method: 'POST', cookie, body: { name: 'Acme lead', status: 'open' } });
  const leadId = lead.json?.data?._id || lead.json?.data?.id || lead.json?.data?.record?._id;
  check('lead created with inline status value', lead.status === 201 || lead.status === 200, `HTTP ${lead.status}`);

  const gvs = await req('/api/v1/global-value-sets', {
    method: 'POST', cookie,
    body: {
      name: `pipeline_${RUN}`, label: 'Pipeline Stages',
      values: [{ label: 'New', value: 'new' }, { label: 'Working', value: 'working' }, { label: 'Won', value: 'won' }],
    },
  });
  const gvsId = gvs.json?.data?._id;
  check('global value set created', Boolean(gvsId), `HTTP ${gvs.status}`);

  // The frontend sends exactly these keys for a system field.
  const link = await req('/api/v1/objects/lead/fields/status', {
    method: 'PUT', cookie,
    body: { label: 'Status', globalValueSetId: gvsId, picklistValues: [{ label: 'open', value: 'open' }] },
  });
  let field = await FieldMeta.findOne({ tenantId, objectApiName: 'lead', apiName: 'status' }).lean();
  check(
    'system Status field links to the global value set',
    link.status === 200 && String(field.globalValueSetId) === String(gvsId) && values(field) === 'new,working,won',
    `HTTP ${link.status} ${link.json?.message || ''} values=${values(field)}`,
  );

  if (leadId) {
    const move = await req(`/api/v1/records/lead/${leadId}`, { method: 'PATCH', cookie, body: { status: 'working' } });
    const rec = await DynamicRecord.findById(leadId).lean();
    const stored = rec?.status ?? rec?.data?.status;
    check('lead status can be set to a global value set value', move.status === 200 && stored === 'working', `HTTP ${move.status} ${move.json?.message || ''} status=${stored}`);
  } else {
    check('lead status can be set to a global value set value', false, 'no lead id');
  }

  const upd = await req(`/api/v1/global-value-sets/${gvsId}`, {
    method: 'PUT', cookie,
    body: { values: [{ label: 'New', value: 'new' }, { label: 'Working', value: 'working' }, { label: 'Won', value: 'won' }, { label: 'Lost', value: 'lost' }] },
  });
  field = await FieldMeta.findOne({ tenantId, objectApiName: 'lead', apiName: 'status' }).lean();
  check('updating the set updates the linked Status field', upd.status === 200 && values(field) === 'new,working,won,lost', `values=${values(field)}`);

  const locked = await req('/api/v1/objects/lead/fields/status', { method: 'PUT', cookie, body: { isRequired: true } });
  check('other system-field properties stay locked', locked.status === 403, `HTTP ${locked.status}`);

  const unlink = await req('/api/v1/objects/lead/fields/status', {
    method: 'PUT', cookie,
    body: { label: 'Status', globalValueSetId: null, picklistValues: field.picklistValues.map(({ label, value }) => ({ label, value })) },
  });
  field = await FieldMeta.findOne({ tenantId, objectApiName: 'lead', apiName: 'status' }).lean();
  check(
    'Status field can be unlinked and keeps its values inline',
    unlink.status === 200 && !field.globalValueSetId && values(field) === 'new,working,won,lost',
    `HTTP ${unlink.status} gvs=${field.globalValueSetId} values=${values(field)}`,
  );
} catch (err) {
  check('test harness ran without error', false, err.message);
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
