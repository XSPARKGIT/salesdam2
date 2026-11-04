import Consent, { CONSENT_CHANNELS } from '../models/Consent.js';
import configurationService from './configurationService.js';
import { AppError } from '../utils/errors.js';

/**
 * Communication consent & preferences (Core BRD §23).
 *
 * Recording consent writes per-channel evidence; enforcement is exposed via
 * canContact() so Flows, Custom Code and channel integrations apply the same
 * rules regardless of how a message is triggered.
 */

const getConsent = (tenantId, subjectType, subjectId) =>
  Consent.findOne({ tenantId, subjectType, subjectId });

const _normalizeInput = (value) => {
  if (value === true || value === 'true') return { optedIn: true };
  if (value === false || value === 'false') return { optedIn: false };
  if (value && typeof value === 'object') return value;
  return null;
};

/**
 * Create or update a subject's consent. `channels` accepts either a boolean
 * (`{ email: true }`) or an evidence object
 * (`{ email: { optedIn: false, source: 'web form', purpose: 'marketing' } }`).
 * Any change is appended to the history.
 */
const updateConsent = async ({
  tenantId,
  subjectType,
  subjectId,
  channels = {},
  preferredChannel,
  source = '',
  purpose = '',
  note = '',
  user,
}) => {
  if (!subjectType || !subjectId) {
    throw new AppError('subjectType and subjectId are required.', 400);
  }

  let doc = await Consent.findOne({ tenantId, subjectType, subjectId });
  if (!doc) doc = new Consent({ tenantId, subjectType, subjectId });

  const now = new Date();
  for (const [channel, raw] of Object.entries(channels || {})) {
    if (!CONSENT_CHANNELS.includes(channel)) continue; // ignore unknown keys
    const input = _normalizeInput(raw);
    if (!input) continue;

    const existing = doc.channels?.[channel] || {};
    const optedIn =
      input.optedIn === undefined ? (existing.optedIn ?? null) : input.optedIn;
    const status =
      optedIn === true ? 'granted' : optedIn === false ? 'withdrawn' : 'unknown';
    const channelSource = input.source ?? source ?? existing.source ?? '';
    const channelPurpose = input.purpose ?? purpose ?? existing.purpose ?? '';

    doc.channels[channel] = {
      optedIn,
      status,
      source: channelSource,
      purpose: channelPurpose,
      consentedAt:
        optedIn === true ? existing.consentedAt || now : existing.consentedAt,
      withdrawnAt: optedIn === false ? now : existing.withdrawnAt,
      capturedBy: user?._id || existing.capturedBy,
    };

    doc.history.push({
      channel,
      optedIn,
      status,
      source: channelSource,
      purpose: channelPurpose,
      note,
      by: user?._id,
      at: now,
    });
  }

  if (preferredChannel !== undefined) {
    doc.preferredChannel = preferredChannel || null;
  }
  doc.lastUpdatedBy = user?._id;

  await doc.save();
  return doc;
};

/**
 * Decide whether a subject may be contacted on a channel.
 *
 * Resolution: an explicit opt-out always blocks when enforcement is on; an
 * explicit opt-in always allows; unknown consent follows the tenant's
 * `consent.default_opt_in`. When enforcement is off, everything is allowed.
 *
 * @returns {Promise<{ allowed: boolean, reason: string, enforced: boolean }>}
 */
const canContact = async (tenantId, subjectType, subjectId, channel) => {
  if (!CONSENT_CHANNELS.includes(channel)) {
    throw new AppError(`Unknown communication channel '${channel}'.`, 400);
  }

  const enforced = Boolean(
    await configurationService.resolve('consent.enforcement', tenantId, false),
  );
  const defaultOptIn = Boolean(
    await configurationService.resolve('consent.default_opt_in', tenantId, true),
  );

  if (!subjectType || !subjectId) {
    return {
      allowed: !enforced || defaultOptIn,
      reason: 'no consent subject supplied',
      enforced,
    };
  }

  const doc = await getConsent(tenantId, subjectType, subjectId);
  const evidence = doc?.channels?.[channel];
  const optedIn = evidence?.optedIn ?? null;

  // Fall back to CommunicationPreference if no Consent record exists
  if (optedIn === null && !doc) {
    try {
      const CommunicationPreference = (await import('../models/CommunicationPreference.js')).default;
      const pref = await CommunicationPreference.findOne({ tenantId, objectApiName: subjectType, recordId: subjectId }).lean();
      if (pref) {
        const prefVal = pref[channel === 'email' ? 'email' : channel === 'whatsapp' ? 'whatsapp' : channel === 'telephone' ? 'telephone' : channel === 'marketing' ? 'marketing' : null];
        if (prefVal === 'opted_in' || prefVal === 'granted' || prefVal === 'allowed') {
          return { allowed: true, reason: 'consent granted (from preferences)', enforced };
        }
        if (prefVal === 'opted_out' || prefVal === 'withdrawn' || prefVal === 'denied' || prefVal === 'do_not_call') {
          if (enforced) return { allowed: false, reason: 'consent withdrawn (from preferences)', enforced };
        }
      }
    } catch { /* ignore */ }
  }

  if (optedIn === true) {
    return { allowed: true, reason: 'consent granted', enforced };
  }
  if (!enforced) {
    return {
      allowed: true,
      reason: optedIn === false ? 'opted out, enforcement disabled' : 'enforcement disabled',
      enforced,
    };
  }
  if (optedIn === false) {
    return { allowed: false, reason: 'consent withdrawn', enforced };
  }
  if (!doc) {
    return { allowed: defaultOptIn, reason: 'no consent on record', enforced };
  }
  return {
    allowed: defaultOptIn,
    reason: 'consent not recorded for channel',
    enforced,
  };
};

export default { CONSENT_CHANNELS, getConsent, updateConsent, canContact };
