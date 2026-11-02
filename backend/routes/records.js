import express from 'express';
import multer from 'multer';
import { listRecords, getRecord, createRecord, updateRecord, deleteRecord, bulkDelete, deleteCheck, mergeRecords, restoreRecord, listDeletedRecords } from '../controllers/recordController.js';
import { exportRecords, importRecords } from '../controllers/importExportController.js';
import { requireAuth } from '../middleware/auth.js';
import { enforceTenant } from '../middleware/tenant.js';
import { checkObjectPermission } from '../middleware/permissions.js';
import { requireReachableObject } from '../services/objectAccessService.js';

const IMPORT_MIMES = new Set([
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheet.sheet',
  'text/csv',
  'text/plain',
  'application/csv',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!IMPORT_MIMES.has(file.mimetype)) {
      return cb(new Error(`Unsupported import file type: ${file.mimetype}`));
    }
    cb(null, true);
  },
});
import { asyncHandler, sendSuccess, AppError, paginate } from '../utils/errors.js';
import ObjectMeta from '../models/ObjectMeta.js';
import FieldMeta from '../models/FieldMeta.js';
import { validateRecord, evaluateFormulaRules, buildSampleContext as buildCtx, buildFieldKindMap } from '../services/validationEngine.js';
import { validateFormula, configKeysIn } from '../services/formulaParser.js';
import configurationService from '../services/configurationService.js';

const router = express.Router();

router.use(requireAuth, enforceTenant);

// Workspace isolation: records are only reachable for the active workspace's
// objects (and the objects related to them by lookups).
router.param('objectApiName', requireReachableObject);

// ─── POST /records/validate ───────────────────────────────────────────────────
// Validate record data against field metadata without persisting.
// Supports both full validation and formula-only syntax checks.
//
// Body:
//   { objectApiName, data, checkFormulaOnly? }
//   or
//   { objectApiName, formulaExpression, fieldDefinitions? }   (formula syntax check)

router.post('/validate', asyncHandler(async (req, res) => {
  const { objectApiName, data, checkFormulaOnly, formulaExpression } = req.body;

  if (!objectApiName) throw new AppError('objectApiName is required.', 400);

  // ── Formula syntax check only ────────────────────────────────────────────
  if (checkFormulaOnly && formulaExpression) {
    const fields = await FieldMeta.find({ tenantId: req.tenantId, objectApiName });
    const sampleCtx = buildCtx(fields);
    const result = validateFormula(formulaExpression, sampleCtx);
    return sendSuccess(res, { data: result });
  }

  // ── Full record validation ────────────────────────────────────────────────
  if (!data || typeof data !== 'object') throw new AppError('data is required for validation.', 400);

  // Load object + fields
  const [objRes, fields] = await Promise.all([
    ObjectMeta.findOne({ tenantId: req.tenantId, apiName: objectApiName }),
    FieldMeta.find({ tenantId: req.tenantId, objectApiName }).sort({ displayOrder: 1 }),
  ]);

  if (!objRes) throw new AppError(`Object "${objectApiName}" not found.`, 404);

  // Run validation engine
  const { valid, errors } = validateRecord(data, fields);

  // Run object-level formula rules (stored on ObjectMeta as validationRules array)
  const formulaErrors = evaluateFormulaRules(data, objRes.validationRules || []);

  const allErrors = [...errors, ...formulaErrors];

  sendSuccess(res, {
    data: {
      valid: allErrors.length === 0,
      errors: allErrors,
      // Group errors by field for easy frontend consumption
      fieldErrors: allErrors.reduce((acc, e) => {
        if (!acc[e.field]) acc[e.field] = [];
        acc[e.field].push(e.message);
        return acc;
      }, {}),
    },
  });
}));

// ─── POST /records/validate-formula ──────────────────────────────────────────
// Check a formula expression for syntax/semantic errors and return
// which fields it references.

router.post('/validate-formula', asyncHandler(async (req, res) => {
  // context: 'rule' for a validation rule (must be true/false; ISCHANGED
  // allowed), anything else for a formula field (BRD 6.1).
  const { objectApiName, expression, returnType, excludeFieldApiName, context } = req.body;
  if (!expression) throw new AppError('expression is required.', 400);
  if (!objectApiName) throw new AppError('objectApiName is required.', 400);

  const fields = await FieldMeta.find({ tenantId: req.tenantId, objectApiName });

  // A formula can't reference itself, and while editing an existing formula
  // field its own stored return type is stale relative to what's in the editor.
  // Dropping it from the context makes a self-reference an unknown field rather
  // than silently inferring from the previous definition.
  const contextFields = excludeFieldApiName
    ? fields.filter((f) => f.apiName !== excludeFieldApiName)
    : fields;

  const isRule = context === 'rule' || context === 'approval';
  const result = validateFormula(expression, buildCtx(contextFields), {
    expectedType: isRule ? undefined : returnType || undefined,
    asCondition: isRule,
    fieldKinds: buildFieldKindMap(contextFields),
    // Approval entry criteria can't use ISCHANGED (nothing to compare with) but can read CONFIG().
    allowRecordState: context === 'rule',
    allowConfig: isRule,
  });

  // BRD 6.2: a rule's CONFIG("key") must name an existing setting.
  if (isRule && result.valid) {
    const keys = configKeysIn(expression);
    if (keys.length) {
      const found = await configurationService.resolveMany(keys, req.tenantId);
      const missing = keys.find((k) => !(k in found));
      if (missing) {
        result.valid = false;
        result.error = `CONFIG("${missing}") is not a configuration setting.`;
      }
    }
  }

  sendSuccess(res, { data: result });
}));

// ─── Import / Export ──────────────────────────────────────────────────────────
// These must come BEFORE /:objectApiName/:id to avoid "export"/"import" being
// treated as record IDs.
router.get('/:objectApiName/export', checkObjectPermission('export'), exportRecords);
router.post('/:objectApiName/import', checkObjectPermission('import'), upload.single('file'), importRecords);

// ─── Field History (OBJ-013) ──────────────────────────────────────────────────
router.get('/:objectApiName/:id/history', checkObjectPermission('read'), asyncHandler(async (req, res) => {
  const { objectApiName, id } = req.params;
  const FieldHistory = (await import('../models/FieldHistory.js')).default;
  const { page, limit, skip } = paginate(req.query);
  const filter = { tenantId: req.tenantId, objectApiName, recordId: id };
  const [entries, total] = await Promise.all([
    FieldHistory.find(filter).skip(skip).limit(limit).sort({ createdAt: -1 }).populate('changedBy', 'firstName lastName email'),
    FieldHistory.countDocuments(filter),
  ]);
  sendSuccess(res, { data: entries, total, page, limit });
}));

// ─── Recycle Bin (LIFE-006) ───────────────────────────────────────────────────
router.get('/:objectApiName/deleted', checkObjectPermission('read'), listDeletedRecords);
router.post('/:objectApiName/:id/restore', checkObjectPermission('update'), restoreRecord);

// ─── Send email from a record (Core BRD §16.7) ────────────────────────────────
// Reuses the omnichannel send path (consent check, channel adapter dispatch,
// Activity logging) — not a second email system.
router.post(
  '/:objectApiName/:id/send-email',
  checkObjectPermission('update'),
  asyncHandler(async (req, res) => {
    const inboxService = (await import('../services/inboxService.js')).default;
    const { to, subject, body, templateId, channelAccountId } = req.body || {};
    const result = await inboxService.sendEmailToRecord({
      tenantId: req.tenantId,
      objectApiName: req.params.objectApiName,
      recordId: req.params.id,
      to, subject, body, templateId, channelAccountId,
      user: req.user,
    });
    sendSuccess(res, { data: result }, 'Email sent', 201);
  }),
);

// ─── Standard record CRUD ─────────────────────────────────────────────────────
router.get('/:objectApiName', checkObjectPermission('read'), listRecords);
router.get('/:objectApiName/:id', checkObjectPermission('read'), getRecord);
router.post('/:objectApiName', checkObjectPermission('create'), createRecord);
router.put('/:objectApiName/:id', checkObjectPermission('update'), updateRecord);
router.patch('/:objectApiName/:id', checkObjectPermission('update'), updateRecord);
router.delete('/:objectApiName/:id', checkObjectPermission('delete'), deleteRecord);
router.post('/:objectApiName/bulk-delete', checkObjectPermission('delete'), bulkDelete);
router.post('/:objectApiName/delete-check', checkObjectPermission('delete'), deleteCheck);
router.post('/:objectApiName/merge', checkObjectPermission('delete'), mergeRecords);

export default router;
