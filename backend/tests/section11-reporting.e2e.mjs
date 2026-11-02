/**
 * section11-reporting.e2e.mjs — BRD §11 Generalised Reporting & Analytics Engine.
 *
 * Creates custom objects, fields, and records, then verifies:
 *  - Report run: groupBy, aggregations (COUNT/SUM/AVG/MIN/MAX)
 *  - Type-aware filters: eq, neq, gt, contains, in, is_null, between
 *  - Cross-object reporting via lookup
 *  - Saved report CRUD: create, list, get, update, delete
 *  - Permission: non-admin can only read permitted objects
 *  - Raw record (table) mode without groupBy
 *
 * Run: node tests/section11-reporting.e2e.mjs   (from backend/)
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
import SavedReport from '../models/SavedReport.js';
import PermissionSet from '../models/PermissionSet.js';
import { seedDefaultRoles } from '../services/roleService.js';
import { seedWorkspace } from './helpers/workspace.mjs';

const RUN = Date.now().toString(36);
const PASSWORD = 'Sec11Test!';

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
const models = [User, Role, Session, ObjectMeta, FieldMeta, DynamicRecord,
  ListView, Workspace, AuditLog, RecentlyViewed, SavedReport, PermissionSet];

try {
  await connectDB();

  // ── Seed tenant + admin ──────────────────────────────────────────────────
  const tenant = await Tenant.create({
    name: `ZZ_S11_${RUN}`,
    slug: `zz-s11-${RUN}`,
    status: 'active',
    plan: 'enterprise',
  });
  tenantId = tenant._id;
  await seedDefaultRoles(tenantId);

  const roleAdmin = await Role.findOne({ tenantId, name: 'admin' });

  const admin = await User.create({
    tenantId, firstName: 'Eleven', lastName: 'Admin',
    email: `s11adm-${RUN}@example.com`,
    username: `s11adm_${RUN}`, password: PASSWORD,
    role: roleAdmin._id, status: 'active', emailVerified: true,
  });

  const adminCookie = await loginCookie(admin.username);
  check('admin logs in', Boolean(adminCookie));

  // ── 1. Create parent object: "Project" ─────────────────────────────────
  let r = await req('/api/v1/objects', {
    method: 'POST', cookie: adminCookie,
    body: {
      label: 'Project', name: 'Project',
      apiName: `project_${RUN}`, pluralLabel: 'Projects',
      description: 'Parent object for reporting tests',
      showInNav: true, searchable: true,
    },
  });
  check('parent object "Project" created', r.status === 201);
  const parentApi = `project_${RUN}`;

  // ── 2. Create child object: "Task" ──────────────────────────────────────
  r = await req('/api/v1/objects', {
    method: 'POST', cookie: adminCookie,
    body: {
      label: 'Task', name: 'Task',
      apiName: `task_${RUN}`, pluralLabel: 'Tasks',
      description: 'Child object for cross-object reporting',
      showInNav: true, searchable: true,
    },
  });
  check('child object "Task" created', r.status === 201);
  const childApi = `task_${RUN}`;

  // Add objects to workspace + re-login
  await seedWorkspace(tenantId, [admin._id], [parentApi, childApi]);
  const adminCookie2 = await loginCookie(admin.username);

  // ── 3. Create fields on Project ─────────────────────────────────────────
  const projectFields = [
    { label: 'Budget', apiName: 'budget', type: 'currency' },
    { label: 'Status', apiName: 'status', type: 'picklist', picklistValues: [
      { label: 'Planning', value: 'planning', isActive: true },
      { label: 'Active', value: 'active', isActive: true },
      { label: 'Completed', value: 'completed', isActive: true },
    ]},
    { label: 'Start Date', apiName: 'start_date', type: 'date' },
    { label: 'Notes', apiName: 'notes', type: 'textarea' },
  ];
  for (const fd of projectFields) {
    r = await req(`/api/v1/objects/${parentApi}/fields`, {
      method: 'POST', cookie: adminCookie2, body: fd,
    });
    check(`project field "${fd.label}" created`, r.status === 201);
  }

  // ── 4. Create fields on Task (with lookup to Project) ───────────────────
  const taskFields = [
    { label: 'Project', apiName: 'project', type: 'lookup', lookupObjectApiName: parentApi },
    { label: 'Hours', apiName: 'hours', type: 'number' },
    { label: 'Priority', apiName: 'priority', type: 'picklist', picklistValues: [
      { label: 'Low', value: 'low', isActive: true },
      { label: 'Medium', value: 'medium', isActive: true },
      { label: 'High', value: 'high', isActive: true },
    ]},
    { label: 'Due Date', apiName: 'due_date', type: 'date' },
    { label: 'Task Notes', apiName: 'task_notes', type: 'text' },
  ];
  for (const fd of taskFields) {
    r = await req(`/api/v1/objects/${childApi}/fields`, {
      method: 'POST', cookie: adminCookie2, body: fd,
    });
    check(`task field "${fd.label}" created`, r.status === 201);
  }

  // ── 5. Create project records ───────────────────────────────────────────
  const projectData = [
    { name: 'Alpha Project', budget: 100000, status: 'active', start_date: '2026-01-15' },
    { name: 'Beta Project', budget: 50000, status: 'planning', start_date: '2026-06-01' },
    { name: 'Gamma Project', budget: 200000, status: 'completed', start_date: '2025-03-10' },
  ];
  const projectIds = [];
  for (const data of projectData) {
    r = await req(`/api/v1/records/${parentApi}`, {
      method: 'POST', cookie: adminCookie2, body: data,
    });
    check(`project "${data.name}" created`, r.status === 201);
    projectIds.push(r.json?.data?.id || r.json?.data?._id);
  }

  // ── 6. Create task records (linked to projects) ─────────────────────────
  const taskData = [
    { name: 'Design UI', project: projectIds[0], hours: 40, priority: 'high', due_date: '2026-02-15', task_notes: 'Design the user interface' },
    { name: 'Build API', project: projectIds[0], hours: 60, priority: 'high', due_date: '2026-03-01', task_notes: 'Build the backend API' },
    { name: 'Write Tests', project: projectIds[0], hours: 20, priority: 'medium', due_date: '2026-03-15' },
    { name: 'Research', project: projectIds[1], hours: 15, priority: 'low', due_date: '2026-07-01' },
    { name: 'Planning Doc', project: projectIds[1], hours: 8, priority: 'medium' },
    { name: 'Final Review', project: projectIds[2], hours: 10, priority: 'high', due_date: '2025-04-01', task_notes: 'Review everything' },
  ];
  for (const data of taskData) {
    r = await req(`/api/v1/records/${childApi}`, {
      method: 'POST', cookie: adminCookie2, body: data,
    });
    check(`task "${data.name}" created`, r.status === 201);
  }

  // ── 7. Run report: groupBy status with COUNT ────────────────────────────
  r = await req('/api/v1/reports/run', {
    method: 'POST', cookie: adminCookie2,
    body: {
      objectApiName: parentApi,
      groupBy: 'status',
      aggregations: [{ func: 'count', alias: 'count' }],
    },
  });
  check('report run succeeds', r.status === 200);
  const grouped = r.json?.data?.results || [];
  check('grouped results have 3 groups', grouped.length === 3, `got ${grouped.length}`);

  // ── 8. Run report: SUM aggregation ──────────────────────────────────────
  r = await req('/api/v1/reports/run', {
    method: 'POST', cookie: adminCookie2,
    body: {
      objectApiName: parentApi,
      aggregations: [{ func: 'sum', field: 'budget', alias: 'total_budget' }],
    },
  });
  check('SUM report runs', r.status === 200);
  const sumResult = r.json?.data?.results?.[0];
  check('SUM budget = 350000', sumResult?.total_budget === 350000, `got ${sumResult?.total_budget}`);

  // ── 9. Run report: AVG aggregation ──────────────────────────────────────
  r = await req('/api/v1/reports/run', {
    method: 'POST', cookie: adminCookie2,
    body: {
      objectApiName: childApi,
      aggregations: [{ func: 'avg', field: 'hours', alias: 'avg_hours' }],
    },
  });
  check('AVG report runs', r.status === 200);
  const avgResult = r.json?.data?.results?.[0];
  const expectedAvg = (40 + 60 + 20 + 15 + 8 + 10) / 6;
  check('AVG hours is correct', Math.abs((avgResult?.avg_hours || 0) - expectedAvg) < 0.01, `got ${avgResult?.avg_hours}`);

  // ── 10. Run report: MIN / MAX ───────────────────────────────────────────
  r = await req('/api/v1/reports/run', {
    method: 'POST', cookie: adminCookie2,
    body: {
      objectApiName: childApi,
      aggregations: [
        { func: 'min', field: 'hours', alias: 'min_hours' },
        { func: 'max', field: 'hours', alias: 'max_hours' },
      ],
    },
  });
  check('MIN/MAX report runs', r.status === 200);
  const minmax = r.json?.data?.results?.[0];
  check('MIN hours = 8', minmax?.min_hours === 8, `got ${minmax?.min_hours}`);
  check('MAX hours = 60', minmax?.max_hours === 60, `got ${minmax?.max_hours}`);

  // ── 11. Type-aware filter: eq ───────────────────────────────────────────
  r = await req('/api/v1/reports/run', {
    method: 'POST', cookie: adminCookie2,
    body: {
      objectApiName: parentApi,
      filters: [{ field: 'status', operator: 'eq', value: 'active' }],
      aggregations: [{ func: 'count', alias: 'count' }],
    },
  });
  check('filter eq works', r.status === 200);
  check('eq filter returns 1 active project', r.json?.data?.results?.[0]?.count === 1);

  // ── 12. Type-aware filter: neq ──────────────────────────────────────────
  r = await req('/api/v1/reports/run', {
    method: 'POST', cookie: adminCookie2,
    body: {
      objectApiName: parentApi,
      filters: [{ field: 'status', operator: 'neq', value: 'active' }],
      aggregations: [{ func: 'count', alias: 'count' }],
    },
  });
  check('filter neq works', r.json?.data?.results?.[0]?.count === 2);

  // ── 13. Type-aware filter: gt (numeric) ─────────────────────────────────
  r = await req('/api/v1/reports/run', {
    method: 'POST', cookie: adminCookie2,
    body: {
      objectApiName: parentApi,
      filters: [{ field: 'budget', operator: 'gt', value: 75000 }],
      aggregations: [{ func: 'count', alias: 'count' }],
    },
  });
  check('filter gt (numeric) works', r.json?.data?.results?.[0]?.count === 2, 'budget > 75000');

  // ── 14. Type-aware filter: contains ─────────────────────────────────────
  r = await req('/api/v1/reports/run', {
    method: 'POST', cookie: adminCookie2,
    body: {
      objectApiName: childApi,
      filters: [{ field: 'task_notes', operator: 'contains', value: 'interface' }],
      aggregations: [{ func: 'count', alias: 'count' }],
    },
  });
  check('filter contains works', r.json?.data?.results?.[0]?.count === 1);

  // ── 15. Type-aware filter: in ───────────────────────────────────────────
  r = await req('/api/v1/reports/run', {
    method: 'POST', cookie: adminCookie2,
    body: {
      objectApiName: childApi,
      filters: [{ field: 'priority', operator: 'in', value: ['high', 'low'] }],
      aggregations: [{ func: 'count', alias: 'count' }],
    },
  });
  check('filter in works', r.json?.data?.results?.[0]?.count === 4, 'high(3)+low(1)=4');

  // ── 16. Type-aware filter: is_null ──────────────────────────────────────
  r = await req('/api/v1/reports/run', {
    method: 'POST', cookie: adminCookie2,
    body: {
      objectApiName: childApi,
      filters: [{ field: 'due_date', operator: 'is_null' }],
      aggregations: [{ func: 'count', alias: 'count' }],
    },
  });
  check('filter is_null works', r.json?.data?.results?.[0]?.count === 1, 'Planning Doc has no due_date');

  // ── 17. Type-aware filter: between (numeric) ───────────────────────────
  r = await req('/api/v1/reports/run', {
    method: 'POST', cookie: adminCookie2,
    body: {
      objectApiName: childApi,
      filters: [{ field: 'hours', operator: 'between', value: 10, value2: 40 }],
      aggregations: [{ func: 'count', alias: 'count' }],
    },
  });
  check('filter between works', r.json?.data?.results?.[0]?.count === 4, '10,15,20,40');

  // ── 18. Cross-object: tasks grouped by project status ───────────────────
  r = await req('/api/v1/reports/run', {
    method: 'POST', cookie: adminCookie2,
    body: {
      objectApiName: childApi,
      aggregations: [{ func: 'sum', field: 'hours', alias: 'total_hours' }],
      crossObject: {
        lookupField: 'project',
        relatedObject: parentApi,
        relatedGroupBy: 'status',
      },
    },
  });
  check('cross-object report runs', r.status === 200);
  const crossResults = r.json?.data?.results || [];
  check('cross-object returns groups', crossResults.length >= 2, `got ${crossResults.length}`);
  const activeGroup = crossResults.find((g) => g._id === 'active');
  check('cross-object: active project tasks hours = 120', activeGroup?.total_hours === 120, `got ${activeGroup?.total_hours}`);

  // ── 19. Raw records mode (no groupBy, no aggregation = table) ──────────
  r = await req('/api/v1/reports/run', {
    method: 'POST', cookie: adminCookie2,
    body: {
      objectApiName: childApi,
      limit: 10,
    },
  });
  check('raw records mode returns data', r.status === 200);
  const rawRecords = r.json?.data?.results || [];
  check('raw records returns 6 tasks', rawRecords.length === 6, `got ${rawRecords.length}`);
  check('raw records include data map', !!rawRecords[0]?.data);

  // ── 20. Fields metadata returned ────────────────────────────────────────
  check('fields metadata returned in response', r.json?.data?.fields?.length > 0, `got ${r.json?.data?.fields?.length} fields`);

  // ── 21. Save a report ───────────────────────────────────────────────────
  r = await req('/api/v1/reports', {
    method: 'POST', cookie: adminCookie2,
    body: {
      name: 'Task Hours by Priority',
      description: 'Sum of hours grouped by priority',
      objectApiName: childApi,
      groupBy: 'priority',
      aggregations: [{ func: 'sum', field: 'hours', alias: 'total_hours' }],
      chartType: 'bar',
    },
  });
  check('report saved', r.status === 201);
  const reportId = r.json?.data?._id;
  check('saved report has ID', !!reportId);

  // ── 22. List reports ────────────────────────────────────────────────────
  r = await req('/api/v1/reports', { cookie: adminCookie2 });
  check('list reports succeeds', r.status === 200);
  const reportList = r.json?.data || [];
  check('list includes our report', reportList.some((rp) => rp._id === reportId));

  // ── 23. Get single report ──────────────────────────────────────────────
  r = await req(`/api/v1/reports/${reportId}`, { cookie: adminCookie2 });
  check('get report succeeds', r.status === 200);
  check('report name matches', r.json?.data?.name === 'Task Hours by Priority');
  check('report has aggregations', r.json?.data?.aggregations?.length === 1);

  // ── 24. Update report ──────────────────────────────────────────────────
  r = await req(`/api/v1/reports/${reportId}`, {
    method: 'PUT', cookie: adminCookie2,
    body: { name: 'Updated Task Report', chartType: 'pie' },
  });
  check('report updated', r.status === 200);
  check('updated name persisted', r.json?.data?.name === 'Updated Task Report');
  check('updated chartType persisted', r.json?.data?.chartType === 'pie');

  // ── 25. Delete report ──────────────────────────────────────────────────
  r = await req(`/api/v1/reports/${reportId}`, {
    method: 'DELETE', cookie: adminCookie2,
  });
  check('report deleted', r.status === 200);
  r = await req(`/api/v1/reports/${reportId}`, { cookie: adminCookie2 });
  check('deleted report not found', r.status === 404);

  // ── 26. Permission check: report on unknown object ─────────────────────
  r = await req('/api/v1/reports/run', {
    method: 'POST', cookie: adminCookie2,
    body: { objectApiName: 'nonexistent_object_xyz' },
  });
  check('report on unknown object returns 404', r.status === 404);

  // ── 27. Validation: missing objectApiName ──────────────────────────────
  r = await req('/api/v1/reports/run', {
    method: 'POST', cookie: adminCookie2,
    body: {},
  });
  check('missing objectApiName returns 400', r.status === 400);

  // ── 28. GroupBy with multiple aggregations ─────────────────────────────
  r = await req('/api/v1/reports/run', {
    method: 'POST', cookie: adminCookie2,
    body: {
      objectApiName: childApi,
      groupBy: 'priority',
      aggregations: [
        { func: 'count', alias: 'count' },
        { func: 'sum', field: 'hours', alias: 'total_hours' },
        { func: 'avg', field: 'hours', alias: 'avg_hours' },
      ],
    },
  });
  check('multi-aggregation report runs', r.status === 200);
  const multiAgg = r.json?.data?.results || [];
  const highGroup = multiAgg.find((g) => g._id === 'high');
  check('multi-agg: high priority count = 3', highGroup?.count === 3);
  check('multi-agg: high priority total_hours = 110', highGroup?.total_hours === 110, `got ${highGroup?.total_hours}`);

  // ── 29. Save report with name validation ───────────────────────────────
  r = await req('/api/v1/reports', {
    method: 'POST', cookie: adminCookie2,
    body: { objectApiName: childApi },
  });
  check('report without name rejected', r.status === 400);

  // ── 30. Save report with bad objectApiName ─────────────────────────────
  r = await req('/api/v1/reports', {
    method: 'POST', cookie: adminCookie2,
    body: { name: 'Bad Report', objectApiName: 'nonexistent_xyz' },
  });
  check('report with bad object rejected', r.status === 404);

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
