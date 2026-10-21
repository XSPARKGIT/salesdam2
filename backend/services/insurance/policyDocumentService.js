/**
 * Policy document generation (BRD §11.3).
 *
 * Generates Policy Contract, Policy Schedule and Certificate documents with
 * dynamic content from the policy, parties, insured lives and product version.
 * Documents are stored as File records against the policy (versioned — each
 * generation creates a new File, never erasing the prior version).
 *
 * Delivery (email/WhatsApp) is not implemented — documents are generated and
 * stored only.
 */
import { findOne, findMany, createDynamic } from './dynamicRecords.js';
import { dataOf } from './pricingService.js';
import File from '../../models/File.js';
import { AppError } from '../../utils/errors.js';
import { audit } from '../../utils/auditLogger.js';
import * as pdfService from './pdfGenerationService.js';

export const DOCUMENT_TYPES = ['contract', 'schedule', 'certificate'];

const idOf = (rec) => String(rec._id);

const loadPolicy = async (tenantId, id) => {
  const policy = await findOne(tenantId, 'policy', { _id: id });
  if (!policy) throw new AppError('Policy not found.', 404);
  return policy;
};

/** Gather all data needed to render a policy document. */
const gatherContext = async (tenantId, policy) => {
  const pData = dataOf(policy);
  const [parties, lives, product, productVersion] = await Promise.all([
    findMany(tenantId, 'policy_party', { 'data.policy': idOf(policy) }),
    findMany(tenantId, 'insured_life', { 'data.policy': idOf(policy) }),
    pData.product ? findOne(tenantId, 'product', { _id: pData.product }).catch(() => null) : null,
    pData.product_version ? findOne(tenantId, 'product_version', { _id: pData.product_version }).catch(() => null) : null,
  ]);

  return {
    policy: pData,
    parties: parties.map((p) => dataOf(p)),
    lives: lives.filter((l) => !l.isDeleted).map((l) => dataOf(l)),
    product: product ? dataOf(product) : null,
    productVersion: productVersion ? dataOf(productVersion) : null,
  };
};

/** Render the Policy Contract (HTML). */
const renderContract = (ctx) => {
  const { policy, parties, lives, product, productVersion } = ctx;
  const main = lives.find((l) => l.relation === 'main_member');
  const payer = parties.find((p) => p.role === 'premium_payer');
  const beneficiary = parties.find((p) => p.role === 'beneficiary');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Policy Contract — ${policy.policy_number || ''}</title>
<style>body{font-family:Arial,sans-serif;margin:40px;line-height:1.6}table{width:100%;border-collapse:collapse;margin:20px 0}td,th{border:1px solid #ccc;padding:8px;text-align:left}th{background:#f5f5f5}</style>
</head><body>
<h1>Policy Contract</h1>
<p><strong>Policy Number:</strong> ${policy.policy_number || ''}</p>
<p><strong>Product:</strong> ${product?.name || ''} ${productVersion?.name || ''}</p>
<p><strong>Status:</strong> ${policy.status || ''}</p>
<p><strong>Premium:</strong> R${policy.current_premium ?? '—'}</p>

<h2>Main Member</h2>
<table><tr><th>Name</th><th>Age</th><th>Cover Amount</th></tr>
<tr><td>${main?.name || '—'}</td><td>${main?.age ?? '—'}</td><td>R${main?.cover_amount ?? '—'}</td></tr></table>

<h2>Premium Payer</h2>
<p>${payer?.name || '—'}</p>

<h2>Beneficiary</h2>
<p>${beneficiary?.name || '—'}</p>

<h2>Covered Lives</h2>
<table><tr><th>Name</th><th>Relation</th><th>Age</th><th>Cover</th></tr>
${lives.map((l) => `<tr><td>${l.name || ''}</td><td>${l.relation || ''}</td><td>${l.age ?? ''}</td><td>R${l.cover_amount ?? '—'}</td></tr>`).join('')}
</table>

<p><em>Generated ${new Date().toISOString()}</em></p>
</body></html>`;
};

/** Render the Policy Schedule (HTML). */
const renderSchedule = (ctx) => {
  const { policy, lives, product, productVersion } = ctx;
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Policy Schedule — ${policy.policy_number || ''}</title>
<style>body{font-family:Arial,sans-serif;margin:40px}table{width:100%;border-collapse:collapse}td,th{border:1px solid #ccc;padding:8px;text-align:left}th{background:#f5f5f5}</style>
</head><body>
<h1>Policy Schedule</h1>
<p><strong>Policy Number:</strong> ${policy.policy_number || ''}</p>
<p><strong>Product:</strong> ${product?.name || ''} ${productVersion?.name || ''}</p>
<p><strong>Premium:</strong> R${policy.current_premium ?? '—'}</p>

<h2>Insured Lives</h2>
<table><tr><th>Name</th><th>Relation</th><th>Age</th><th>Cover Amount</th><th>Status</th></tr>
${lives.map((l) => `<tr><td>${l.name || ''}</td><td>${l.relation || ''}</td><td>${l.age ?? ''}</td><td>R${l.cover_amount ?? '—'}</td><td>${l.status || ''}</td></tr>`).join('')}
</table>
<p><em>Generated ${new Date().toISOString()}</em></p>
</body></html>`;
};

/** Render the Policy Certificate (HTML). */
const renderCertificate = (ctx) => {
  const { policy, lives, product } = ctx;
  const main = lives.find((l) => l.relation === 'main_member');
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Policy Certificate — ${policy.policy_number || ''}</title>
<style>body{font-family:Arial,sans-serif;margin:40px;text-align:center}.cert{border:2px solid #333;padding:40px;margin:40px auto;max-width:600px}</style>
</head><body>
<div class="cert">
<h1>Certificate of Insurance</h1>
<p><strong>Policy Number:</strong> ${policy.policy_number || ''}</p>
<p><strong>Product:</strong> ${product?.name || ''}</p>
<p><strong>Main Member:</strong> ${main?.name || '—'}</p>
<p><strong>Cover Amount:</strong> R${main?.cover_amount ?? '—'}</p>
<p><strong>Premium:</strong> R${policy.current_premium ?? '—'}</p>
<p><em>Generated ${new Date().toISOString()}</em></p>
</div>
</body></html>`;
};

const RENDERERS = {
  contract: renderContract,
  schedule: renderSchedule,
  certificate: renderCertificate,
};

/**
 * Generate a policy document and store it as a versioned File record.
 * Each call creates a new File — prior versions are never erased.
 * Also generates a PDF version if PDF generation is available.
 */
export const generatePolicyDocument = async ({ tenantId, userId, policyId, type }) => {
  if (!DOCUMENT_TYPES.includes(type)) {
    throw new AppError(`Document type must be one of: ${DOCUMENT_TYPES.join(', ')}`, 400);
  }
  const policy = await loadPolicy(tenantId, policyId);
  const ctx = await gatherContext(tenantId, policy);
  const html = RENDERERS[type](ctx);

  const files = [];

  // Create HTML file
  const htmlFile = await File.create({
    tenantId,
    name: `${type}_${dataOf(policy).policy_number || policyId}_${Date.now()}.html`,
    description: `Policy ${type} for ${dataOf(policy).policy_number || policyId}`,
    mimeType: 'text/html',
    data: Buffer.from(html).toString('base64'),
    sizeBytes: html.length,
    relatedTo: { objectApiName: 'policy', recordId: policy._id },
    tags: ['policy-document', type],
    createdBy: userId,
    lastModifiedBy: userId,
  });
  files.push(htmlFile);

  // Generate and store PDF version if available
  const pdfBuffer = await pdfService.generatePDF(html);
  if (pdfBuffer) {
    const pdfFile = await File.create({
      tenantId,
      name: `${type}_${dataOf(policy).policy_number || policyId}_${Date.now()}.pdf`,
      description: `Policy ${type} (PDF) for ${dataOf(policy).policy_number || policyId}`,
      mimeType: 'application/pdf',
      data: pdfBuffer.toString('base64'),
      sizeBytes: pdfBuffer.length,
      relatedTo: { objectApiName: 'policy', recordId: policy._id },
      tags: ['policy-document', type, 'pdf'],
      createdBy: userId,
      lastModifiedBy: userId,
    });
    files.push(pdfFile);
  }

  await audit({
    tenantId,
    userId,
    action: 'generate',
    resource: 'PolicyDocument',
    resourceId: files[0]._id,
    objectApiName: 'policy',
    details: { policy: idOf(policy), type, versions: files.map((f) => String(f._id)) },
  });

  return {
    files: files.map((f) => ({
      id: String(f._id),
      name: f.name,
      mimeType: f.mimeType,
      sizeBytes: f.sizeBytes,
      createdAt: f.createdAt,
    })),
    content: html,
  };
};

/** List all generated documents for a policy (versioned). */
export const listPolicyDocuments = async ({ tenantId, policyId }) => {
  const files = await File.find({
    tenantId,
    'relatedTo.objectApiName': 'policy',
    'relatedTo.recordId': policyId,
    'tags': 'policy-document',
  }).sort({ createdAt: -1 });
  return files.map((f) => ({
    id: String(f._id),
    name: f.name,
    mimeType: f.mimeType,
    sizeBytes: f.sizeBytes,
    tags: f.tags,
    createdAt: f.createdAt,
  }));
};

export default {
  DOCUMENT_TYPES,
  generatePolicyDocument,
  listPolicyDocuments,
};