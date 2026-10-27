import DynamicRecord from '../models/DynamicRecord.js';
import ObjectMeta from '../models/ObjectMeta.js';
import FieldMeta from '../models/FieldMeta.js';
import { asyncHandler, sendSuccess, AppError } from '../utils/errors.js';
import { fireAutomations } from '../services/automationService.js';
import logger from '../utils/logger.js';

/**
 * POST /api/v1/integrations/facebook/leadgen
 * Accepts a Meta Lead Ads webhook payload and creates a Lead record.
 * Body: { tenantId, pageId, formId, leadgenId, fieldData: [{name, values}], campaignId?, adId? }
 */
const handleLeadgen = asyncHandler(async (req, res) => {
  const { tenantId, fieldData = [], campaignId, adId, leadgenId } = req.body || {};
  if (!tenantId) throw new AppError('tenantId is required.', 400);

  const [obj, fields] = await Promise.all([
    ObjectMeta.findOne({ tenantId, apiName: 'lead' }),
    FieldMeta.find({ tenantId, objectApiName: 'lead' }),
  ]);
  if (!obj) throw new AppError('Lead object not found for tenant.', 404);

  // Build field map: Meta field name -> value
  const metaMap = {};
  for (const fd of fieldData) {
    const key = (fd.name || '').toLowerCase();
    const val = Array.isArray(fd.values) ? fd.values[0] : fd.values;
    metaMap[key] = val;
  }

  // Map Meta standard fields to Salesdam lead fields
  const fieldByName = Object.fromEntries(fields.map((f) => [f.apiName, f]));
  const labelToApi = Object.fromEntries(fields.map((f) => [f.label?.toLowerCase(), f.apiName]));

  const data = {};
  for (const [metaKey, val] of Object.entries(metaMap)) {
    // Try direct apiName match, then label match, then common aliases
    let apiName = fieldByName[metaKey]?.apiName || labelToApi[metaKey];
    if (!apiName) {
      const aliases = { first_name: 'first_name', last_name: 'last_name', email: 'email', phone: 'phone', company: 'company' };
      apiName = aliases[metaKey];
    }
    if (apiName && fieldByName[apiName]) data[apiName] = val;
  }

  // Campaign attribution
  if (campaignId) data.lead_source = `facebook:${campaignId}`;
  if (adId) data.ad_id = adId;
  if (leadgenId) data.leadgen_id = leadgenId;

  const record = new (await import('../models/DynamicRecord.js')).default({
    tenantId,
    objectId: obj._id,
    objectApiName: 'lead',
    ownerId: null,
    createdBy: null,
    lastModifiedBy: null,
  });
  Object.entries(data).forEach(([k, v]) => record.setField(k, v));
  const { buildSearchText } = await import('../services/searchService.js');
  record._searchText = await buildSearchText(record, fields);
  await record.save();

  // Trigger flows
  try {
    await fireAutomations('create', 'lead', record.toObject(), tenantId);
  } catch (e) {
    logger.warn(`Flow trigger failed for fb lead: ${e.message}`);
  }

  logger.info(`Facebook lead created: ${record._id} (leadgenId=${leadgenId})`);
  sendSuccess(res, { data: { id: record._id } }, 'Lead created', 201);
});

export { handleLeadgen };