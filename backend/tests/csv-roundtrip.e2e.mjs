/**
 * csv-roundtrip.e2e.mjs — a CSV exported from an object imports back cleanly.
 *
 * Boots the real Express app, seeds a tenant with an object whose required Name
 * field is a built-in (isSystem) field, plus multi-select, Yes/No, date and
 * formula fields, then exports the records through the API and imports that
 * exact file back. Verifies that:
 *  - the export includes built-in fields such as Name
 *  - every exported row imports without errors
 *  - imported values match the originals (multi-select, Yes/No, date)
 *  - calculated (formula) columns are ignored on import
 *
 * Run: node tests/csv-roundtrip.e2e.mjs   (from backend/)
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
import AuditLog from '../models/AuditLog.js';
import Workspace from '../models/Workspace.js';
import { seedDefaultRoles } from '../services/roleService.js';
import { seedWorkspace } from './helpers/workspace.mjs';

const RUN = Date.now().toString(36);
const PASSWORD = 'CsvTest123!';

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;

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
const models = [User, Role, Session, ObjectMeta, FieldMeta, DynamicRecord, AuditLog, Workspace];

try {
  await connectDB();

  const tenant = await Tenant.create({ name: `ZZ_CSV_${RUN}`, slug: `zz-csv-${RUN}`, status: 'active', plan: 'enterprise' });
  tenantId = tenant._id;
  await seedDefaultRoles(tenantId);
  const roleAdmin = await Role.findOne({ tenantId, name: 'admin' });
  const admin = await User.create({
    tenantId, firstName: 'Csv', lastName: 'Admin', email: `csvadmin-${RUN}@example.com`,
    username: `csvadmin_${RUN}`, password: PASSWORD, role: roleAdmin._id, status: 'active', emailVerified: true,
  });
  await seedWorkspace(tenantId, [admin._id], ['gadget']);
  const cookie = await loginCookie(admin.username);
  check('admin can log in', Boolean(cookie));

  const obj = await ObjectMeta.create({
    tenantId, name: 'Gadget', label: 'Gadget', pluralLabel: 'Gadgets',
    apiName: 'gadget', nameFieldApiName: 'name', isActive: true,
  });
  const base_ = { tenantId, objectId: obj._id, objectApiName: 'gadget' };
  const fields = await FieldMeta.create([
    { ...base_, name: 'name', label: 'Gadget Name', apiName: 'name', type: 'text', isSystem: true, isRequired: true, displayOrder: 1 },
    { ...base_, name: 'colours', label: 'Colours', apiName: 'colours', type: 'multipicklist', displayOrder: 2,
      picklistValues: ['red', 'green', 'blue'].map((v) => ({ label: v, value: v, isActive: true })) },
    { ...base_, name: 'in_stock', label: 'In Stock', apiName: 'in_stock', type: 'boolean', displayOrder: 3 },
    { ...base_, name: 'launched', label: 'Launched', apiName: 'launched', type: 'date', displayOrder: 4 },
    { ...base_, name: 'price', label: 'Price', apiName: 'price', type: 'currency', isSystem: true, isRequired: true, displayOrder: 5 },
    { ...base_, name: 'label_text', label: 'Label Text', apiName: 'label_text', type: 'formula', displayOrder: 6,
      formula: 'name', formulaReturnType: 'text' },
  ]);
  check('fields seeded', fields.length === 6);

  const launched = new Date('2026-03-15T00:00:00.000Z');
  for (const [name, colours, inStock, price] of [
    ['Widget, Deluxe', ['red', 'blue'], false, 199.5],
    ['Plain "Gizmo"', ['green'], true, 20],
  ]) {
    const rec = new DynamicRecord({ ...base_, ownerId: admin._id, createdBy: admin._id, lastModifiedBy: admin._id });
    rec.setField('name', name);
    rec.setField('colours', colours);
    rec.setField('in_stock', inStock);
    rec.setField('launched', launched);
    rec.setField('price', price);
    rec.setField('label_text', name);
    await rec.save();
  }

  const exp = await fetch(`${base}/api/v1/records/gadget/export`, { headers: { Cookie: cookie } });
  const csv = await exp.text();
  const header = csv.split('\n')[0];
  check('export succeeds', exp.status === 200, `HTTP ${exp.status}`);
  check('export includes the built-in Name and Price columns', header.includes('Gadget Name') && header.includes('Price'), header);

  // Import the exact exported file back.
  const form = new FormData();
  form.append('file', new Blob([csv], { type: 'text/csv' }), 'gadget_export.csv');
  const imp = await fetch(`${base}/api/v1/records/gadget/import`, { method: 'POST', headers: { Cookie: cookie }, body: form });
  const impJson = await imp.json().catch(() => ({}));
  const r = impJson?.data || {};
  check(
    'every exported row imports without errors',
    imp.status === 200 && r.created === 2 && r.failed === 0,
    `HTTP ${imp.status} created=${r.created} failed=${r.failed} ${JSON.stringify(r.errors || []).slice(0, 300)}`,
  );

  const imported = await DynamicRecord.find({ tenantId, objectApiName: 'gadget', isDeleted: false })
    .sort({ createdAt: 1 }).lean();
  const copies = imported.slice(2).map((x) => (x.data instanceof Map ? Object.fromEntries(x.data) : x.data));
  const deluxe = copies.find((d) => d?.name === 'Widget, Deluxe');
  const gizmo = copies.find((d) => d?.name === 'Plain "Gizmo"');
  check('names with commas and quotes survive', Boolean(deluxe && gizmo));
  check('multi-select values survive', JSON.stringify(deluxe?.colours) === '["red","blue"]', JSON.stringify(deluxe?.colours));
  check('Yes/No values survive (false stays false)', deluxe?.in_stock === false && gizmo?.in_stock === true, `${deluxe?.in_stock}/${gizmo?.in_stock}`);
  check('dates survive', new Date(deluxe?.launched).toISOString() === launched.toISOString(), String(deluxe?.launched));
  check('currency values survive', deluxe?.price === 199.5, String(deluxe?.price));
  check('formula column is not imported as data', deluxe?.label_text === undefined, String(deluxe?.label_text));
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
