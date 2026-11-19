import TenantConfiguration from '../models/TenantConfiguration.js';
import configurationService from './configurationService.js';
import { CURRENCIES } from '../constants/currencies.js';

const FALLBACK = { code: 'ZAR', name: 'South African Rand', symbol: 'R' };
const byCode = (code) => CURRENCIES.find((c) => c.code === String(code || '').toUpperCase());

/**
 * The currency a tenant sees. Single resolution path (BRD §14.2): the tenant's own
 * `platform.default_currency` entry, then the platform-wide entry, then — for tenants
 * that predate this setting — the tenant's stored operating currency, then the built-in ZAR.
 */
const effectiveCurrency = async (tenant) => {
  const tenantId = tenant?._id || tenant?.id || null;
  if (tenantId) {
    const docs = await TenantConfiguration.find({
      key: 'platform.default_currency',
      tenantId: { $in: [tenantId, null] },
    }).lean();
    const doc = docs.find((d) => d.tenantId) || docs.find((d) => !d.tenantId);
    const hit = doc && byCode(doc.value);
    if (hit) return { code: hit.code, name: hit.name, symbol: hit.symbol };
  }
  const legacy = tenant?.operatingCurrency;
  if (legacy?.code) return { code: legacy.code, name: legacy.name || legacy.code, symbol: legacy.symbol || legacy.code };
  const code = await configurationService.resolve('platform.default_currency', tenantId, 'ZAR');
  const d = byCode(code);
  return d ? { code: d.code, name: d.name, symbol: d.symbol } : FALLBACK;
};

export default { effectiveCurrency, byCode };
