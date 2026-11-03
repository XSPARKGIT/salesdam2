/**
 * section10-search-views.e2e.mjs — BRD §10 Global Search, List Views, Kanban & Calendar.
 *
 * Creates a brand-new custom object ("Project Milestone") and verifies:
 *  - Search: custom objects are searchable, appear in global search
 *  - List Views: default views auto-derive columns from field metadata
 *  - Kanban: generic kanban works when calendarConfig enabled on custom object
 *  - Calendar: calendarConfig on ObjectMeta enables calendar view
 *
 * Run: node tests/section10-search-views.e2e.mjs   (from backend/)
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
import ListView from '../models/ListView.js';
import Workspace from '../models/Workspace.js';
import AuditLog from '../models/AuditLog.js';
import RecentlyViewed from '../models/RecentlyViewed.js';
import { seedDefaultRoles } from '../services/roleService.js';
import { seedWorkspace } from './helpers/workspace.mjs';

const RUN = Date.now().toString(36);
const PASSWORD = 'Sec10Test!';

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
const models = [User, Role, Session, ObjectMeta, FieldMeta, DynamicRecord, ListView, Workspace, AuditLog, RecentlyViewed];

try {
  await connectDB();

  // ── Seed tenant + admin ──────────────────────────────────────────────────
  const tenant = await Tenant.create({
    name: `ZZ_S10_${RUN}`,
    slug: `zz-s10-${RUN}`,
    status: 'active',
    plan: 'enterprise',
  });
  tenantId = tenant._id;
  await seedDefaultRoles(tenantId);

  const roleAdmin = await Role.findOne({ tenantId, name: 'admin' });

  const admin = await User.create({
    tenantId, firstName: 'Ten', lastName: 'Admin',
    email: `s10adm-${RUN}@example.com`,
    username: `s10adm_${RUN}`, password: PASSWORD,
    role: roleAdmin._id, status: 'active', emailVerified: true,
  });

  const adminCookie = await loginCookie(admin.email);
  check('admin logs in', Boolean(adminCookie));

  // ── 1. Create a custom object: "Project Milestone" ──────────────────────
  let r = await req('/api/v1/objects', {
    method: 'POST',
    cookie: adminCookie,
    body: {
      label: 'Project Milestone',
      name: 'Project Milestone',
      apiName: `milestone_${RUN}`,
      pluralLabel: 'Project Milestones',
      description: 'Test object for Section 10',
      showInNav: true,
      searchable: true,
    },
  });
  check('custom object created', r.status === 201, r.json?.message);
  const objApiName = `milestone_${RUN}`;

  // Add the custom object to workspace
  await seedWorkspace(tenantId, [admin._id], [objApiName]);
  // Re-login to pick up workspace
  const adminCookie2 = await loginCookie(admin.email);

  // ── 2. Create custom fields ──────────────────────────────────────────────
  const fieldDefs = [
    { label: 'Due Date', apiName: 'due_date', type: 'date', isSearchable: false },
    { label: 'Status', apiName: 'status', type: 'picklist', picklistValues: [
      { label: 'Not Started', value: 'not_started', isActive: true },
      { label: 'In Progress', value: 'in_progress', isActive: true },
      { label: 'Done', value: 'done', isActive: true },
    ]},
    { label: 'Priority', apiName: 'priority', type: 'picklist', picklistValues: [
      { label: 'Low', value: 'low', isActive: true },
      { label: 'Medium', value: 'medium', isActive: true },
      { label: 'High', value: 'high', isActive: true },
    ]},
    { label: 'Description', apiName: 'milestone_desc', type: 'textarea' },
    { label: 'Budget', apiName: 'budget', type: 'currency' },
  ];

  for (const fd of fieldDefs) {
    r = await req(`/api/v1/objects/${objApiName}/fields`, {
      method: 'POST',
      cookie: adminCookie2,
      body: fd,
    });
    check(`field "${fd.label}" created`, r.status === 201, `status=${r.status}`);
  }

  // ── 3. Enable Kanban view on custom object ──────────────────────────────
  r = await req(`/api/v1/objects/${objApiName}`, {
    method: 'PUT',
    cookie: adminCookie2,
    body: {
      kanbanConfig: { enabled: true, fieldApiName: 'status' },
    },
  });
  check('kanban enabled on custom object', r.status === 200);

  r = await req(`/api/v1/objects/${objApiName}`, { cookie: adminCookie2 });
  const objAfterKanban = r.json?.data;
  check('kanbanConfig persisted', objAfterKanban?.kanbanConfig?.enabled === true && objAfterKanban?.kanbanConfig?.fieldApiName === 'status');

  // ── 4. Enable Calendar view on custom object ────────────────────────────
  r = await req(`/api/v1/objects/${objApiName}`, {
    method: 'PUT',
    cookie: adminCookie2,
    body: {
      calendarConfig: { enabled: true, dateFieldApiName: 'due_date', titleFieldApiName: 'name' },
    },
  });
  check('calendar enabled on custom object', r.status === 200);

  r = await req(`/api/v1/objects/${objApiName}`, { cookie: adminCookie2 });
  const objAfterCal = r.json?.data;
  check('calendarConfig persisted', objAfterCal?.calendarConfig?.enabled === true && objAfterCal?.calendarConfig?.dateFieldApiName === 'due_date');
  check('calendarConfig titleField persisted', objAfterCal?.calendarConfig?.titleFieldApiName === 'name');

  // ── 5. Calendar validation: reject non-date field ───────────────────────
  r = await req(`/api/v1/objects/${objApiName}`, {
    method: 'PUT',
    cookie: adminCookie2,
    body: {
      calendarConfig: { enabled: true, dateFieldApiName: 'status' },
    },
  });
  check('calendar rejects non-date field', r.status === 400);

  // ── 6. Calendar validation: reject non-existent field ───────────────────
  r = await req(`/api/v1/objects/${objApiName}`, {
    method: 'PUT',
    cookie: adminCookie2,
    body: {
      calendarConfig: { enabled: true, dateFieldApiName: 'nonexistent_field' },
    },
  });
  check('calendar rejects non-existent field', r.status === 400);

  // ── 7. Create test records ──────────────────────────────────────────────
  const recordData = [
    { name: 'Alpha Launch', due_date: '2026-11-15', status: 'in_progress', priority: 'high', budget: 50000 },
    { name: 'Beta Review', due_date: '2026-11-20', status: 'not_started', priority: 'medium', budget: 25000 },
    { name: 'Final Release', due_date: '2026-12-01', status: 'not_started', priority: 'high', budget: 100000 },
  ];

  const recordIds = [];
  for (const data of recordData) {
    r = await req(`/api/v1/records/${objApiName}`, {
      method: 'POST',
      cookie: adminCookie2,
      body: data,
    });
    check(`record "${data.name}" created`, r.status === 201);
    recordIds.push(r.json?.data?._id);
  }

  // Wait for text index to update
  await new Promise((resolve) => setTimeout(resolve, 500));

  // ── 8. Global search finds custom object records ────────────────────────
  r = await req(`/api/v1/search?q=Alpha+Launch`, { cookie: adminCookie2 });
  check('global search returns results', r.status === 200);
  const searchRecords = r.json?.data?.records || [];
  const foundAlpha = searchRecords.some((rec) => rec.recordName === 'Alpha Launch' || rec.data?.name === 'Alpha Launch');
  check('global search finds "Alpha Launch"', foundAlpha, `found ${searchRecords.length} records`);

  // ── 9. Search respects searchable flag ──────────────────────────────────
  r = await req(`/api/v1/objects/${objApiName}`, {
    method: 'PUT',
    cookie: adminCookie2,
    body: { searchable: false },
  });
  check('set searchable=false', r.status === 200);

  r = await req(`/api/v1/search?q=Alpha+Launch`, { cookie: adminCookie2 });
  const afterDisable = r.json?.data?.records || [];
  const foundAfterDisable = afterDisable.some((rec) =>
    (rec.objectApiName === objApiName) && (rec.recordName === 'Alpha Launch' || rec.data?.name === 'Alpha Launch')
  );
  check('search excludes non-searchable object', !foundAfterDisable);

  // Re-enable
  await req(`/api/v1/objects/${objApiName}`, {
    method: 'PUT',
    cookie: adminCookie2,
    body: { searchable: true },
  });

  // ── 10. List views auto-derive columns for custom object ────────────────
  r = await req(`/api/v1/list-views/${objApiName}`, { cookie: adminCookie2 });
  check('list views returned', r.status === 200);
  const views = r.json?.data || [];
  check('default views exist (All, Recently Viewed, My Records)', views.length >= 3);

  const allView = views.find((v) => v.key === 'all');
  check('"All" view exists', !!allView);
  check('"All" view has derived columns', allView?.columns?.length > 0, `columns: ${allView?.columns?.join(', ')}`);
  // The derived columns should NOT include textarea types
  check('derived columns exclude textarea', !allView?.columns?.includes('milestone_desc'));

  // ── 11. Records endpoint returns view with columns ──────────────────────
  r = await req(`/api/v1/records/${objApiName}?view=all`, { cookie: adminCookie2 });
  check('records with view returns data', r.status === 200);
  const viewResult = r.json?.data?.view || r.json?.view;
  check('records response includes resolved view', !!viewResult);
  check('resolved view has columns', viewResult?.columns?.length > 0);

  // ── 12. User can create a custom list view ──────────────────────────────
  r = await req(`/api/v1/list-views/${objApiName}`, {
    method: 'POST',
    cookie: adminCookie2,
    body: {
      name: 'High Priority',
      filters: [{ field: 'priority', operator: 'eq', value: 'high' }],
      columns: ['name', 'due_date', 'status', 'budget'],
      sortField: 'due_date',
      sortOrder: 'asc',
    },
  });
  check('custom list view created', r.status === 201);
  const customViewId = r.json?.data?._id;

  // Fetch records with custom view
  r = await req(`/api/v1/records/${objApiName}?view=${customViewId}`, { cookie: adminCookie2 });
  check('records filtered by custom view', r.status === 200);
  const filteredRecords = r.json?.data?.records || [];
  check('custom view filters correctly (only high priority)', filteredRecords.every(
    (rec) => rec.data?.priority === 'high' || rec.priority === 'high'
  ));

  // ── 13. Suggest endpoint works for custom objects ───────────────────────
  r = await req(`/api/v1/search/suggest?q=Beta&objectApiName=${objApiName}`, { cookie: adminCookie2 });
  check('suggest endpoint works', r.status === 200);

  // ── 14. Kanban validation: picklist field required ──────────────────────
  r = await req(`/api/v1/objects/${objApiName}`, {
    method: 'PUT',
    cookie: adminCookie2,
    body: {
      kanbanConfig: { enabled: true, fieldApiName: 'budget' },
    },
  });
  check('kanban rejects non-picklist field', r.status === 400);

  // ── 15. Calendar disable clears config ──────────────────────────────────
  r = await req(`/api/v1/objects/${objApiName}`, {
    method: 'PUT',
    cookie: adminCookie2,
    body: {
      calendarConfig: { enabled: false },
    },
  });
  check('calendar disable succeeds', r.status === 200);
  r = await req(`/api/v1/objects/${objApiName}`, { cookie: adminCookie2 });
  check('disabled calendar clears dateFieldApiName', !r.json?.data?.calendarConfig?.dateFieldApiName || r.json?.data?.calendarConfig?.dateFieldApiName === '');

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
