import React, { useState, useEffect } from 'react';
import {
  FileDown,
  Download,
  AlertCircle,
  CheckSquare,
  Square,
  Plus,
  Trash2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../../services/api';
import Button from '../../../components/common/Button/Button';
import AdminSettingsPage from '../AdminSettingsPage';
import styles from '../AdminSettingsPage.module.css';
import s from './DataExport.module.css';

const FORMATS = ['CSV', 'JSON'];

const OPERATORS = [
  { value: 'eq', label: '= equals' },
  { value: 'ne', label: '≠ not equal' },
  { value: 'lt', label: '< less than' },
  { value: 'lte', label: '≤ less or equal' },
  { value: 'gt', label: '> greater than' },
  { value: 'gte', label: '≥ greater or equal' },
];

const EXCLUDED_TYPES = new Set(['rollup_summary', 'formula']);

let nextId = 1;
const makeFilter = () => ({
  id: nextId++,
  field: '',
  operator: 'eq',
  value: '',
});

export default function DataExport() {
  const [objects, setObjects] = useState([]);
  const [objectApiName, setObjectApiName] = useState('');
  const [fields, setFields] = useState([]);
  const [selectedFields, setSelectedFields] = useState(new Set());
  const [loadingObjects, setLoadingObjects] = useState(true);
  const [loadingFields, setLoadingFields] = useState(false);
  const [format, setFormat] = useState('CSV');
  const [filters, setFilters] = useState([makeFilter()]);
  const [exporting, setExporting] = useState(false);

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

  useEffect(() => {
    if (!objectApiName) return;
    setFields([]);
    setSelectedFields(new Set());
    setFilters([makeFilter()]);
    setLoadingFields(true);
    api
      .get(`/objects/${objectApiName}`)
      .then((res) => {
        const obj = res.data?.data?.data || res.data?.data || res.data;
        const f = (obj.fields || [])
          .filter((field) => !EXCLUDED_TYPES.has(field.type))
          .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
        setFields(f);
        setSelectedFields(new Set(f.map((field) => field.apiName)));
      })
      .catch(() => toast.error('Failed to load fields.'))
      .finally(() => setLoadingFields(false));
  }, [objectApiName]);

  // ── Field selection ──────────────────────────────────────────
  const toggleField = (apiName) => {
    setSelectedFields((prev) => {
      const next = new Set(prev);
      next.has(apiName) ? next.delete(apiName) : next.add(apiName);
      return next;
    });
  };
  const toggleAll = () => {
    setSelectedFields(
      selectedFields.size === fields.length
        ? new Set()
        : new Set(fields.map((f) => f.apiName)),
    );
  };

  // ── Filters ──────────────────────────────────────────────────
  const addFilter = () => setFilters((prev) => [...prev, makeFilter()]);
  const removeFilter = (id) =>
    setFilters((prev) => prev.filter((f) => f.id !== id));
  const updateFilter = (id, key, val) =>
    setFilters((prev) =>
      prev.map((f) => (f.id === id ? { ...f, [key]: val } : f)),
    );

  const activeFilters = filters.filter(
    (f) => f.field && f.operator && f.value !== '',
  );

  // ── Export ───────────────────────────────────────────────────
  const handleExport = async () => {
    if (selectedFields.size === 0) {
      toast.error('Select at least one field to export.');
      return;
    }
    setExporting(true);
    try {
      const params = {
        object: objectApiName,
        format,
        fields: Array.from(selectedFields).join(','),
      };
      if (activeFilters.length > 0) {
        params.filters = JSON.stringify(
          activeFilters.map(({ field, operator, value }) => ({
            field,
            operator,
            value,
          })),
        );
      }
      const res = await api.get('/admin/export', {
        params,
        responseType: 'blob',
      });
      const ext = format === 'JSON' ? 'json' : 'csv';
      const url = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${objectApiName}-export.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(
        `Exported ${selectedFields.size} fields from ${objectApiName} as ${format}.`,
      );
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Export failed.');
    } finally {
      setExporting(false);
    }
  };

  const selectedObject = objects.find((o) => o.apiName === objectApiName);
  const allSelected =
    fields.length > 0 && selectedFields.size === fields.length;
  const noneSelected = selectedFields.size === 0;

  return (
    <AdminSettingsPage
      title="Data Export"
      description="Choose an object, filter records, select fields, and download as CSV or JSON"
      icon={FileDown}
      iconColor="#0ea5e9"
    >
      <div className={styles.panel}>
        {/* Object */}
        <div className={styles.field}>
          <label className={styles.label}>Object to Export</label>
          <p className={styles.hint}>Select a standard or custom object</p>
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
                  {o.label || o.name}
                  {o.isCustom ? ' (Custom)' : ''}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Format */}
        <div className={styles.field}>
          <label className={styles.label}>Export Format</label>
          <div className={s.formatPicker}>
            {FORMATS.map((f) => (
              <button
                key={f}
                type="button"
                className={`${s.formatBtn} ${format === f ? s.formatActive : ''}`}
                onClick={() => setFormat(f)}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {/* Filters */}
        <div className={styles.field}>
          <div className={s.filtersTitleRow}>
            <div>
              <label className={styles.label}>Filter Records</label>
              <p className={styles.hint}>
                Only records matching <strong>all</strong> conditions will be
                exported
                {activeFilters.length > 0 &&
                  ` · ${activeFilters.length} active filter${activeFilters.length !== 1 ? 's' : ''}`}
              </p>
            </div>
            <button
              className={s.addFilterBtn}
              onClick={addFilter}
              disabled={loadingFields}
            >
              <Plus size={13} /> Add filter
            </button>
          </div>

          <div className={s.filterList}>
            {filters.map((filter, idx) => (
              <div key={filter.id} className={s.filterRow}>
                <span className={s.filterConjunction}>
                  {idx === 0 ? 'WHERE' : 'AND'}
                </span>

                {/* Field */}
                <select
                  className={`${s.filterSelect} ${s.filterFieldSelect}`}
                  value={filter.field}
                  onChange={(e) =>
                    updateFilter(filter.id, 'field', e.target.value)
                  }
                  disabled={loadingFields}
                >
                  <option value="">— Choose field —</option>
                  {fields.map((f) => (
                    <option key={f.apiName} value={f.apiName}>
                      {f.label} ({f.apiName})
                    </option>
                  ))}
                </select>

                {/* Operator */}
                <select
                  className={`${s.filterSelect} ${s.filterOpSelect}`}
                  value={filter.operator}
                  onChange={(e) =>
                    updateFilter(filter.id, 'operator', e.target.value)
                  }
                >
                  {OPERATORS.map((op) => (
                    <option key={op.value} value={op.value}>
                      {op.label}
                    </option>
                  ))}
                </select>

                {/* Value */}
                <input
                  className={`${styles.input} ${s.filterValueInput}`}
                  value={filter.value}
                  onChange={(e) =>
                    updateFilter(filter.id, 'value', e.target.value)
                  }
                  placeholder="value"
                />

                <button
                  className={s.removeFilterBtn}
                  onClick={() => removeFilter(filter.id)}
                  title="Remove filter"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Field selector */}
        <div className={styles.field}>
          <div className={s.fieldsHeader}>
            <div>
              <label className={styles.label}>Fields to Export</label>
              <p className={styles.hint}>
                {loadingFields
                  ? 'Loading fields…'
                  : `${selectedFields.size} of ${fields.length} fields selected`}
              </p>
            </div>
            {!loadingFields && fields.length > 0 && (
              <button className={s.selectBtn} onClick={toggleAll}>
                {allSelected ? <CheckSquare size={13} /> : <Square size={13} />}
                {allSelected ? 'Deselect all' : 'Select all'}
              </button>
            )}
          </div>

          {loadingFields ? (
            <div className={s.loadingRow}>Loading fields…</div>
          ) : fields.length === 0 ? (
            <div className={s.emptyFields}>No exportable fields found.</div>
          ) : (
            <div className={s.fieldGrid}>
              {fields.map((field) => {
                const checked = selectedFields.has(field.apiName);
                return (
                  <label
                    key={field.apiName}
                    className={`${s.fieldCard} ${checked ? s.fieldCardChecked : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleField(field.apiName)}
                      className={s.fieldCheckbox}
                    />
                    <div className={s.fieldCardBody}>
                      <span className={s.fieldLabel}>{field.label}</span>
                      <span className={s.fieldMeta}>{field.apiName}</span>
                    </div>
                    <span
                      className={`${s.fieldTypePill} ${s[`type_${field.type}`] || s.type_default}`}
                    >
                      {field.type}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        {/* Note */}
        <div className={s.note}>
          <AlertCircle size={13} />
          <span>
            {activeFilters.length > 0 ? (
              <>
                Records in{' '}
                <strong>{selectedObject?.label || objectApiName}</strong>{' '}
                matching all {activeFilters.length} filter
                {activeFilters.length !== 1 ? 's' : ''} will be exported.
              </>
            ) : (
              <>
                All records in{' '}
                <strong>{selectedObject?.label || objectApiName}</strong> will
                be exported.
              </>
            )}{' '}
            Large datasets may take a moment.
          </span>
        </div>

        <div className={styles.formActions}>
          <Button
            icon={<Download size={15} />}
            loading={exporting}
            disabled={noneSelected || loadingFields}
            onClick={handleExport}
          >
            Export {selectedObject?.label || objectApiName} as {format}
            {!noneSelected &&
              ` · ${selectedFields.size} field${selectedFields.size !== 1 ? 's' : ''}`}
            {activeFilters.length > 0 &&
              ` · ${activeFilters.length} filter${activeFilters.length !== 1 ? 's' : ''}`}
          </Button>
        </div>
      </div>
    </AdminSettingsPage>
  );
}
