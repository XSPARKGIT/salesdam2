import CommunicationPreference from '../models/CommunicationPreference.js';
import ConsentEvidence from '../models/ConsentEvidence.js';
import DynamicRecord from '../models/DynamicRecord.js';
import { hasObjectPermission } from '../middleware/permissions.js';
import { asyncHandler, sendSuccess, AppError } from '../utils/errors.js';
import { audit } from '../utils/auditLogger.js';

const resolveRecord = async (tenantId, objectApiName, recordId) => {
  const rec = await DynamicRecord.findOne({ _id: recordId, tenantId, objectApiName, isDeleted: false });
  if (!rec) throw new AppError('Record not found.', 404);
  return rec;
};

const getPrefs = asyncHandler(async (req, res) => {
  const { objectApiName, recordId } = req.query;
  if (!(await hasObjectPermission(req.user, 'read', objectApiName))) throw new AppError('Permission denied.', 403);
  await resolveRecord(req.tenantId, objectApiName, recordId);
  let pref = await CommunicationPreference.findOne({ tenantId: req.tenantId, objectApiName, recordId });
  if (!pref) pref = { tenantId: req.tenantId, objectApiName, recordId, email: 'unknown', whatsapp: 'unknown', telephone: 'unknown', marketing: 'unknown', preferredChannel: 'none' };
  sendSuccess(res, { data: pref });
});

const updatePrefs = asyncHandler(async (req, res) => {
  const { objectApiName, recordId, email, whatsapp, telephone, marketing, preferredChannel } = req.body;
  if (!(await hasObjectPermission(req.user, 'update', objectApiName))) throw new AppError('Permission denied.', 403);
  await resolveRecord(req.tenantId, objectApiName, recordId);

  const allowedEmail = ['unknown', 'opted_in', 'opted_out'];
  const allowedWa = ['unknown', 'opted_in', 'opted_out'];
  const allowedTel = ['unknown', 'allowed', 'do_not_call'];
  const allowedMk = ['unknown', 'granted', 'denied', 'withdrawn'];
  const allowedCh = ['none', 'email', 'whatsapp', 'telephone'];
  if (email && !allowedEmail.includes(email)) throw new AppError('Invalid email preference.', 400);
  if (whatsapp && !allowedWa.includes(whatsapp)) throw new AppError('Invalid whatsapp preference.', 400);
  if (telephone && !allowedTel.includes(telephone)) throw new AppError('Invalid telephone preference.', 400);
  if (marketing && !allowedMk.includes(marketing)) throw new AppError('Invalid marketing preference.', 400);
  if (preferredChannel && !allowedCh.includes(preferredChannel)) throw new AppError('Invalid preferred channel.', 400);

  const pref = await CommunicationPreference.findOneAndUpdate(
    { tenantId: req.tenantId, objectApiName, recordId },
    { $set: { email, whatsapp, telephone, marketing, preferredChannel, updatedBy: req.user._id } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  await audit({ tenantId: req.tenantId, userId: req.user._id, action: 'comm_pref_update', resource: 'CommunicationPreference', resourceId: pref._id, req });
  sendSuccess(res, { data: pref });
});

const listConsent = asyncHandler(async (req, res) => {
  const { objectApiName, recordId } = req.query;
  if (!(await hasObjectPermission(req.user, 'read', objectApiName))) throw new AppError('Permission denied.', 403);
  await resolveRecord(req.tenantId, objectApiName, recordId);
  const items = await ConsentEvidence.find({ tenantId: req.tenantId, objectApiName, recordId }).sort({ eventAt: -1 });
  sendSuccess(res, { data: items });
});

const createConsent = asyncHandler(async (req, res) => {
  const { objectApiName, recordId, status, purpose, source, eventAt, withdrawalAt, metadata } = req.body;
  if (!(await hasObjectPermission(req.user, 'update', objectApiName))) throw new AppError('Permission denied.', 403);
  await resolveRecord(req.tenantId, objectApiName, recordId);
  const allowedStatus = ['unknown', 'pending', 'granted', 'denied', 'withdrawn'];
  if (!allowedStatus.includes(status)) throw new AppError('Invalid consent status.', 400);
  if (!purpose || !source) throw new AppError('purpose and source are required.', 400);
  const ev = await ConsentEvidence.create({
    tenantId: req.tenantId,
    objectApiName,
    recordId,
    status,
    purpose,
    source,
    eventAt: eventAt ? new Date(eventAt) : new Date(),
    capturedBy: req.user._id,
    withdrawalAt: withdrawalAt ? new Date(withdrawalAt) : undefined,
    metadata,
  });
  // Update current marketing preference if marketing purpose
  if (purpose.toLowerCase().includes('marketing')) {
    const marketing = status === 'granted' ? 'granted' : status === 'withdrawn' ? 'withdrawn' : status === 'denied' ? 'denied' : 'unknown';
    await CommunicationPreference.findOneAndUpdate(
      { tenantId: req.tenantId, objectApiName, recordId },
      { $set: { marketing, updatedBy: req.user._id } },
      { upsert: true, setDefaultsOnInsert: true },
    );
  }
  await audit({ tenantId: req.tenantId, userId: req.user._id, action: 'consent_create', resource: 'ConsentEvidence', resourceId: ev._id, req });
  sendSuccess(res, { data: ev }, 'Consent recorded', 201);
});

export { getPrefs, updatePrefs, listConsent, createConsent };
