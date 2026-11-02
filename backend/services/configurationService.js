import TenantConfiguration from '../models/TenantConfiguration.js';
import { AppError } from '../utils/errors.js';
import logger from '../utils/logger.js';

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
};

const hasDefault = (key) =>
  Object.prototype.hasOwnProperty.call(SYSTEM_DEFAULTS, key);

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
  if (tenantDoc) return tenantDoc.value;

  const systemDoc = docs.find((d) => !d.tenantId);
  if (systemDoc) return systemDoc.value;

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
      result[key] = tenantDoc.value;
      continue;
    }
    const systemDoc = docs.find((d) => d.key === key && !d.tenantId);
    if (systemDoc) {
      result[key] = systemDoc.value;
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

    entries.push({
      key,
      value,
      source,
      isOverridden: source === 'tenant',
      ...metaFor(key, tenantDoc || systemDoc || {}),
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
        value: castValue(value, meta.dataType),
        dataType: meta.dataType,
        category: meta.category,
        label: meta.label,
        description: meta.description,
        editableByTenant: meta.editableByTenant,
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
