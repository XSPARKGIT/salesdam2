/**
 * workspace-object-isolation.e2e.mjs — workspace isolation + object-level
 * permissions (objectAccessService).
 *
 * Boots the real Express app and seeds one tenant with three workspaces
 * (Sales: account+contact, Insurance: policy+claim, Empty: none), an object in
 * no workspace (secret), a child of account in no workspace (note), and four
 * users: superuser, admin, a standard "rep" role with limited grants, and a
 * user who belongs to no workspace. Verifies, over HTTP:
 *  - /objects returns only the active workspace's objects, for every role
 *  - switching workspace immediately changes what /objects and /records allow
 *  - an empty workspace (or no workspace) yields no objects
 *  - non-admin roles only see/use objects their role grants (C/R/U/D)
 *  - direct API access to other workspaces' objects is refused (records,
 *    metadata, list views, suggestions, global search)
 *  - records of objects related by lookup stay reachable (related lists)
 *  - setup users can still load the full catalogue with scope=all
 *
 * Run: node tests/workspace-object-isolation.e2e.mjs   (from backend/)
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
import Workspace from '../models/Workspace.js';
import ObjectMeta from '../models/ObjectMeta.js';
import FieldMeta from '../models/FieldMeta.js';
import DynamicRecord from '../models/DynamicRecord.js';
import AuditLog from '../models/AuditLog.js';
import { seedDefaultRoles } from '../services/roleService.js';

const RUN = Date.now().toString(36);
const PASSWORD = 'WsIso123!';

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

const objectNames = async (cookie, query = '') => {
  const r = await req(`/api/v1/objects${query}`, { cookie });
  return (r.json?.data || []).map((o) => o.apiName).sort().join(',');
};
const switchTo = (cookie, ws) => req('/api/v1/workspaces/switch', { method: 'POST', cookie, body: { workspaceId: ws._id } });

let tenantId = null;
const models = [User, Role, Session, Workspace, ObjectMeta, FieldMeta, DynamicRecord, AuditLog];

try {
  await connectDB();

  const tenant = await Tenant.create({ name: `ZZ_WSISO_${RUN}`, slug: `zz-wsiso-${RUN}`, status: 'active', plan: 'enterprise' });
  tenantId = tenant._id;
  await seedDefaultRoles(tenantId);
  const roleSuper = await Role.findOne({ tenantId, name: 'superuser' });
  const roleAdmin = await Role.findOne({ tenantId, name: 'admin' });
  const perm = (objectApiName, c, r, u, d) => ({ objectApiName, canCreate: c, canRead: r, canUpdate: u, canDelete: d });
  const roleRep = await Role.create({
    tenantId, name: `rep_${RUN}`, label: 'Rep',
    dataAccess: 'all',
    objectPermissions: [
      perm('account', true, true, true, false), // no delete
      perm('policy', false, true, false, false), // read only
      perm('claim', false, true, false, false),
      perm('note', false, true, false, false),
      perm('secret', true, true, true, true), // granted, but in no workspace
      // contact: no grant at all
    ],
  });

  const mkUser = (key, role) => User.create({
    tenantId, firstName: 'Ws', lastName: key, email: `ws-${key}-${RUN}@example.com`,
    username: `ws_${key}_${RUN}`, password: PASSWORD, role: role._id, status: 'active', emailVerified: true,
  });
  const superU = await mkUser('super', roleSuper);
  const adminU = await mkUser('admin', roleAdmin);
  const repU = await mkUser('rep', roleRep);
  const loneU = await mkUser('lone', roleRep); // belongs to no workspace
  const members = [superU._id, adminU._id, repU._id];

  const mkObj = (apiName) => ObjectMeta.create({
    tenantId, name: apiName, label: apiName, pluralLabel: `${apiName}s`, apiName,
    nameFieldApiName: 'name', isActive: true, showInNav: true, searchable: true,
  });
  const objs = {};
  for (const n of ['account', 'contact', 'policy', 'claim', 'secret', 'note']) objs[n] = await mkObj(n);
  const mkField = (obj, apiName, type, extra = {}) => FieldMeta.create({
    tenantId, objectId: objs[obj]._id, objectApiName: obj, name: apiName, label: apiName, apiName, type, ...extra,
  });
  for (const n of Object.keys(objs)) await mkField(n, 'name', 'text', { isSearchable: true });
  await mkField('contact', 'account_id', 'lookup', { lookupObjectApiName: 'account' });
  await mkField('claim', 'policy_id', 'lookup', { lookupObjectApiName: 'policy' });
  await mkField('note', 'account_id', 'lookup', { lookupObjectApiName: 'account' });

  const mkWs = (name, allowedObjects) => Workspace.create({
    tenantId, name: `${name} ${RUN}`, apiName: `${name.toLowerCase()}_${RUN}`, status: 'active', memberIds: members, allowedObjects,
  });
  const wsSales = await mkWs('Sales', ['account', 'contact']);
  const wsIns = await mkWs('Insurance', ['policy', 'claim']);
  const wsEmpty = await mkWs('Empty', []);
  await User.updateMany({ _id: { $in: members } }, { $set: { workspaceIds: [wsSales._id, wsIns._id, wsEmpty._id] } });

  // Records to look for, inserted directly (secret/note belong to no workspace).
  const mkRec = (objectApiName, name) => DynamicRecord.create({
    tenantId, objectId: objs[objectApiName]._id, objectApiName, data: { name }, ownerId: superU._id, createdBy: superU._id, _searchText: `${name}`,
  });
  const acct = await mkRec('account', `Zephyr Account ${RUN}`);
  await mkRec('secret', `Zephyr Secret ${RUN}`);
  await mkRec('note', `Zephyr Note ${RUN}`);
  await mkRec('policy', `Zephyr Policy ${RUN}`);

  const cSuper = await loginCookie(superU.email);
  const cAdmin = await loginCookie(adminU.email);
  const cRep = await loginCookie(repU.email);
  const cLone = await loginCookie(loneU.email);
  check('all users can log in', Boolean(cSuper && cAdmin && cRep && cLone));

  // ── Superuser: workspace isolation applies ─────────────────────────────
  await switchTo(cSuper, wsSales);
  check('superuser in Sales sees only Sales objects', (await objectNames(cSuper)) === 'account,contact', await objectNames(cSuper));
  check('superuser in Sales can read account records', (await req('/api/v1/records/account', { cookie: cSuper })).status === 200);
  const supPolicy = await req('/api/v1/records/policy', { cookie: cSuper });
  check('superuser in Sales is refused policy records (other workspace)', supPolicy.status === 403, `HTTP ${supPolicy.status}`);
  const supSecret = await req('/api/v1/records/secret', { cookie: cSuper });
  check('superuser is refused records of an object in no workspace', supSecret.status === 403, `HTTP ${supSecret.status}`);
  const supNote = await req('/api/v1/records/note', { cookie: cSuper });
  check('records of a lookup child (related list) stay reachable', supNote.status === 200, `HTTP ${supNote.status}`);

  await switchTo(cSuper, wsIns);
  check('after switching to Insurance, superuser sees only Insurance objects', (await objectNames(cSuper)) === 'claim,policy', await objectNames(cSuper));
  const supAcct = await req('/api/v1/records/account', { cookie: cSuper });
  check('after switching, Sales records are refused immediately', supAcct.status === 403, `HTTP ${supAcct.status}`);
  check('superuser in Insurance can read policy records', (await req('/api/v1/records/policy', { cookie: cSuper })).status === 200);

  await switchTo(cSuper, wsEmpty);
  check('superuser in an empty workspace sees no objects', (await objectNames(cSuper)) === '', await objectNames(cSuper) || '(none)');
  const supEmptyAcct = await req('/api/v1/records/account', { cookie: cSuper });
  check('empty workspace refuses record access', supEmptyAcct.status === 403, `HTTP ${supEmptyAcct.status}`);
  check(
    'superuser can still load the full catalogue for setup (scope=all)',
    (await objectNames(cSuper, '?scope=all')) === 'account,claim,contact,note,policy,secret',
    await objectNames(cSuper, '?scope=all'),
  );

  // ── Admin: same isolation ──────────────────────────────────────────────
  await switchTo(cAdmin, wsIns);
  check('admin in Insurance sees only Insurance objects', (await objectNames(cAdmin)) === 'claim,policy', await objectNames(cAdmin));
  const admAcct = await req(`/api/v1/records/account/${acct._id}`, { cookie: cAdmin });
  check('admin cannot open a Sales record by direct id from Insurance', admAcct.status === 403, `HTTP ${admAcct.status}`);

  // ── Rep: role grants within the workspace ──────────────────────────────
  await switchTo(cRep, wsSales);
  check('rep in Sales sees only granted Sales objects (no contact)', (await objectNames(cRep)) === 'account', await objectNames(cRep));
  check('rep scope=all is ignored (not a setup user)', (await objectNames(cRep, '?scope=all')) === 'account', await objectNames(cRep, '?scope=all'));
  const repContact = await req('/api/v1/records/contact', { cookie: cRep });
  check('rep is refused contact records (no role grant)', repContact.status === 403, `HTTP ${repContact.status}`);
  const repCreate = await req('/api/v1/records/account', { method: 'POST', cookie: cRep, body: { name: `Rep Account ${RUN}` } });
  check('rep can create account (create granted)', repCreate.status === 201, `HTTP ${repCreate.status} ${repCreate.json?.message || ''}`);
  const newId = repCreate.json?.data?._id || repCreate.json?.data?.id;
  const repUpd = await req(`/api/v1/records/account/${newId}`, { method: 'PATCH', cookie: cRep, body: { name: `Rep Account 2 ${RUN}` } });
  check('rep can update account (update granted)', repUpd.status === 200, `HTTP ${repUpd.status}`);
  const repDel = await req(`/api/v1/records/account/${newId}`, { method: 'DELETE', cookie: cRep });
  check('rep cannot delete account (delete not granted)', repDel.status === 403, `HTTP ${repDel.status}`);
  const repSecret = await req('/api/v1/records/secret', { cookie: cRep });
  check('rep is refused secret even with a role grant (in no workspace)', repSecret.status === 403, `HTTP ${repSecret.status}`);
  const repSecretMeta = await req('/api/v1/objects/secret', { cookie: cRep });
  check('rep is refused secret object metadata by direct URL', repSecretMeta.status === 403, `HTTP ${repSecretMeta.status}`);
  const repSecretFields = await req('/api/v1/objects/secret/fields', { cookie: cRep });
  check('rep is refused secret field definitions', repSecretFields.status === 403, `HTTP ${repSecretFields.status}`);
  const repSecretViews = await req('/api/v1/list-views/secret', { cookie: cRep });
  check('rep is refused secret list views', repSecretViews.status === 403, `HTTP ${repSecretViews.status}`);
  const repSuggest = await req('/api/v1/search/suggest?object=secret&q=Zep', { cookie: cRep });
  check('rep is refused lookup suggestions for secret', repSuggest.status === 403, `HTTP ${repSuggest.status}`);
  const repSearch = await req(`/api/v1/search?q=Zephyr`, { cookie: cRep });
  const found = (repSearch.json?.data?.records || []).map((r) => r.objectApiName);
  check(
    'global search only returns objects visible in the workspace',
    repSearch.status === 200 && !found.includes('secret') && !found.includes('policy') && !found.includes('note'),
    `HTTP ${repSearch.status} objects=${[...new Set(found)].join(',') || '(none)'}`,
  );

  await switchTo(cRep, wsIns);
  check('rep after switching to Insurance sees Insurance objects', (await objectNames(cRep)) === 'claim,policy', await objectNames(cRep));
  const repAcctIns = await req('/api/v1/records/account', { cookie: cRep });
  check('rep in Insurance is refused account records', repAcctIns.status === 403, `HTTP ${repAcctIns.status}`);

  // ── Workspace membership ───────────────────────────────────────────────
  check('user in no workspace sees no objects', (await objectNames(cLone)) === '', await objectNames(cLone) || '(none)');
  const loneAcct = await req('/api/v1/records/account', { cookie: cLone });
  check('user in no workspace is refused records', loneAcct.status === 403, `HTTP ${loneAcct.status}`);
  const loneSwitch = await switchTo(cLone, wsSales);
  check('user cannot switch into a workspace they are not a member of', loneSwitch.status === 403, `HTTP ${loneSwitch.status}`);
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
