import XLSX from 'xlsx';
import ObjectMeta from '../models/ObjectMeta.js';
import FieldMeta from '../models/FieldMeta.js';
import DynamicRecord from '../models/DynamicRecord.js';
import AutoNumberCounter from '../models/AutoNumberCounter.js';
import { asyncHandler, sendSuccess, AppError } from '../utils/errors.js';
import duplicateDetectionService from '../services/duplicateDetectionService.js';
import { fireAutomations } from '../services/automationService.js';
import {
  getVisibleFields,
  getEditableFields,
  buildDataAccessFilter,
} from '../middleware/permissions.js';
import {
  validateRecordData,
  evaluateValidationRules,
} from '../services/validationService.js';
import { buildSearchText } from '../services/searchService.js';
import { computeFormulaValues } from '../services/formulaService.js';
import { audit } from '../utils/auditLogger.js';

// ── CSV helpers ───────────────────────────────────────────────────────────────

/**
 * .lean() converts a Mongoose Map to a plain object; a live document keeps it
 * as a Map. This helper handles both so callers don't need to care.
 */
function toDataObj(data) {
  if (!data) return {};
  if (data instanceof Map) return Object.fromEntries(data);
  return data; // already a plain object after .lean()
}

/** Escape a value for CSV: wrap in quotes if it contains comma/quote/newline */
function csvEscape(val) {
  if (val === null || val === undefined) return '';
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// Values the system calculates. They are exported for reference but ignored on
// import, so an exported file can be imported back unchanged.
const COMPUTED_TYPES = new Set(['auto_number', 'formula', 'rollup_summary']);

/**
 * Write a stored value in a form the importer reads back: dates as ISO,
 * multi-select values joined with ";", addresses as JSON.
 */
function exportValue(val) {
  if (val === null || val === undefined) return '';
  if (val instanceof Date) return val.toISOString();
  if (Array.isArray(val)) return val.join(';');
  if (typeof val === 'object') {
    if (typeof val.toHexString === 'function') return val.toHexString();
    return JSON.stringify(val);
  }
  return val;
}

/** Turn a CSV cell back into the shape validation expects for the field. */
function importValue(field, val) {
  if (typeof val !== 'string') return val;
  switch (field?.type) {
    case 'multipicklist':
      return val
        .split(val.includes(';') ? ';' : ',')
        .map((v) => v.trim())
        .filter(Boolean);
    case 'boolean':
      if (/^(true|yes|y|1)$/i.test(val)) return true;
      if (/^(false|no|n|0)$/i.test(val)) return false;
      return val;
    case 'address':
      if (val.startsWith('{')) {
        try {
          return JSON.parse(val);
        } catch {
          /* keep the plain string */
        }
      }
      return val;
    default:
      return val;
  }
}

/** Parse a CSV string → array of row objects keyed by header */
function parseCSV(text) {
  const lines = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((l) => l.trim());
  if (lines.length < 2) return [];

  const parseRow = (line) => {
    const cells = [];
    let cur = '';
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuote) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') {
          inQuote = false;
        } else {
          cur += ch;
        }
      } else {
        if (ch === '"') {
          inQuote = true;
        } else if (ch === ',') {
          cells.push(cur);
          cur = '';
        } else {
          cur += ch;
        }
      }
    }
    cells.push(cur);
    return cells;
  };

  const headers = parseRow(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseRow(lines[i]);
    if (cells.every((c) => !c.trim())) continue;
    const row = {};
    headers.forEach((h, idx) => {
      row[h.trim()] = (cells[idx] ?? '').trim();
    });
    rows.push(row);
  }
  return rows;
}

/** Parse a Buffer (xlsx/xls) → array of row objects keyed by header */
function parseXLSX(buffer) {
  // cellDates: true tells SheetJS to convert Excel date serials to JS Date objects
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

  // Serialize any Date objects to ISO strings so downstream code gets a consistent string
  return rows.map((row) => {
    const clean = {};
    for (const [key, val] of Object.entries(row)) {
      clean[key] = val instanceof Date ? val.toISOString() : val;
    }
    return clean;
  });
}

/**
 * Given a multer file (req.file) or raw body, return an array of row objects.
 * Supports .csv, .xlsx, .xls
 */
function parseUpload(req) {
  if (!req.file && !req.body) return null;

  const originalName = (req.file?.originalname || '').toLowerCase();
  const isXlsx =
    originalName.endsWith('.xlsx') || originalName.endsWith('.xls');

  if (req.file) {
    return isXlsx
      ? parseXLSX(req.file.buffer)
      : parseCSV(req.file.buffer.toString('utf8'));
  }
  if (typeof req.body === 'string') return parseCSV(req.body);
  if (req.body?.csv) return parseCSV(req.body.csv);
  return null;
}

// ── Filter helpers ────────────────────────────────────────────────────────────

const OPERATOR_MAP = {
  eq: '$eq',
  ne: '$ne',
  lt: '$lt',
  gt: '$gt',
  lte: '$lte',
  gte: '$gte',
};

function coerceFilterValue(value, field) {
  if (!field) return value;
  if (['number', 'currency', 'percent'].includes(field.type)) {
    const n = Number(value);
    return isNaN(n) ? value : n;
  }
  if (['date', 'datetime'].includes(field.type)) {
    const d = new Date(value);
    return isNaN(d.getTime()) ? value : d;
  }
  if (field.type === 'boolean') {
    return value === 'true' || value === true;
  }
  return value;
}

/**
 * Convert an array of { field, operator, value } conditions into a MongoDB
 * $and query fragment. All field values live under the `data` Map key.
 */
function buildFilterQuery(filters, fieldMap) {
  if (!Array.isArray(filters) || filters.length === 0) return {};
  const conditions = filters
    .filter(
      (f) => f.field && f.operator && f.value !== undefined && f.value !== '',
    )
    .map((f) => {
      const mongoOp = OPERATOR_MAP[f.operator];
      if (!mongoOp) return null;
      const coerced = coerceFilterValue(f.value, fieldMap[f.field]);
      return { [`data.${f.field}`]: { [mongoOp]: coerced } };
    })
    .filter(Boolean);
  return conditions.length ? { $and: conditions } : {};
}

// ── Export ────────────────────────────────────────────────────────────────────

/**
 * GET /api/records/:objectApiName/export
 * Streams a CSV of all records the user can see, respecting field-level visibility.
 */
export const exportRecords = asyncHandler(async (req, res) => {
  const { objectApiName } = req.params;
  const { fields: fieldsParam } = req.query;

  const [obj, fields] = await Promise.all([
    ObjectMeta.findOne({ tenantId: req.tenantId, apiName: objectApiName }),
    FieldMeta.find({ tenantId: req.tenantId, objectApiName }).sort({
      displayOrder: 1,
    }),
  ]);
  if (!obj) throw new AppError(`Object "${objectApiName}" not found.`, 404);

  // Determine which fields the user may see (FLS enforcement)
  const allFieldNames = fields.map((f) => f.apiName);
  const visibleNames = await getVisibleFields(
    req.user,
    objectApiName,
    allFieldNames,
  );
  // Built-in (isSystem) fields such as Name hold record data and are often
  // required, so they are exported too — otherwise the file can't be imported.
  let visibleFields = fields.filter((f) => visibleNames.includes(f.apiName));

  // Field-selectable export: honor requested subset, but never beyond FLS
  if (fieldsParam) {
    const requested = new Set(
      fieldsParam.split(',').map((s) => s.trim()).filter(Boolean),
    );
    visibleFields = visibleFields.filter((f) => requested.has(f.apiName));
  }
  if (visibleFields.length === 0)
    throw new AppError('No exportable fields selected.', 400);

  // Data access filter — export only records the user is allowed to see
  const dataFilter = await buildDataAccessFilter(req.user, objectApiName);

  const records = await DynamicRecord.find({
    tenantId: req.tenantId,
    objectApiName,
    isDeleted: false,
    ...dataFilter,
  })
    .sort({ createdAt: 1 })
    .lean();

  // Build CSV
  const headers = visibleFields.map((f) => f.label || f.apiName);
  const apiNames = visibleFields.map((f) => f.apiName);

  const csvLines = [headers.map(csvEscape).join(',')];
  records.forEach((rec) => {
    const data = toDataObj(rec.data);
    const row = apiNames.map((apiName) => csvEscape(exportValue(data[apiName])));
    csvLines.push(row.join(','));
  });

  const csv = csvLines.join('\n');
  const filename = `${objectApiName}-export-${new Date().toISOString().split('T')[0]}.csv`;

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  await audit({
    tenantId: req.tenantId,
    userId: req.user._id,
    userEmail: req.user.email,
    action: 'export',
    resource: 'DynamicRecord',
    objectApiName,
    req,
    details: { count: records.length },
  });

  res.send(csv);
});

// ── Admin Export (with field selection + AND filters) ─────────────────────────

/**
 * GET /api/admin/export
 * Query params:
 *   object   – objectApiName (required)
 *   format   – 'CSV' | 'JSON'  (default: CSV)
 *   fields   – comma-separated list of apiNames to include (default: all visible)
 *   filters  – JSON-encoded array of { field, operator, value } (AND-combined)
 */
export const adminExport = asyncHandler(async (req, res) => {
  const {
    object: objectApiName,
    format = 'CSV',
    fields: fieldsParam,
    filters: filtersParam,
  } = req.query;

  if (!objectApiName)
    throw new AppError('object query param is required.', 400);

  const [obj, allFields] = await Promise.all([
    ObjectMeta.findOne({ tenantId: req.tenantId, apiName: objectApiName }),
    FieldMeta.find({ tenantId: req.tenantId, objectApiName }).sort({
      displayOrder: 1,
    }),
  ]);
  if (!obj) throw new AppError(`Object "${objectApiName}" not found.`, 404);

  // Determine exportable fields (visibility + requested subset)
  const visibleApiNames = await getVisibleFields(
    req.user,
    objectApiName,
    allFields.map((f) => f.apiName),
  );
  let exportFields = allFields.filter((f) =>
    visibleApiNames.includes(f.apiName),
  );

  if (fieldsParam) {
    const requested = new Set(
      fieldsParam
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );
    exportFields = exportFields.filter((f) => requested.has(f.apiName));
  }
  if (exportFields.length === 0)
    throw new AppError('No exportable fields selected.', 400);

  // Build field lookup map for coercion
  const fieldMap = Object.fromEntries(allFields.map((f) => [f.apiName, f]));

  // Parse and validate filters
  let filters = [];
  if (filtersParam) {
    try {
      filters = JSON.parse(filtersParam);
    } catch {
      throw new AppError('filters must be valid JSON.', 400);
    }
    if (!Array.isArray(filters))
      throw new AppError('filters must be a JSON array.', 400);
    for (const f of filters) {
      if (!f.field || !f.operator || f.value === undefined)
        throw new AppError(
          'Each filter must have field, operator, and value.',
          400,
        );
      if (!OPERATOR_MAP[f.operator])
        throw new AppError(
          `Unknown operator "${f.operator}". Use: ${Object.keys(OPERATOR_MAP).join(', ')}.`,
          400,
        );
    }
  }

  const filterQuery = buildFilterQuery(filters, fieldMap);
  const dataFilter = await buildDataAccessFilter(req.user, objectApiName);

  const records = await DynamicRecord.find({
    tenantId: req.tenantId,
    objectApiName,
    isDeleted: false,
    ...dataFilter,
    ...filterQuery,
  })
    .sort({ createdAt: 1 })
    .lean();

  await audit({
    tenantId: req.tenantId,
    userId: req.user._id,
    userEmail: req.user.email,
    action: 'admin_export',
    resource: 'DynamicRecord',
    objectApiName,
    req,
    details: {
      count: records.length,
      format,
      fieldCount: exportFields.length,
      filterCount: filters.length,
    },
  });

  const date = new Date().toISOString().split('T')[0];
  const basename = `${objectApiName}-export-${date}`;

  if (format === 'JSON') {
    const apiNames = exportFields.map((f) => f.apiName);
    const output = records.map((rec) => {
      const data = toDataObj(rec.data);
      const row = {};
      apiNames.forEach((apiName) => {
        row[apiName] = data[apiName] ?? null;
      });
      return row;
    });
    res.setHeader('Content-Type', 'application/json');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${basename}.json"`,
    );
    return res.send(JSON.stringify(output, null, 2));
  }

  // CSV
  const headers = exportFields.map((f) => f.label || f.apiName);
  const apiNames = exportFields.map((f) => f.apiName);
  const csvLines = [headers.map(csvEscape).join(',')];
  records.forEach((rec) => {
    const data = toDataObj(rec.data);
    csvLines.push(apiNames.map((n) => csvEscape(exportValue(data[n]))).join(','));
  });

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${basename}.csv"`,
  );
  res.send(csvLines.join('\n'));
});

// ── Import ────────────────────────────────────────────────────────────────────

/**
 * POST /api/records/:objectApiName/import
 * Accepts a CSV (text/csv or multipart), creates records from each row.
 * Returns { created, failed, errors[] }
 */
export const importRecords = asyncHandler(async (req, res) => {
  // Supports both /records/:objectApiName/import and /admin/import (object in body)
  const objectApiName = req.params.objectApiName || req.body?.object;
  if (!objectApiName) throw new AppError('object is required.', 400);

  const [obj, fields] = await Promise.all([
    ObjectMeta.findOne({ tenantId: req.tenantId, apiName: objectApiName }),
    FieldMeta.find({ tenantId: req.tenantId, objectApiName }),
  ]);
  if (!obj) throw new AppError(`Object "${objectApiName}" not found.`, 404);

  // Parse file (CSV or XLSX) or raw body
  const rows = parseUpload(req);
  if (!rows)
    throw new AppError(
      'No file provided. Send a .csv, .xlsx, or .xls upload.',
      400,
    );
  if (rows.length === 0)
    throw new AppError('File is empty or has no data rows.', 400);
  if (rows.length > 5000)
    throw new AppError('File exceeds the 5,000 row import limit.', 400);

  // Explicit column→field mapping from the frontend UI (preferred)
  // Falls back to label/apiName auto-matching when not provided
  let explicitMapping = null;
  if (req.body?.mapping) {
    try {
      explicitMapping = JSON.parse(req.body.mapping);
    } catch {
      /* ignore malformed mapping, fall back to auto */
    }
  }

  // Build a map of label→apiName for fallback auto-matching
  const labelToApiName = {};
  const fieldByApiName = {};
  fields.forEach((f) => {
    labelToApiName[f.label?.toLowerCase()] = f.apiName;
    labelToApiName[f.apiName?.toLowerCase()] = f.apiName;
    fieldByApiName[f.apiName] = f;
  });

  // Automation bypass (admin-only, temporary, per-import)
  const bypassValidation =
    req.body?.bypassValidation === true ||
    String(req.body?.bypassValidation).toLowerCase() === 'true';

  if (bypassValidation && !(req.user?.isAdmin && req.user.isAdmin())) {
    throw new AppError('Automation bypass is restricted to administrators.', 403);
  }

  // Enforce editable-field security on explicit mappings
  if (explicitMapping) {
    const editable = await getEditableFields(req.user, objectApiName, fields.map((f) => f.apiName));
    const editableSet = new Set(editable);
    for (const [col, mapped] of Object.entries(explicitMapping)) {
      if (!mapped || mapped === '__skip__') continue;
      if (!editableSet.has(mapped)) {
        throw new AppError(`You are not authorized to import into field "${mapped}".`, 403);
      }
    }
  }

  const results = { created: 0, failed: 0, errors: [] };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2; // 1-indexed, +1 for header

    // Map columns → field API names using explicit mapping or auto-match
    const SKIP = '__skip__';
    const inputData = {};
    for (const [col, val] of Object.entries(row)) {
      let apiName;
      if (explicitMapping) {
        const mapped = explicitMapping[col];
        if (!mapped || mapped === '__skip__') continue; // user skipped this column
        apiName = mapped;
      } else {
        apiName = labelToApiName[col.toLowerCase()];
      }
      const field = fieldByApiName[apiName];
      if (field && COMPUTED_TYPES.has(field.type)) continue;
      if (apiName && val !== '') inputData[apiName] = importValue(field, val);
    }

    try {
      const { data: validatedData, errors: valErrors } =
        await validateRecordData(inputData, fields, req.tenantId, null);

      // Formula values are computed into the context so imported rows are held
      // to the same rules as records created through the UI.
      const ruleErrors = bypassValidation
        ? []
        : await evaluateValidationRules({
            tenantId: req.tenantId,
            rules: obj.validationRules || [],
            data: { ...validatedData, ...computeFormulaValues(validatedData, fields) },
          });
      if (valErrors.length > 0 || ruleErrors.length > 0) {
        results.failed++;
        results.errors.push({
          row: rowNum,
          errors: [...valErrors, ...ruleErrors.map((e) => e.message)],
        });
        continue;
      }

      // DUP-014: run configured duplicate rules before inserting each row.
      const dupCheck = await duplicateDetectionService.check(
        req.tenantId,
        objectApiName,
        validatedData,
      );
      if (dupCheck.action === 'block') {
        results.failed++;
        results.errors.push({
          row: rowNum,
          errors: ['Duplicate record detected — import row blocked by a duplicate rule.'],
        });
        continue;
      }

      const record = new DynamicRecord({
        tenantId: req.tenantId,
        objectId: obj._id,
        objectApiName,
        ownerId: req.user._id,
        createdBy: req.user._id,
        lastModifiedBy: req.user._id,
      });

      Object.entries(validatedData).forEach(([key, value]) =>
        record.setField(key, value),
      );

      // Auto-number fields
      const autoNumFields = fields.filter((f) => f.type === 'auto_number');
      for (const field of autoNumFields) {
        const seq = await AutoNumberCounter.getNextValue(
          req.tenantId,
          objectApiName,
          field,
        );
        const padded = String(seq).padStart(field.autoNumberPadding ?? 4, '0');
        record.setField(
          field.apiName,
          `${field.autoNumberPrefix ?? ''}${padded}`,
        );
      }

      record._searchText = await buildSearchText(record, fields);
      await record.save();
      if (!bypassValidation) {
        fireAutomations('create', objectApiName, record, req.tenantId).catch(() => {});
      }
      results.created++;
    } catch (err) {
      results.failed++;
      results.errors.push({ row: rowNum, errors: [err.message] });
    }
  }

  // Update tenant usage
  if (results.created > 0) {
    await req.tenant?.updateOne({ $inc: { 'usage.records': results.created } });
  }

  await audit({
    tenantId: req.tenantId,
    userId: req.user._id,
    userEmail: req.user.email,
    action: 'import',
    resource: 'DynamicRecord',
    objectApiName,
    req,
    details: { created: results.created, failed: results.failed, bypassValidation },
  });

  sendSuccess(
    res,
    { data: results },
    `Import complete: ${results.created} created, ${results.failed} failed.`,
  );
});
