import TenantConfiguration from '../models/TenantConfiguration.js';
import { AppError } from '../utils/errors.js';
import logger from '../utils/logger.js';
import { encryptSecret as _encryptSecret, decryptSecret as _decryptSecret, isEncrypted } from '../utils/secretCrypto.js';

/**
 * Code-level system defaults. These are used when neither a tenant-specific
 * nor a stored platform-wide (tenantId: null) entry exists, so a fresh database
 * still resolves every known key. Keys live here to keep the platform
 * operator's defaults under version control (BRD Core §14).
 *
 * Naming: <domain>.<setting>, lower snake_case.
 */
export const SYSTEM_DEFAULTS = {
  'approvals.threshold_amount': {
    value: 0,
    dataType: 'number',
    category: 'approvals',
    label: 'Approval Threshold Amount',
    description:
      'Records with an amount above this value enter the approval process.',
    editableByTenant: true,
  },
  'records.recycle_bin_retention_days': {
    value: 30,
    dataType: 'number',
    category: 'records',
    label: 'Recycle Bin Retention (days)',
    description: 'How long soft-deleted records are retained before purge.',
    editableByTenant: true,
  },
  'platform.default_currency': {
    value: 'ZAR',
    dataType: 'string',
    category: 'platform',
    label: 'Default Currency',
    description: 'ISO 4217 currency code used when none is specified.',
    editableByTenant: true,
  },
  'deals.minimum_value': {
    value: 0,
    dataType: 'number',
    category: 'deals',
    label: 'Minimum Deal Value',
    description:
      'Smallest deal amount a tenant accepts. Validation rules can read it with CONFIG("deals.minimum_value"); 0 means no minimum.',
    editableByTenant: true,
  },
  'consent.enforcement': {
    value: false,
    dataType: 'boolean',
    category: 'consent',
    label: 'Enforce Communication Consent',
    description:
      'When on, outbound communication is blocked for channels the customer has opted out of.',
    editableByTenant: true,
  },
  'consent.default_opt_in': {
    value: true,
    dataType: 'boolean',
    category: 'consent',
    label: 'Default Opt-In (unknown consent)',
    description:
      'Whether a customer with no recorded consent may be contacted when enforcement is on.',
    editableByTenant: true,
  },

  // ── Branding (Section 14) ───────────────────────────────────────────────
  'branding.company_name': {
    value: 'Salesdam',
    dataType: 'string',
    category: 'branding',
    label: 'Company Name',
    description: 'Company name shown in the application header and login page.',
    editableByTenant: true,
  },
  'branding.primary_color': {
    value: '#0066FF',
    dataType: 'string',
    category: 'branding',
    label: 'Primary Brand Colour',
    description: 'Hex colour used for primary UI accents.',
    editableByTenant: true,
  },
  'branding.logo_url': {
    value: '',
    dataType: 'string',
    category: 'branding',
    label: 'Company Logo URL',
    description: 'URL to the company logo shown in the application header.',
    editableByTenant: true,
  },
  'branding.login_logo_url': {
    value: '',
    dataType: 'string',
    category: 'branding',
    label: 'Login Page Logo URL',
    description: 'URL to the logo shown on the login page.',
    editableByTenant: true,
  },

  // ── Integration secrets (Section 14) ────────────────────────────────────
  'integration.email.smtp_password': {
    value: '',
    dataType: 'string',
    category: 'integration',
    label: 'SMTP Password',
    description: 'SMTP password for outbound email. Stored encrypted.',
    editableByTenant: true,
    isSecret: true,
  },
  'integration.email.smtp_host': {
    value: '',
    dataType: 'string',
    category: 'integration',
    label: 'SMTP Host',
    description: 'SMTP server hostname for outbound email.',
    editableByTenant: true,
  },
  'integration.whatsapp.access_token': {
    value: '',
    dataType: 'string',
    category: 'integration',
    label: 'WhatsApp Access Token',
    description: 'WhatsApp Business API access token. Stored encrypted.',
    editableByTenant: true,
    isSecret: true,
  },
  'integration.meta.app_secret': {
    value: '',
    dataType: 'string',
    category: 'integration',
    label: 'Meta App Secret',
    description: 'Meta (Facebook) app secret. Stored encrypted.',
    editableByTenant: true,
    isSecret: true,
  },
  'integration.telephony.api_key': {
    value: '',
    dataType: 'string',
    category: 'integration',
    label: 'Telephony API Key',
    description: 'Telephony provider API key. Stored encrypted.',
    editableByTenant: true,
    isSecret: true,
  },
  'integration.webhook.secret': {
    value: '',
    dataType: 'string',
    category: 'integration',
    label: 'Webhook Secret',
    description: 'Shared secret for incoming webhooks. Stored encrypted.',
    editableByTenant: true,
    isSecret: true,
  },
  'communication.default_template': {
    value: '',
    dataType: 'string',
    category: 'communication',
    label: 'Default Communication Template',
    description: 'Default template used for outbound communications.',
    editableByTenant: true,
  },
  'records.call_recording_retention_days': {
    value: 30,
    dataType: 'number',
    category: 'records',
    label: 'Call Recording Retention (days)',
    description: 'How long call recordings are retained.',
    editableByTenant: true,
  },

  // ── File storage (Section 19) ────────────────────────────────────────────
  'files.max_file_size_mb': {
    value: 10,
    dataType: 'number',
    category: 'files',
    label: 'Maximum File Size (MB)',
    description: 'Maximum size of a single uploaded file.',
    editableByTenant: true,
  },
  'files.allowed_types': {
    value: 'image/jpeg,image/png,image/gif,image/webp,application/pdf,text/plain',
    dataType: 'string',
    category: 'files',
    label: 'Allowed File Types',
    description: 'Comma-separated list of permitted MIME types for uploads.',
    editableByTenant: true,
  },

  // ── Authentication & Session Security (Core BRD §21) ─────────────────────
  'auth.password_min_length': {
    value: 8,
    dataType: 'number',
    category: 'auth',
    label: 'Minimum Password Length',
    description: 'Shortest password accepted when a user sets or resets their password.',
    editableByTenant: true,
  },
  'auth.password_require_uppercase': {
    value: false,
    dataType: 'boolean',
    category: 'auth',
    label: 'Require Uppercase Letter',
    description: 'A new password must contain at least one uppercase letter.',
    editableByTenant: true,
  },
  'auth.password_require_lowercase': {
    value: false,
    dataType: 'boolean',
    category: 'auth',
    label: 'Require Lowercase Letter',
    description: 'A new password must contain at least one lowercase letter.',
    editableByTenant: true,
  },
  'auth.password_require_number': {
    value: false,
    dataType: 'boolean',
    category: 'auth',
    label: 'Require Number',
    description: 'A new password must contain at least one digit.',
    editableByTenant: true,
  },
  'auth.password_require_symbol': {
    value: false,
    dataType: 'boolean',
    category: 'auth',
    label: 'Require Symbol',
    description: 'A new password must contain at least one special character.',
    editableByTenant: true,
  },
  'auth.max_failed_login_attempts': {
    value: 5,
    dataType: 'number',
    category: 'auth',
    label: 'Max Failed Login Attempts',
    description: 'Number of consecutive failed logins before the account is locked.',
    editableByTenant: true,
  },
  'auth.lockout_duration_minutes': {
    value: 30,
    dataType: 'number',
    category: 'auth',
    label: 'Lockout Duration (minutes)',
    description: 'How long an account stays locked after too many failed logins.',
    editableByTenant: true,
  },
  'auth.session_inactivity_timeout_minutes': {
    value: 0,
    dataType: 'number',
    category: 'auth',
    label: 'Session Inactivity Timeout (minutes)',
    description: 'Automatically end a session after this many minutes of inactivity. 0 disables inactivity timeout (the absolute session lifetime still applies).',
    editableByTenant: true,
  },
  'auth.mfa_required': {
    value: false,
    dataType: 'boolean',
    category: 'auth',
    label: 'Require Multi-Factor Authentication',
    description: 'Every user in this tenant must complete MFA to sign in. When set as a platform default that tenants cannot override, this enforces MFA platform-wide.',
    editableByTenant: true,
  },
  'auth.sso_enabled': {
    value: false,
    dataType: 'boolean',
    category: 'auth',
    label: 'Single Sign-On Enabled',
    description: 'Allow this tenant to sign in through its configured identity provider.',
    editableByTenant: true,
  },
  'auth.sso_provider': {
    value: '',
    dataType: 'string',
    category: 'auth',
    label: 'SSO Provider Type',
    description: 'Identity provider protocol, e.g. "oidc".',
    editableByTenant: true,
  },
  'auth.sso_issuer': {
    value: '',
    dataType: 'string',
    category: 'auth',
    label: 'SSO Issuer URL',
    description: 'The identity provider’s issuer/discovery URL.',
    editableByTenant: true,
  },
  'auth.sso_client_id': {
    value: '',
    dataType: 'string',
    category: 'auth',
    label: 'SSO Client ID',
    description: 'The client/application ID registered with the identity provider.',
    editableByTenant: true,
  },
  'auth.sso_client_secret': {
    value: '',
    dataType: 'string',
    category: 'auth',
    label: 'SSO Client Secret',
    description: 'The client secret registered with the identity provider. Stored encrypted.',
    editableByTenant: true,
    isSecret: true,
  },
};

const hasDefault = (key) =>
  Object.prototype.hasOwnProperty.call(SYSTEM_DEFAULTS, key);

// This service's own secrets (tenant config values) stay on the original
// 'salesdam-config-salt' domain — unchanged from before the extraction.
const encryptSecret = (plaintext) => _encryptSecret(plaintext, 'salesdam-config-salt');
const decryptSecret = (stored) => _decryptSecret(stored, 'salesdam-config-salt');

const maskSecret = () => '••••••••';

const metaFor = (key, doc = {}) => {
  const base = hasDefault(key) ? SYSTEM_DEFAULTS[key] : {};
  return {
    dataType: doc.dataType || base.dataType || 'string',
    category: doc.category || base.category || 'general',
    label: doc.label || base.label || key,
    description: doc.description || base.description || '',
    editableByTenant:
      doc.editableByTenant !== undefined
        ? doc.editableByTenant
        : base.editableByTenant !== undefined
          ? base.editableByTenant
          : true,
    isSecret: doc.isSecret !== undefined ? doc.isSecret : base.isSecret === true,
  };
};

const castValue = (value, dataType) => {
  switch (dataType) {
    case 'number': {
      const n = Number(value);
      if (value === '' || value === null || Number.isNaN(n)) {
        throw new AppError('Value must be a number.', 400);
      }
      return n;
    }
    case 'boolean':
      return value === true || value === 'true' || value === 1 || value === '1';
    case 'json':
      if (typeof value === 'string') {
        try {
          return JSON.parse(value);
        } catch {
          throw new AppError('Value must be valid JSON.', 400);
        }
      }
      return value;
    default:
      return value === null || value === undefined ? '' : String(value);
  }
};

/**
 * Resolve a single key for a tenant.
 * Tenant entry → platform-wide (null) entry → code default → provided fallback.
 */
const resolve = async (key, tenantId = null, fallback = undefined) => {
  const scope = tenantId ? [tenantId, null] : [null];
  const docs = await TenantConfiguration.find({
    key,
    tenantId: { $in: scope },
  }).lean();

  const tenantDoc = tenantId
    ? docs.find((d) => d.tenantId && d.tenantId.toString() === tenantId.toString())
    : null;
  if (tenantDoc) return isEncrypted(tenantDoc.value) ? decryptSecret(tenantDoc.value) : tenantDoc.value;

  const systemDoc = docs.find((d) => !d.tenantId);
  if (systemDoc) return isEncrypted(systemDoc.value) ? decryptSecret(systemDoc.value) : systemDoc.value;

  if (hasDefault(key)) return SYSTEM_DEFAULTS[key].value;
  return fallback;
};

/**
 * Resolve many keys at once. Returns a plain { key: value } object; keys that
 * resolve to undefined and have no fallback are omitted.
 */
const resolveMany = async (keys, tenantId = null) => {
  const scope = tenantId ? [tenantId, null] : [null];
  const docs = await TenantConfiguration.find({
    key: { $in: keys },
    tenantId: { $in: scope },
  }).lean();

  const result = {};
  for (const key of keys) {
    const tenantDoc = tenantId
      ? docs.find(
          (d) =>
            d.key === key &&
            d.tenantId &&
            d.tenantId.toString() === tenantId.toString(),
        )
      : null;
    if (tenantDoc) {
      result[key] = isEncrypted(tenantDoc.value) ? decryptSecret(tenantDoc.value) : tenantDoc.value;
      continue;
    }
    const systemDoc = docs.find((d) => d.key === key && !d.tenantId);
    if (systemDoc) {
      result[key] = isEncrypted(systemDoc.value) ? decryptSecret(systemDoc.value) : systemDoc.value;
      continue;
    }
    if (hasDefault(key)) result[key] = SYSTEM_DEFAULTS[key].value;
  }
  return result;
};

/**
 * Every key visible to `tenantId`, with its effective value and where it came
 * from ('tenant' | 'system' | 'default'). Used by the admin configuration UI.
 */
const getEffective = async (tenantId = null) => {
  const scope = tenantId ? [tenantId, null] : [null];
  const docs = await TenantConfiguration.find({
    tenantId: { $in: scope },
  }).lean();

  const keys = new Set(Object.keys(SYSTEM_DEFAULTS));
  docs.forEach((d) => keys.add(d.key));

  const entries = [];
  for (const key of keys) {
    const tenantDoc = tenantId
      ? docs.find(
          (d) =>
            d.key === key &&
            d.tenantId &&
            d.tenantId.toString() === tenantId.toString(),
        )
      : null;
    const systemDoc = docs.find((d) => d.key === key && !d.tenantId);

    let source = 'default';
    let value;
    if (tenantDoc) {
      source = 'tenant';
      value = tenantDoc.value;
    } else if (systemDoc) {
      source = 'system';
      value = systemDoc.value;
    } else {
      value = SYSTEM_DEFAULTS[key].value;
    }

    const meta = metaFor(key, tenantDoc || systemDoc || {});
    if (meta.isSecret) {
      value = value ? maskSecret() : '';
    }

    entries.push({
      key,
      value,
      source,
      isOverridden: source === 'tenant',
      ...meta,
    });
  }
  entries.sort((a, b) => a.key.localeCompare(b.key));
  return entries;
};

/**
 * Upsert a configuration entry. `tenantId: null` writes the platform-wide
 * default (operator-level); a real tenantId writes a tenant override.
 */
const set = async ({ key, tenantId = null, value, dataType, category, label, description, editableByTenant, updatedBy } = {}) => {
  if (!key) throw new AppError('Configuration key is required.', 400);

  const existing = await TenantConfiguration.findOne({ key, tenantId }).lean();
  const meta = metaFor(key, {
    dataType: dataType || existing?.dataType,
    category: category || existing?.category,
    label: label || existing?.label,
    description: description || existing?.description,
    editableByTenant:
      editableByTenant !== undefined ? editableByTenant : existing?.editableByTenant,
  });

  const doc = await TenantConfiguration.findOneAndUpdate(
    { key, tenantId },
    {
      $set: {
        value: meta.isSecret
          ? (value === '' || value === null || value === undefined
              ? ''
              : encryptSecret(value))
          : castValue(value, meta.dataType),
        dataType: meta.dataType,
        category: meta.category,
        label: meta.label,
        description: meta.description,
        editableByTenant: meta.editableByTenant,
        isSecret: meta.isSecret,
        ...(updatedBy ? { updatedBy } : {}),
      },
      $setOnInsert: { key, tenantId },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  return doc;
};

/**
 * Remove an entry so the scope above it applies again.
 * Clears the tenant override when tenantId is set, otherwise the system default.
 */
const clear = async (key, tenantId = null) => {
  const res = await TenantConfiguration.deleteOne({ key, tenantId });
  return res.deletedCount > 0;
};

/**
 * Whether a key is exposed for tenant-level override: either a known code
 * default or an operator-created platform-wide entry, and marked editable.
 */
const isTenantEditable = async (key) => {
  const systemDoc = await TenantConfiguration.findOne({
    key,
    tenantId: null,
  }).lean();
  const meta = metaFor(key, systemDoc || {});
  const known = hasDefault(key) || Boolean(systemDoc);
  return known && meta.editableByTenant;
};

/**
 * Seed the code-level defaults into the database as platform-wide entries.
 * Idempotent; operator-level values already present are left untouched.
 * Used by the bootstrap script so admins can see defaults without a tenant.
 */
const seedSystemDefaults = async () => {
  let created = 0;
  for (const [key, def] of Object.entries(SYSTEM_DEFAULTS)) {
    const existing = await TenantConfiguration.findOne({ key, tenantId: null });
    if (existing) continue;
    await TenantConfiguration.create({
      key,
      tenantId: null,
      value: def.value,
      dataType: def.dataType,
      category: def.category,
      label: def.label,
      description: def.description,
      editableByTenant: def.editableByTenant !== false,
    });
    created += 1;
  }
  logger.info(`TenantConfiguration: seeded ${created} system default(s)`);
  return created;
};

export default {
  SYSTEM_DEFAULTS,
  resolve,
  resolveMany,
  getEffective,
  set,
  clear,
  isTenantEditable,
  seedSystemDefaults,
};
