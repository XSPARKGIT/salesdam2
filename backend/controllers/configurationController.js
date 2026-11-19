import configurationService from '../services/configurationService.js';
import { asyncHandler, sendSuccess, AppError } from '../utils/errors.js';
import { audit } from '../utils/auditLogger.js';
import Tenant from '../models/Tenant.js';
import mongoose from 'mongoose';

const BRANDING_KEYS = ['branding.company_name', 'branding.primary_color', 'branding.logo_url', 'branding.login_logo_url'];
const MAX_LOGO_CHARS = 700_000; // ~500 KB image as a data URI

/** A stored secret is never sent back, not even in its encrypted form. */
const maskedDoc = (doc) => {
  const o = doc.toObject ? doc.toObject() : { ...doc };
  if (o.isSecret) o.value = o.value ? '••••••••' : '';
  return o;
};

/** Reject unsafe or unusable branding values before they are stored (empty = clear to default). */
const validateBrandingValue = (key, value) => {
  if (!key.startsWith('branding.')) return;
  const v = value === null || value === undefined ? '' : String(value).trim();
  if (v === '') return;
  if (key === 'branding.company_name' && v.length > 80) {
    throw new AppError('Company name must be 80 characters or fewer.', 400);
  }
  if (key === 'branding.primary_color' && !/^#[0-9a-fA-F]{6}$/.test(v)) {
    throw new AppError('Primary colour must be a hex colour such as #0066FF.', 400);
  }
  if (key === 'branding.logo_url' || key === 'branding.login_logo_url') {
    if (v.length > MAX_LOGO_CHARS) throw new AppError('Logo is too large (500 KB maximum).', 400);
    if (!/^(https:\/\/|http:\/\/|data:image\/(png|jpeg|gif|webp);base64,)/i.test(v)) {
      throw new AppError('Logo must be an http(s) URL or a PNG, JPEG, GIF or WebP image.', 400);
    }
  }
};

/**
 * GET /api/v1/configuration
 * Effective configuration for the caller's tenant (tenant overrides applied
 * over platform defaults). Readable by any authenticated tenant user so the
 * frontend can consume branded/settings values.
 */
const getEffectiveConfig = asyncHandler(async (req, res) => {
  const data = await configurationService.getEffective(req.tenantId);
  sendSuccess(res, { data });
});

/**
 * PUT /api/v1/configuration/:key
 * Set a tenant-level override (admin only). Unknown or non-editable keys are
 * rejected — tenants may only override settings the operator exposes.
 */
const updateTenantConfig = asyncHandler(async (req, res) => {
  const { key } = req.params;
  const editable = await configurationService.isTenantEditable(key);
  if (!editable) {
    throw new AppError(
      `Configuration key '${key}' is not available for tenant override.`,
      403,
    );
  }
  if (req.body?.value === undefined) {
    throw new AppError('A "value" is required.', 400);
  }
  validateBrandingValue(key, req.body.value);

  // Core BRD §21.6: SSO is an enterprise-plan capability.
  if (key === 'auth.sso_enabled' && (req.body.value === true || req.body.value === 'true')) {
    if (req.tenant?.plan !== 'enterprise') {
      throw new AppError('Single Sign-On is available on the enterprise plan.', 403);
    }
  }

  const doc = await configurationService.set({
    key,
    tenantId: req.tenantId,
    value: req.body.value,
    updatedBy: req.user._id,
  });
  // The value itself may be a secret (e.g. an integration access token), so
  // only the key name is recorded here — never the value, old or new.
  await audit({
    tenantId: req.tenantId,
    userId: req.user._id,
    action: 'tenant_config_update',
    resource: 'TenantConfiguration',
    resourceId: key,
    details: { key },
    req,
  });
  sendSuccess(res, { data: maskedDoc(doc) }, 'Configuration saved');
});

/**
 * DELETE /api/v1/configuration/:key
 * Clear a tenant override so the platform default applies again (admin only).
 */
const resetTenantConfig = asyncHandler(async (req, res) => {
  const removed = await configurationService.clear(req.params.key, req.tenantId);
  await audit({
    tenantId: req.tenantId,
    userId: req.user._id,
    action: 'tenant_config_reset',
    resource: 'TenantConfiguration',
    resourceId: req.params.key,
    details: { key: req.params.key, removed },
    req,
  });
  sendSuccess(
    res,
    { data: { removed } },
    removed ? 'Override cleared' : 'No override was set',
  );
});

/**
 * GET /api/v1/configuration/defaults  (superuser)
 * Platform-wide defaults plus code-level defaults, shown to the operator.
 */
const getSystemDefaults = asyncHandler(async (req, res) => {
  const data = await configurationService.getEffective(null);
  sendSuccess(res, { data });
});

/**
 * PUT /api/v1/configuration/defaults/:key  (superuser)
 * Create or update a platform-wide default for every tenant.
 */
const setSystemDefault = asyncHandler(async (req, res) => {
  const { key } = req.params;
  if (req.body?.value === undefined) {
    throw new AppError('A "value" is required.', 400);
  }
  validateBrandingValue(key, req.body.value);
  const doc = await configurationService.set({
    key,
    tenantId: null,
    value: req.body.value,
    dataType: req.body.dataType,
    category: req.body.category,
    label: req.body.label,
    description: req.body.description,
    editableByTenant: req.body.editableByTenant,
    updatedBy: req.user._id,
  });
  sendSuccess(res, { data: maskedDoc(doc) }, 'Platform default saved');
});

/**
 * DELETE /api/v1/configuration/defaults/:key  (superuser)
 * Remove a stored platform-wide default; the code-level default (if any)
 * applies again.
 */
const resetSystemDefault = asyncHandler(async (req, res) => {
  const removed = await configurationService.clear(req.params.key, null);
  sendSuccess(
    res,
    { data: { removed } },
    removed ? 'Platform default cleared' : 'No platform default was set',
  );
});

/** Unauthenticated: branding for the login page. ?tenant=<slug or id>; otherwise the platform default. */
const getPublicBranding = asyncHandler(async (req, res) => {
  const ref = String(req.query.tenant || '').trim().toLowerCase();
  let tenantId = null;
  if (ref && ref.length <= 64) {
    const t = mongoose.isValidObjectId(ref)
      ? await Tenant.findById(ref).select('_id').lean()
      : await Tenant.findOne({ slug: ref }).select('_id').lean();
    tenantId = t?._id || null;
  }
  const v = await configurationService.resolveMany(BRANDING_KEYS, tenantId);
  sendSuccess(res, {
    data: {
      companyName: v['branding.company_name'],
      primaryColor: v['branding.primary_color'],
      logoUrl: v['branding.logo_url'],
      loginLogoUrl: v['branding.login_logo_url'],
    },
  });
});

export {
  getPublicBranding,
  getEffectiveConfig,
  updateTenantConfig,
  resetTenantConfig,
  getSystemDefaults,
  setSystemDefault,
  resetSystemDefault,
};
