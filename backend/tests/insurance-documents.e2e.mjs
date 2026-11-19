/**
 * Policy document generation (BRD §11.3) e2e.
 *
 * Proves: issuing a policy auto-generates contract + schedule documents stored
 * as versioned File records; manual generation works; listing returns all
 * versions; regeneration after an endorsement creates a new version without
 * erasing the prior; tenant isolation holds.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import Tenant from '../models/Tenant.js';
import User from '../models/User.js';
import Role from '../models/Role.js';
import ObjectMeta from '../models/ObjectMeta.js';
import FieldMeta from '../models/FieldMeta.js';
import DynamicRecord from '../models/DynamicRecord.js';
import Session from '../models/Session.js';
import Workspace from '../models/Workspace.js';
import AutoNumberCounter from '../models/AutoNumberCounter.js';
import File from '../models/File.js';
import { seedDefaultRoles } from '../services/roleService.js';
import { seedStandardObjects, ensureUserObject } from '../services/metadataService.js';
import { seedInsuranceObjects, seedInsuranceWorkspace } from '../services/insuranceMetadataService.js';
import connectDB from '../config/db.js';
import app from '../app.js';

const RUN = Date.now().toString(36);
const PASSWORD = 'DocTest123!';

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const objectIdFor = async (tenantId, apiName) => {
  const obj = await ObjectMeta.findOne({ tenantId, apiName });
  if (!obj) throw new Error(`object ${apiName} not seeded`);
  return obj._id;
};

const mk = (tenantId, userId, objectId, objectApiName, data) =>
  DynamicRecord.create({ tenantId, objectId, objectApiName, data, createdBy: userId, ownerId: userId });

const seedPlan = async (tenantId, userId) => {
  const productId = await objectIdFor(tenantId, 'product');
  const pvId = await objectIdFor(tenantId, 'product_version');
  const bcId = await objectIdFor(tenantId, 'benefit_cover');
  const product = await mk(tenantId, userId, productId, 'product', { name: 'Funeral Plan' });
  const pv = await mk(tenantId, userId, pvId, 'product_version', {
    name: 'FP v1',
    product: String(product._id),
    status: 'active',
    effective_from: '2026-01-01',
    allow_spouse: false,
    allow_children: false,
    allow_extended_family: false,
    min_entry_age: 18,
    max_entry_age: 65,
    allows_manual_premium_override: false,
    requires_approval: false,
  });
  await mk(tenantId, userId, bcId, 'benefit_cover', {
    name: 'main only 100k',
    product_version: String(pv._id),
    rate_category: 'main_member_only',
    cover_amount: 100000,
    min_age: 18,
    max_age: 65,
    premium: 250,
    effective_from: '2026-01-01',
  });
  await mk(tenantId, userId, bcId, 'benefit_cover', {
    name: 'main only 200k',
    product_version: String(pv._id),
    rate_category: 'main_member_only',
    cover_amount: 200000,
    min_age: 18,
    max_age: 65,
    premium: 400,
    effective_from: '2026-01-01',
  });
  return { pv };
};

const seedTenant = async (label) => {
  const tenant = await Tenant.create({
    name: `ZZ_INSDOC_${label}_${RUN}`,
    slug: `zz-insdoc-${label}-${RUN}`,
    hub: 'insurance',
    status: 'active',
    plan: 'enterprise',
  });
  await seedDefaultRoles(tenant._id);
  const adminRole = await Role.findOne({ tenantId: tenant._id, name: 'admin' });
  const user = await User.create({
    tenantId: tenant._id,
    firstName: 'Doc',
    lastName: label,
    email: `insdoc-${label}-${RUN}@example.com`,
    username: `insdoc_${label}_${RUN}`,
    password: PASSWORD,
    role: adminRole._id,
    status: 'active',
    emailVerified: true,
  });
  await seedStandardObjects(tenant._id, user._id);
  await ensureUserObject(tenant._id, user._id);
  await seedInsuranceObjects(tenant._id, user._id);
  await seedInsuranceWorkspace(tenant._id, user._id);
  const { pv } = await seedPlan(tenant._id, user._id);
  return { tenant, user, pv };
};

let server;
let tenantIds = [];

const main = async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://localhost:${server.address().port}`;

  const req = async (path, { method = 'GET', cookie, body } = {}) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    let json = null;
    try { json = await res.json(); } catch { /* no body */ }
    return { status: res.status, json };
  };

  const login = async (username) => {
    const res = await fetch(`${base}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: PASSWORD }),
    });
    return (res.headers.get('set-cookie') || '').split(';')[0];
  };

  const issuePolicy = async (cookie, pvId, suffix) => {
    const started = await req('/api/v1/insurance/applications', {
      method: 'POST',
      cookie,
      body: { channel: 'website', product_version_id: String(pvId) },
    });
    const id = started.json?.data?.policy?.id;
    await req(`/api/v1/insurance/applications/${id}/main-member`, {
      method: 'PUT',
      cookie,
      body: { id_number: `DOC-${suffix}-${RUN}`, age: 30, cover_amount: 100000 },
    });
    await req(`/api/v1/insurance/applications/${id}/premium-payer`, {
      method: 'PUT',
      cookie,
      body: { id_number: `DOCP-${suffix}-${RUN}`, name: 'Payer' },
    });
    await req(`/api/v1/insurance/applications/${id}/acceptance`, {
      method: 'POST',
      cookie,
      body: { channel: 'website', accepted_terms_version: '1.0' },
    });
    await req(`/api/v1/insurance/applications/${id}/submit`, { method: 'POST', cookie });
    const issued = await req(`/api/v1/insurance/policies/${id}/issue`, { method: 'POST', cookie });
    return { policyId: id, issued };
  };

  try {
    const A = await seedTenant('a');
    const B = await seedTenant('b');
    tenantIds = [A.tenant._id, B.tenant._id];
    const ca = await login(A.user.email);
    const cb = await login(B.user.email);
    check('tenant A admin authenticates', !!ca);
    check('tenant B admin authenticates', !!cb);

    // ── Issue auto-generates documents ──
    const { policyId, issued } = await issuePolicy(ca, A.pv._id, 'd1');
    check('policy issued active', issued.status === 200 && issued.json?.data?.policy?.status === 'active', `HTTP ${issued.status}`);

    const docsAfterIssue = await req(`/api/v1/insurance/policies/${policyId}/documents`, { cookie: ca });
    check('documents listed after issue', docsAfterIssue.status === 200, `HTTP ${docsAfterIssue.status}`);
    const docList = docsAfterIssue.json?.data || [];
    check('contract auto-generated on issue', docList.some((d) => d.tags?.includes('contract')));
    check('schedule auto-generated on issue', docList.some((d) => d.tags?.includes('schedule')));
    check('two documents exist after issue', docList.length === 2, `${docList.length}`);

    // ── Manual generation ──
    const manual = await req(`/api/v1/insurance/policies/${policyId}/documents/certificate`, { method: 'POST', cookie: ca });
    check('manual certificate generation → 200', manual.status === 200, `HTTP ${manual.status}`);
    check('certificate content is HTML', manual.json?.data?.content?.includes('<html>') === true);

    const docsAfterManual = await req(`/api/v1/insurance/policies/${policyId}/documents`, { cookie: ca });
    check('three documents now exist', (docsAfterManual.json?.data || []).length === 3, `${(docsAfterManual.json?.data || []).length}`);

    // ── Invalid document type ──
    const invalid = await req(`/api/v1/insurance/policies/${policyId}/documents/teleport`, { method: 'POST', cookie: ca });
    check('invalid document type → 400', invalid.status === 400, `HTTP ${invalid.status}`);

    // ── Versioning: endorsement regenerates contract ──
    const end = await req(`/api/v1/insurance/policies/${policyId}/endorsements`, {
      method: 'POST',
      cookie: ca,
      body: { change_type: 'cover_amount_change', requires_approval: false },
    });
    const endId = end.json?.data?.endorsement?.id;
    await req(`/api/v1/insurance/endorsements/${endId}/submit`, { method: 'POST', cookie: ca });
    await req(`/api/v1/insurance/endorsements/${endId}/apply`, { method: 'POST', cookie: ca, body: { cover_amount: 200000 } });

    const docsAfterEndorsement = await req(`/api/v1/insurance/policies/${policyId}/documents`, { cookie: ca });
    const allDocs = docsAfterEndorsement.json?.data || [];
    const contracts = allDocs.filter((d) => d.tags?.includes('contract'));
    check('contract regenerated after endorsement (versioned)', contracts.length === 2, `contracts=${contracts.length}`);
    check('prior contract version preserved', contracts[0].id !== contracts[1].id);

    // ── Files stored in DB ──
    const fileCount = await File.countDocuments({ tenantId: A.tenant._id, 'relatedTo.objectApiName': 'policy', 'relatedTo.recordId': policyId, tags: 'policy-document' });
    check('files stored in DB', fileCount >= 4, `${fileCount}`);

    // ── Isolation ──
    const crossRead = await req(`/api/v1/insurance/policies/${policyId}/documents`, { cookie: cb });
    check("tenant B cannot read tenant A's documents (IDOR)", crossRead.status === 404 || (crossRead.json?.data || []).length === 0, `HTTP ${crossRead.status}`);
  } catch (err) {
    check('test harness ran without error', false, `${err.message}\n${err.stack}`);
  }
};

await connectDB();
await main();
server?.close();
await Tenant.deleteMany({ slug: { $regex: '^zz-insdoc-' } });
await Promise.all(
  [User, Role, ObjectMeta, FieldMeta, DynamicRecord, Session, Workspace, AutoNumberCounter, File].map((M) =>
    M.deleteMany({ tenantId: { $in: tenantIds } }).catch(() => {}),
  ),
);
await mongoose.connection.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);