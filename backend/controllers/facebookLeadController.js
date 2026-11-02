import ObjectMeta from '../models/ObjectMeta.js';
import FieldMeta from '../models/FieldMeta.js';
import DynamicRecord from '../models/DynamicRecord.js';
import IncomingWebhookLog from '../models/IncomingWebhookLog.js';
import channelService from '../services/channelService.js';
import channelProviders from '../services/channelProviders.js';
import duplicateDetectionService from '../services/duplicateDetectionService.js';
import { buildSearchText } from '../services/searchService.js';
import { fireAutomations } from '../services/automationService.js';
import { asyncHandler, sendSuccess, AppError } from '../utils/errors.js';
import logger from '../utils/logger.js';

/**
 * Meta Lead Ads integration (Core BRD §16.1).
 *
 * Unlike the earlier version of this controller, the tenant and target object
 * are never taken from the request body — they are resolved from a signed,
 * tenant-owned ChannelAccount (channel='facebook', provider='meta_leadgen'),
 * exactly like every other channel webhook (channelService.resolveWebhookAccount).
 * An unsigned or wrongly-signed request is rejected before anything else runs.
 */

/** Meta's webhook subscription handshake: echo hub.challenge once the verify
 * token (the account's webhookSecret) matches. GET has no signature to check. */
const verifySubscription = asyncHandler(async (req, res) => {
  // Express's query parser (qs) expands a dotted key like "hub.mode" into a
  // nested { hub: { mode } } rather than a literal "hub.mode" key — and Meta
  // sends literal dotted keys — so parse the raw query string instead of
  // trusting req.query here.
  const params = new URLSearchParams(req.url.split('?')[1] || '');
  const mode = params.get('hub.mode');
  const token = params.get('hub.verify_token');
  const challenge = params.get('hub.challenge');
  // The handshake carries no tenant context (no session, no signed body yet),
  // so the account is looked up by id alone; its webhookSecret doubles as the
  // Meta "verify token" an admin configures in the Meta app dashboard.
  const ChannelAccount = (await import('../models/ChannelAccount.js')).default;
  const account = await ChannelAccount.findOne({
    _id: req.params.accountId,
    channel: 'facebook',
  }).select('+webhookSecret');
  if (mode === 'subscribe' && account && token && token === account.webhookSecret) {
    return res.status(200).send(challenge);
  }
  return res.status(403).send('Verification failed');
});

const labelToAlias = { first_name: 'first_name', last_name: 'last_name', email: 'email', phone_number: 'phone', phone: 'phone', company_name: 'company' };

/** Resolve one Meta field name to a Salesdam Lead field apiName. */
const resolveFieldMapping = ({ metaFieldName, formId, fieldMappings, fieldByName, labelToApi }) => {
  const explicit = (fieldMappings || []).find(
    (m) => m.metaFieldName === metaFieldName && (!m.formId || m.formId === formId),
  );
  if (explicit) return explicit.salesdamFieldApiName;
  if (fieldByName[metaFieldName]) return metaFieldName;
  if (labelToApi[metaFieldName]) return labelToApi[metaFieldName];
  return labelToAlias[metaFieldName];
};

/** Create one Lead from a resolved Meta lead payload (already fetched field_data). */
const createLeadFromFieldData = async ({ account, formId, leadgenId, pageId, adId, campaignId, fieldData }) => {
  const tenantId = account.tenantId;
  const [obj, fields] = await Promise.all([
    ObjectMeta.findOne({ tenantId, apiName: 'lead' }),
    FieldMeta.find({ tenantId, objectApiName: 'lead' }),
  ]);
  if (!obj) throw new AppError('Lead object not found for this tenant.', 404);

  const fieldByName = Object.fromEntries(fields.map((f) => [f.apiName, f]));
  const labelToApi = Object.fromEntries(
    fields.map((f) => [f.label?.toLowerCase(), f.apiName]).filter(([k]) => k),
  );

  const data = {};
  for (const fd of fieldData || []) {
    const metaFieldName = (fd.name || '').toLowerCase();
    const value = Array.isArray(fd.values) ? fd.values[0] : fd.values;
    const apiName = resolveFieldMapping({
      metaFieldName,
      formId,
      fieldMappings: account.fieldMappings,
      fieldByName,
      labelToApi,
    });
    if (apiName && fieldByName[apiName]) data[apiName] = value;
  }
  if (campaignId && fieldByName.lead_source) data.lead_source = `facebook:${campaignId}`;
  else if (fieldByName.lead_source) data.lead_source = 'facebook';

  // Duplicate matching (§16.1) — the same rules manual capture and import use.
  const duplicateCheck = await duplicateDetectionService.check(tenantId, 'lead', data, {});
  if (duplicateCheck.action === 'block') {
    return { skipped: 'duplicate', duplicates: duplicateCheck.matches };
  }

  const record = new DynamicRecord({
    tenantId,
    objectId: obj._id,
    objectApiName: 'lead',
    // Automatic assignment (§16.1) reuses the channel account's configured
    // default owner — Salesdam has no standalone lead-assignment-rule engine
    // to call into; this is the same fallback createRecordFromConversation uses.
    ownerId: account.defaultOwnerId || null,
    createdBy: null,
    lastModifiedBy: null,
  });
  Object.entries(data).forEach(([k, v]) => record.setField(k, v));
  record._searchText = await buildSearchText(record, fields);
  await record.save();

  try {
    await fireAutomations('create', 'lead', record.toObject(), tenantId);
  } catch (e) {
    logger.warn(`Flow trigger failed for Facebook lead ${record._id}: ${e.message}`);
  }

  logger.info(
    `Facebook lead created: ${record._id} (leadgenId=${leadgenId}, formId=${formId}, pageId=${pageId}, adId=${adId || ''})`,
  );
  return { leadId: record._id, duplicateMatches: duplicateCheck.action === 'warn' ? duplicateCheck.matches : [] };
};

/**
 * POST /api/v1/integrations/facebook/leadgen/:accountId
 * Accepts Meta's real leadgen webhook envelope:
 *   { object: 'page', entry: [{ id, changes: [{ field: 'leadgen', value: {
 *       leadgen_id, form_id, page_id, ad_id, campaign_id, created_time,
 *       field_data?  // only present in test fixtures; real Meta omits it
 *   } }] }] }
 * Real deliveries omit field_data — it is fetched via the Graph API using the
 * account's pageAccessToken. A fixture body may supply field_data directly so
 * this can be tested without live credentials.
 */
const handleLeadgen = asyncHandler(async (req, res) => {
  const account = await channelService.resolveWebhookAccount({
    channel: 'facebook',
    accountId: req.params.accountId,
    req,
  });

  const body = req.body || {};
  const entries = body.entry || [];
  const results = [];

  for (const entry of entries) {
    for (const change of entry.changes || []) {
      if (change.field !== 'leadgen') continue;
      const value = change.value || {};
      const { leadgen_id: leadgenId, form_id: formId, page_id: pageId, ad_id: adId, campaign_id: campaignId } = value;
      if (!leadgenId) {
        results.push({ error: 'leadgen event missing leadgen_id' });
        continue;
      }

      // Idempotency (§16.1): a redelivered leadgen_id must not create a second
      // lead. The unique index on (tenantId, source, externalEventId) is the
      // actual guard — this pre-check just avoids an unnecessary Graph call.
      let log;
      try {
        log = await IncomingWebhookLog.create({
          tenantId: account.tenantId,
          source: 'facebook_leadgen',
          eventType: 'leadgen',
          payload: value,
          externalEventId: leadgenId,
          status: 'received',
        });
      } catch (err) {
        if (err.code === 11000) {
          results.push({ leadgenId, duplicate: true });
          continue;
        }
        throw err;
      }

      try {
        let fieldData = value.field_data;
        if (!fieldData) {
          const lead = await channelProviders.fetchLeadFieldData(account, leadgenId);
          fieldData = lead.field_data || [];
        }
        const outcome = await createLeadFromFieldData({
          account,
          formId,
          leadgenId,
          pageId,
          adId,
          campaignId,
          fieldData,
        });
        log.status = 'processed';
        log.action = 'create';
        log.objectApiName = 'lead';
        log.recordId = outcome.leadId;
        log.processedAt = new Date();
        await log.save();
        results.push({ leadgenId, ...outcome });
      } catch (err) {
        log.status = 'failed';
        log.error = err.message;
        await log.save();
        logger.error(`Facebook lead processing failed (leadgenId=${leadgenId}): ${err.message}`);
        results.push({ leadgenId, error: err.message });
      }
    }
  }

  sendSuccess(res, { data: { accepted: results.length, results } }, 'Webhook accepted', 202);
});

export { handleLeadgen, verifySubscription };
