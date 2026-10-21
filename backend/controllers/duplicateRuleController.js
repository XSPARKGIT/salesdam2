import DuplicateRule from '../models/DuplicateRule.js';
import duplicateDetectionService from '../services/duplicateDetectionService.js';
import { asyncHandler, sendSuccess, AppError } from '../utils/errors.js';

const listRules = asyncHandler(async (req, res) => {
  const filter = { tenantId: req.tenantId };
  if (req.query.objectApiName) filter.objectApiName = req.query.objectApiName;
  const rules = await DuplicateRule.find(filter).sort({ createdAt: -1 });
  sendSuccess(res, { data: rules });
});

const getRule = asyncHandler(async (req, res) => {
  const rule = await DuplicateRule.findOne({
    _id: req.params.id,
    tenantId: req.tenantId,
  });
  if (!rule) throw new AppError('Duplicate rule not found.', 404);
  sendSuccess(res, { data: rule });
});

const createRule = asyncHandler(async (req, res) => {
  const { name, objectApiName, conditions } = req.body || {};
  if (!name || !objectApiName) {
    throw new AppError('A name and object are required.', 400);
  }
  if (!Array.isArray(conditions) || conditions.length === 0) {
    throw new AppError('At least one field condition is required.', 400);
  }
  const rule = await DuplicateRule.create({
    ...req.body,
    tenantId: req.tenantId,
    createdBy: req.user._id,
  });
  sendSuccess(res, { data: rule }, 'Duplicate rule created', 201);
});

const updateRule = asyncHandler(async (req, res) => {
  // Never let the body move a rule to another tenant or rewrite its author.
  // eslint-disable-next-line no-unused-vars
  const { tenantId, createdBy, _id, ...updates } = req.body || {};
  const rule = await DuplicateRule.findOneAndUpdate(
    { _id: req.params.id, tenantId: req.tenantId },
    { $set: updates },
    { new: true, runValidators: true },
  );
  if (!rule) throw new AppError('Duplicate rule not found.', 404);
  sendSuccess(res, { data: rule }, 'Duplicate rule updated');
});

const deleteRule = asyncHandler(async (req, res) => {
  const rule = await DuplicateRule.findOneAndDelete({
    _id: req.params.id,
    tenantId: req.tenantId,
  });
  if (!rule) throw new AppError('Duplicate rule not found.', 404);
  sendSuccess(res, {}, 'Duplicate rule deleted');
});

/**
 * POST /api/v1/duplicate-rules/check
 * Dry-run the matching rules against supplied field values (used by the UI
 * before saving, and by integrations).
 */
const checkDuplicates = asyncHandler(async (req, res) => {
  const { objectApiName, data, excludeRecordId } = req.body || {};
  if (!objectApiName || !data || typeof data !== 'object') {
    throw new AppError('objectApiName and data are required.', 400);
  }
  const result = await duplicateDetectionService.check(
    req.tenantId,
    objectApiName,
    data,
    { excludeRecordId },
  );
  sendSuccess(res, { data: result });
});

export {
  listRules,
  getRule,
  createRule,
  updateRule,
  deleteRule,
  checkDuplicates,
};
