import React, { useState, useEffect, useRef } from 'react';
import {
  FileUp,
  Upload,
  FileText,
  X,
  AlertCircle,
  CheckCircle,
  ChevronDown,
  FileSpreadsheet,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import toast from 'react-hot-toast';
import api from '../../../services/api';
import Button from '../../../components/common/Button/Button';
import AdminSettingsPage from '../AdminSettingsPage';
import { useAuth } from '../../../hooks/useAuth';
import styles from '../AdminSettingsPage.module.css';
import s from './DataImport.module.css';

const SKIP = '__skip__';
const ACCEPTED = '.csv,.xlsx,.xls';
const ACCEPTED_MIME = new Set([
  'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

// Try to auto-match a CSV header string to a field apiName
function autoMatch(header, fields) {
  const norm = (v) => v.toLowerCase().replace(/[\s_-]+/g, '');
  const h = norm(header);
  return (
    fields.find((f) => f.apiName === header)?.apiName ||
    fields.find((f) => norm(f.label) === h)?.apiName ||
    fields.find((f) => norm(f.apiName) === h)?.apiName ||
    SKIP
  );
}

export default function DataImport() {
  // Object + fields from API
  const [objects, setObjects] = useState([]);
  const [objectApiName, setObjectApiName] = useState('');
  const [fields, setFields] = useState([]);
  const [loadingObjects, setLoadingObjects] = useState(true);
  const [loadingFields, setLoadingFields] = useState(false);

  // Wizard state
  const [step, setStep] = useState('upload'); // upload | map | confirm | done
  const [file, setFile] = useState(null);
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]); // preview rows (first 5)
  const [mapping, setMapping] = useState({}); // { csvHeader: fieldApiName | SKIP }
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);

  const [bypassValidation, setBypassValidation] = useState(false);
  const { isAdmin } = useAuth();

  // Load all objects on mount
  useEffect(() => {
    api
      .get('/objects', { params: { includeFields: false, scope: 'all' } })
      .then((res) => {
        const list = res.data?.data?.objects || res.data?.data || [];
        setObjects(list);
        if (list.length) setObjectApiName(list[0].apiName);
      })
      .catch(() => toast.error('Failed to load objects.'))
      .finally(() => setLoadingObjects(false));
  }, []);

  // Load fields whenever selected object changes
  const loadFields = () => {
    if (!objectApiName) {
      toast.error('No object selected.');
      return;
    }
    setFields([]);
    setLoadingFields(true);
    api
      .get(`/objects/${objectApiName}`)
      .then((res) => {
        const obj = res.data?.data?.data || res.data?.data || res.data;
        const f = (obj.fields || []).sort(
          (a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0),
        );
        setFields(f);
        if (f.length === 0) {
          toast.error('No fields returned from server.');
        } else {
          toast.success(`Loaded ${f.length} fields.`);
        }
      })
      .catch((err) => {
        console.error('loadFields error:', err);
        toast.error('Failed to load fields: ' + (err?.message || 'unknown error'));
      })
      .finally(() => setLoadingFields(false));
  };

  useEffect(() => {
    loadFields();
  }, [objectApiName]);

  // Refresh fields when window regains focus (catches fields created in another tab)
  useEffect(() => {
    const onFocus = () => loadFields();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [objectApiName]);

  // Re-run auto-mapping when fields change (object switched mid-upload)
  useEffect(() => {
    if (!headers.length || !fields.length) return;
    const m = {};
    headers.forEach((h) => {
      m[h] = autoMatch(h, fields);
    });
    setMapping(m);
  }, [fields, headers]);

  const parseFile = (f) => {
    const ext = f.name.split('.').pop().toLowerCase();
    const isXlsx = ext === 'xlsx' || ext === 'xls';
    const isCsv = ext === 'csv';
    if (!isXlsx && !isCsv) {
      toast.error('Only .csv, .xlsx, and .xls files are supported.');
      return;
    }

    setFile(f);
    const reader = new FileReader();

    reader.onload = (ev) => {
      try {
        let hdrs, preview;

        if (isXlsx) {
          // cellDates: true converts Excel date serials to JS Date objects
          const wb = XLSX.read(ev.target.result, {
            type: 'array',
            cellDates: true,
          });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
          if (!data.length) {
            toast.error('Spreadsheet is empty.');
            return;
          }
          hdrs = data[0].map((h) => String(h ?? '').trim()).filter(Boolean);
          preview = data.slice(1, 6).map((r) =>
            hdrs.map((_, i) => {
              const v = r[i];
              return v instanceof Date ? v.toISOString() : String(v ?? '');
            }),
          );
        } else {
          const lines = ev.target.result.split('\n').filter((l) => l.trim());
          if (!lines.length) {
            toast.error('File is empty.');
            return;
          }
          hdrs = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
          preview = lines
            .slice(1, 6)
            .map((l) =>
              l.split(',').map((c) => c.trim().replace(/^"|"$/g, '')),
            );
        }

        if (!hdrs.length) {
          toast.error('No column headers found in the file.');
          return;
        }
        const m = {};
        hdrs.forEach((h) => {
          m[h] = autoMatch(h, fields);
        });
        setHeaders(hdrs);
        setRows(preview);
        setMapping(m);
        setStep('map');
      } catch (err) {
        toast.error(
          'Failed to read file. Make sure it is a valid CSV or Excel file.',
        );
      }
    };

    if (isXlsx) {
      reader.readAsArrayBuffer(f);
    } else {
      reader.readAsText(f);
    }
  };

  const handleFileInput = (e) => {
    const f = e.target.files[0];
    if (f) parseFile(f);
  };
  const handleDrop = (e) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) parseFile(f);
  };

  const mappedCount = Object.values(mapping).filter((v) => v !== SKIP).length;

  // Required fields no column is mapped to — every row would be rejected.
  // Calculated fields are filled in by the system, so they never need a column.
  const mappedApiNames = new Set(Object.values(mapping));
  const missingRequired = fields.filter(
    (f) =>
      f.isRequired &&
      !['auto_number', 'formula', 'rollup_summary'].includes(f.type) &&
      !mappedApiNames.has(f.apiName),
  );

  const handleImport = async () => {
    if (bypassValidation) {
      const ok = window.confirm(
        'Bypass Validation Rules and Flows for this import? This is for controlled data migration only.',
      );
      if (!ok) return;
    }
    setImporting(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('object', objectApiName);
      formData.append('mapping', JSON.stringify(mapping));
      formData.append('bypassValidation', bypassValidation ? 'true' : 'false');
      const res = await api.post('/admin/import', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setResult(res.data?.data || res.data);
      setStep('done');
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Import failed.');
    } finally {
      setImporting(false);
    }
  };

  const reset = () => {
    setStep('upload');
    setFile(null);
    setHeaders([]);
    setRows([]);
    setMapping({});
    setResult(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const selectedObject = objects.find((o) => o.apiName === objectApiName);

  return (
    <AdminSettingsPage
      title="Data Import"
      description="Upload a CSV or Excel file to import records into any standard or custom object"
      icon={FileUp}
      iconColor="#6366f1"
    >
      <div className={styles.panel}>
        {/* ── Step: upload ── */}
        {step === 'upload' && (
          <>
            <div className={styles.field}>
              <label className={styles.label}>Target Object</label>
              <p className={styles.hint}>
                Choose the object you want to import records into
              </p>
              {loadingObjects ? (
                <div className={s.loadingRow}>Loading objects…</div>
              ) : (
                <select
                  className={styles.input}
                  value={objectApiName}
                  onChange={(e) => setObjectApiName(e.target.value)}
                >
                  {objects.map((o) => (
                    <option key={o.apiName} value={o.apiName}>
                      {o.label || o.name} {o.isCustom ? '(Custom)' : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className={s.objectBadge} style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {loadingFields && (
                <span className={s.loadingInline}> · loading fields…</span>
              )}
              <button
                type="button"
                className={s.clearBtn}
                onClick={loadFields}
                title="Refresh fields from server"
              >
                ↻ Refresh fields
              </button>
              <span className={s.loadingInline}>
                ({fields.length} field{fields.length !== 1 ? 's' : ''} loaded)
              </span>
            </div>
            {fields.length > 0 && (
              <div className={s.loadingInline} style={{ marginTop: 4 }}>
                <strong>Available fields:</strong> {fields.map((f) => f.apiName).join(', ')}
              </div>
            )}
            {fields.length === 0 && !loadingFields && (
              <div style={{ marginTop: 4, color: 'var(--color-danger)', fontSize: 'var(--font-size-xs)' }}>
                ⚠ No fields loaded. Click "Refresh fields".
              </div>
            )}

            <div
              className={s.dropZone}
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
            >
              <div className={s.dropIcons}>
                <Upload size={32} className={s.dropIcon} />
                <FileSpreadsheet size={32} className={s.dropIconXlsx} />
              </div>
              <p className={s.dropText}>Click or drag a file here</p>
              <p className={s.dropHint}>
                Supports .csv, .xlsx, .xls · First row must be column headers
              </p>
              <input
                ref={fileRef}
                type="file"
                accept={ACCEPTED}
                className={s.hiddenInput}
                onChange={handleFileInput}
              />
            </div>
          </>
        )}

        {/* ── Step: map ── */}
        {step === 'map' && (
          <>
            <div className={s.stepMeta}>
              <div className={s.fileBar}>
                <FileText size={14} />
                <span className={s.fileName}>{file?.name}</span>
                <button
                  className={s.clearBtn}
                  onClick={reset}
                  title="Remove file"
                >
                  <X size={14} />
                </button>
              </div>
              <div className={s.objectBadge}>
                Importing into:{' '}
                <strong>{selectedObject?.label || objectApiName}</strong>
                {loadingFields && (
                  <span className={s.loadingInline}> · loading fields…</span>
                )}
                <button
                  type="button"
                  className={s.clearBtn}
                  onClick={loadFields}
                  title="Refresh fields from server"
                  style={{ marginLeft: 8 }}
                >
                  ↻ Refresh fields
                </button>
                <span className={s.loadingInline}>
                  {' '}({fields.length} field{fields.length !== 1 ? 's' : ''} loaded)
                </span>
              </div>
              {fields.length > 0 && (
                <div className={s.loadingInline} style={{ marginTop: 6, fontSize: 12 }}>
                  Available fields: {fields.map((f) => f.apiName).join(', ')}
                </div>
              )}
              {fields.length === 0 && !loadingFields && (
                <div style={{ marginTop: 6, color: 'red', fontSize: 12 }}>
                  ⚠ No fields loaded. Click "Refresh fields" or check the object.
                </div>
              )}
            </div>

            <div className={s.mappingWrap}>
              <div className={s.mappingHeader}>
                <span>CSV Column</span>
                <span>Sample Value</span>
                <span>Maps to Field</span>
              </div>
              {headers.map((h, hi) => {
                const sample = rows[0]?.[hi] ?? '';
                const matchedField = fields.find(
                  (f) => f.apiName === mapping[h],
                );
                return (
                  <div
                    key={h}
                    className={`${s.mappingRow} ${mapping[h] === SKIP ? s.mappingSkipped : ''}`}
                  >
                    <span className={s.csvCol}>{h}</span>
                    <span className={s.sampleVal}>{sample || <em>—</em>}</span>
                    <div className={s.fieldSelectWrap}>
                      <select
                        className={`${s.fieldSelect} ${mapping[h] === SKIP ? s.fieldSelectSkip : ''}`}
                        value={mapping[h] || SKIP}
                        onChange={(e) =>
                          setMapping((m) => ({ ...m, [h]: e.target.value }))
                        }
                        disabled={loadingFields}
                      >
                        <option value={SKIP}>— Skip this column —</option>
                        <optgroup label="Fields">
                          {fields.map((f) => (
                            <option key={f.apiName} value={f.apiName}>
                              {f.label} ({f.apiName}) · {f.type}
                            </option>
                          ))}
                        </optgroup>
                      </select>
                      <ChevronDown size={13} className={s.fieldSelectArrow} />
                      {matchedField && (
                        <span
                          className={`${s.typePill} ${s[`type_${matchedField.type}`] || s.type_default}`}
                        >
                          {matchedField.type}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className={s.mappingSummary}>
              <CheckCircle size={13} />
              {mappedCount} of {headers.length} columns mapped ·{' '}
              {headers.length - mappedCount} will be skipped
            </div>

            {missingRequired.length > 0 && (
              <div className={s.requiredWarning} role="alert" data-testid="import-missing-required">
                <AlertCircle size={14} />
                <span>
                  Required {missingRequired.length === 1 ? 'field' : 'fields'}{' '}
                  <strong>{missingRequired.map((f) => f.label || f.apiName).join(', ')}</strong>{' '}
                  {missingRequired.length === 1 ? 'has' : 'have'} no column. Every row will be
                  rejected unless you add {missingRequired.length === 1 ? 'that column' : 'those columns'} to
                  the file or map an existing column to {missingRequired.length === 1 ? 'it' : 'them'}.
                </span>
              </div>
            )}

            {/* Preview table — only mapped columns */}
            {rows.length > 0 &&
              (() => {
                const mappedHeaders = headers
                  .map((h, i) => ({ h, i }))
                  .filter(({ h }) => mapping[h] !== SKIP);
                return mappedHeaders.length > 0 ? (
                  <div>
                    <p className={s.previewLabel}>
                      Data preview (first {rows.length} rows ·{' '}
                      {mappedHeaders.length} mapped column
                      {mappedHeaders.length !== 1 ? 's' : ''})
                    </p>
                    <div className={s.previewScroll}>
                      <table className={s.previewTable}>
                        <thead>
                          <tr>
                            {mappedHeaders.map(({ h }) => (
                              <th key={h}>
                                {h}
                                <span className={s.mappedTo}>
                                  →{' '}
                                  {fields.find((f) => f.apiName === mapping[h])
                                    ?.label || mapping[h]}
                                </span>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((r, i) => (
                            <tr key={i}>
                              {mappedHeaders.map(({ h, i: ci }) => (
                                <td key={h}>{r[ci]}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null;
              })()}

            <div className={styles.formActions}>
              <Button variant="secondary" onClick={reset}>
                Cancel
              </Button>
              <Button
                disabled={mappedCount === 0}
                onClick={() => setStep('confirm')}
              >
                Review &amp; Import
              </Button>
            </div>
          </>
        )}

        {/* ── Step: confirm ── */}
        {step === 'confirm' && (
          <div className={s.centerPanel}>
            <AlertCircle size={40} className={s.warnIcon} />
            <h3>
              Ready to import into{' '}
              <strong>{selectedObject?.label || objectApiName}</strong>
            </h3>
            <p>
              File: <strong>{file?.name}</strong>
            </p>
            <div className={s.confirmDetails}>
              <div className={s.confirmStat}>
                <span>{headers.length}</span>
                <label>columns</label>
              </div>
              <div className={s.confirmStat}>
                <span>{mappedCount}</span>
                <label>mapped</label>
              </div>
              <div className={s.confirmStat}>
                <span>{headers.length - mappedCount}</span>
                <label>skipped</label>
              </div>
            </div>
            <p className={s.confirmNote}>
              This will create or update records in{' '}
              <strong>{selectedObject?.label || objectApiName}</strong>. This
              action cannot be undone.
            </p>
            {isAdmin && (
              <div style={{ marginTop: 12 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={bypassValidation}
                    onChange={(e) => setBypassValidation(e.target.checked)}
                  />
                  <span>
                    Bypass Validation Rules and Flows (admin only; for data migration)
                  </span>
                </label>
                {bypassValidation && (
                  <p style={{ color: '#b45309', fontSize: 12, marginTop: 6 }}>
                    Warning: validation rules and flows will be skipped for this import only.
                  </p>
                )}
              </div>
            )}
            <div className={s.confirmActions}>
              <Button variant="secondary" onClick={() => setStep('map')}>
                Back
              </Button>
              <Button loading={importing} onClick={handleImport}>
                Confirm Import
              </Button>
            </div>
          </div>
        )}

        {/* ── Step: done ── */}
        {step === 'done' && (
          <div className={s.centerPanel}>
            {result && !result.created && result.failed > 0 ? (
              <>
                <AlertCircle size={40} className={s.warnIcon} />
                <h3>No records were imported</h3>
              </>
            ) : (
              <>
                <CheckCircle size={40} className={s.successIcon} />
                <h3>Import Complete</h3>
              </>
            )}
            {result && (
              <div className={s.stats}>
                <div className={s.stat}>
                  <span>{result.created ?? '—'}</span>
                  <label>Created</label>
                </div>
                <div className={s.stat}>
                  <span>{result.updated ?? '—'}</span>
                  <label>Updated</label>
                </div>
                <div className={s.stat}>
                  <span>{result.failed ?? '—'}</span>
                  <label>Failed</label>
                </div>
              </div>
            )}
            {result?.errors?.length > 0 && (
              <div className={s.rowErrors} data-testid="import-row-errors">
                <p className={s.rowErrorsTitle}>Why rows failed</p>
                <ul>
                  {result.errors.map((e, i) => (
                    <li key={i}>
                      <strong>Row {e.row ?? i + 1}:</strong>{' '}
                      {(Array.isArray(e.errors) ? e.errors : [e.error || 'Unknown error'])
                        .map((m) => (typeof m === 'string' ? m : m?.message || String(m)))
                        .join(' ')}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <Button variant="secondary" onClick={reset}>
              Import Another File
            </Button>
          </div>
        )}
      </div>
    </AdminSettingsPage>
  );
}
