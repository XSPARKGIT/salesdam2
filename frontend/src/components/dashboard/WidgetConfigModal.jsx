import React, { useState, useEffect } from 'react';
import { Plus, X } from 'lucide-react';
import Modal from '../common/Modal/Modal';
import Button from '../common/Button/Button';
import api from '../../services/api';
import styles from './WidgetConfigModal.module.css';

const WIDGET_TYPES = [
  {
    value: 'metric',
    label: 'Metric',
    desc: 'Single KPI number (count, sum, avg)',
  },
  {
    value: 'bar_chart',
    label: 'Bar Chart',
    desc: 'Compare values across categories',
  },
  {
    value: 'line_chart',
    label: 'Line Chart',
    desc: 'Trends over a grouped dimension',
  },
  { value: 'pie_chart', label: 'Pie Chart', desc: 'Proportional distribution' },
  { value: 'table', label: 'Table', desc: 'List of records with columns' },
  { value: 'text', label: 'Text / Note', desc: 'Static text or markdown note' },
];

const AGG_FUNCS = [
  { value: 'count', label: 'Count' },
  { value: 'sum', label: 'Sum' },
  { value: 'avg', label: 'Average' },
  { value: 'min', label: 'Min' },
  { value: 'max', label: 'Max' },
];

const SIZES = [
  { value: 'col-4', label: '1/3 width' },
  { value: 'col-6', label: '1/2 width' },
  { value: 'col-8', label: '2/3 width' },
  { value: 'col-12', label: 'Full width' },
];
const HEIGHTS = [
  { value: 'compact', label: 'Compact (160px)' },
  { value: 'normal', label: 'Normal (260px)' },
  { value: 'tall', label: 'Tall (400px)' },
];

function Field({ label, children, hint }) {
  return (
    <div className={styles.field}>
      <label className={styles.label}>{label}</label>
      {hint && <p className={styles.hint}>{hint}</p>}
      {children}
    </div>
  );
}

function FiltersSection({ fields, filters, onChange }) {
  const filterList = Object.entries(filters || {});

  const addFilter = () => {
    const key = `__new_${Date.now()}`;
    onChange({ ...filters, [key]: '' });
  };

  const removeFilter = (key) => {
    const next = { ...filters };
    delete next[key];
    onChange(next);
  };

  const changeKey = (oldKey, newKey) => {
    const next = {};
    Object.entries(filters || {}).forEach(([k, v]) => {
      next[k === oldKey ? newKey : k] = v;
    });
    onChange(next);
  };

  const changeValue = (key, val) => onChange({ ...filters, [key]: val });

  return (
    <div className={styles.filtersSection}>
      <div className={styles.filtersSectionHeader}>
        <span className={styles.label}>Filters</span>
        <button
          type="button"
          className={styles.addFilterBtn}
          onClick={addFilter}
        >
          <Plus size={12} /> Add filter
        </button>
      </div>
      {filterList.length === 0 && (
        <p className={styles.hint}>No filters — all records are included.</p>
      )}
      {filterList.map(([key, val]) => (
        <div key={key} className={styles.filterRow}>
          <select
            className={styles.select}
            value={key.startsWith('__new_') ? '' : key}
            onChange={(e) => changeKey(key, e.target.value)}
          >
            <option value="">— Field —</option>
            {fields.map((f) => (
              <option key={f.apiName} value={f.apiName}>
                {f.label}
              </option>
            ))}
          </select>
          <select
            className={styles.select}
            value={val === '$currentUser' ? '$currentUser' : ''}
            onChange={(e) => {
              if (e.target.value) changeValue(key, e.target.value);
            }}
          >
            <option value="">— or pick special —</option>
            <option value="$currentUser">Running User (me)</option>
          </select>
          <input
            className={`${styles.input} ${styles.filterValueInput}`}
            placeholder="type a value…"
            value={val === '$currentUser' ? '' : val || ''}
            disabled={val === '$currentUser'}
            onChange={(e) => changeValue(key, e.target.value)}
          />
          <button
            type="button"
            className={styles.removeFilterBtn}
            onClick={() => removeFilter(key)}
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}

export default function WidgetConfigModal({ widget, isOpen, onClose, onSave }) {
  // Widgets, like reports, can use any object the user may read (not only the current App's).
  const [objects, setObjects] = useState([]);
  useEffect(() => {
    api
      .get('/objects', { params: { scope: 'readable' } })
      .then((res) => setObjects(Array.isArray(res.data?.data) ? res.data.data : res.data?.data?.objects || []))
      .catch(() => setObjects([]));
  }, []);
  const [form, setForm] = useState({});
  const [fields, setFields] = useState([]);

  // Populate form when widget changes
  useEffect(() => {
    if (!widget) return;
    setForm({
      type: widget.type || 'metric',
      title: widget.title || '',
      size: widget.size || 'col-6',
      height: widget.height || 'normal',
      config: widget.config || {},
    });
  }, [widget]);

  // Load fields when objectApiName changes
  useEffect(() => {
    const obj = form.config?.objectApiName;
    if (!obj) {
      setFields([]);
      return;
    }
    api
      .get(`/objects/${obj}`)
      .then((res) => setFields(res.data.data?.fields || []))
      .catch(() => setFields([]));
  }, [form.config?.objectApiName]);

  const set = (key, val) => setForm((f) => ({ ...f, [key]: val }));
  const setCfg = (key, val) =>
    setForm((f) => ({ ...f, config: { ...f.config, [key]: val } }));

  const numericFields = fields.filter((f) =>
    ['number', 'currency', 'percent'].includes(f.type),
  );
  const allFields = fields.filter(
    (f) => !['lookup', 'master_detail', 'richtext'].includes(f.type),
  );

  const handleSave = () => {
    if (!form.title && form.type !== 'text') {
      const obj = form.config?.objectApiName || '';
      form.title = `${obj} ${form.type?.replace(/_/g, ' ')}`;
    }
    onSave({ ...widget, ...form });
  };

  if (!widget) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={widget.widgetId ? 'Edit Widget' : 'Add Widget'}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save Widget</Button>
        </>
      }
    >
      <div className={styles.grid}>
        {/* ── Widget type ─────────────────────────────────────────── */}
        <Field label="Widget Type" hint="Choose how data is displayed">
          <div className={styles.typeGrid}>
            {WIDGET_TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                className={`${styles.typeCard} ${form.type === t.value ? styles.typeActive : ''}`}
                onClick={() => set('type', t.value)}
              >
                <strong>{t.label}</strong>
                <span>{t.desc}</span>
              </button>
            ))}
          </div>
        </Field>

        {/* ── Title ───────────────────────────────────────────────── */}
        <Field label="Widget Title">
          <input
            className={styles.input}
            value={form.title || ''}
            onChange={(e) => set('title', e.target.value)}
            placeholder="e.g. Open Opportunities"
          />
        </Field>

        {/* ── Layout ──────────────────────────────────────────────── */}
        <div className={styles.row2}>
          <Field label="Width">
            <select
              className={styles.select}
              value={form.size || 'col-6'}
              onChange={(e) => set('size', e.target.value)}
            >
              {SIZES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Height">
            <select
              className={styles.select}
              value={form.height || 'normal'}
              onChange={(e) => set('height', e.target.value)}
            >
              {HEIGHTS.map((h) => (
                <option key={h.value} value={h.value}>
                  {h.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {/* ── Text widget config ───────────────────────────────────── */}
        {form.type === 'text' && (
          <>
            <Field label="Content">
              <textarea
                className={styles.textarea}
                rows={6}
                value={form.config?.content || ''}
                onChange={(e) => setCfg('content', e.target.value)}
                placeholder="Enter text or notes…"
              />
            </Field>
            <Field label="Background colour">
              <input
                type="color"
                className={styles.colorInput}
                value={form.config?.backgroundColor || '#ffffff'}
                onChange={(e) => setCfg('backgroundColor', e.target.value)}
              />
            </Field>
          </>
        )}

        {/* ── Data config (all non-text types) ────────────────────── */}
        {form.type !== 'text' && (
          <>
            <Field label="CRM Object" hint="Which object to pull data from">
              <select
                className={styles.select}
                value={form.config?.objectApiName || ''}
                onChange={(e) => setCfg('objectApiName', e.target.value)}
              >
                <option value="">— Select object —</option>
                {objects.map((o) => (
                  <option key={o.apiName} value={o.apiName}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>

            {/* Metric */}
            {form.type === 'metric' && (
              <div className={styles.row2}>
                <Field label="Aggregation">
                  <select
                    className={styles.select}
                    value={form.config?.aggregation || 'count'}
                    onChange={(e) => setCfg('aggregation', e.target.value)}
                  >
                    {AGG_FUNCS.map((a) => (
                      <option key={a.value} value={a.value}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                </Field>
                {form.config?.aggregation &&
                  form.config.aggregation !== 'count' && (
                    <Field label="Field to aggregate">
                      <select
                        className={styles.select}
                        value={form.config?.field || ''}
                        onChange={(e) => setCfg('field', e.target.value)}
                      >
                        <option value="">— Select field —</option>
                        {numericFields.map((f) => (
                          <option key={f.apiName} value={f.apiName}>
                            {f.label}
                          </option>
                        ))}
                      </select>
                    </Field>
                  )}
              </div>
            )}

            {/* Metric display extras */}
            {form.type === 'metric' && (
              <div className={styles.row2}>
                <Field label="Prefix (e.g. $)">
                  <input
                    className={styles.input}
                    value={form.config?.prefix || ''}
                    onChange={(e) => setCfg('prefix', e.target.value)}
                    placeholder="$"
                  />
                </Field>
                <Field label="Suffix (e.g. %)">
                  <input
                    className={styles.input}
                    value={form.config?.suffix || ''}
                    onChange={(e) => setCfg('suffix', e.target.value)}
                    placeholder="%"
                  />
                </Field>
              </div>
            )}

            {/* Charts */}
            {['bar_chart', 'line_chart', 'pie_chart'].includes(form.type) && (
              <>
                <Field
                  label="Group by field"
                  hint="The field whose values form the chart categories"
                >
                  <select
                    className={styles.select}
                    value={form.config?.groupBy || ''}
                    onChange={(e) => setCfg('groupBy', e.target.value)}
                  >
                    <option value="">— Select field —</option>
                    {allFields.map((f) => (
                      <option key={f.apiName} value={f.apiName}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className={styles.row2}>
                  <Field label="Value function">
                    <select
                      className={styles.select}
                      value={form.config?.aggregation?.func || 'count'}
                      onChange={(e) =>
                        setCfg('aggregation', {
                          ...form.config?.aggregation,
                          func: e.target.value,
                        })
                      }
                    >
                      {AGG_FUNCS.map((a) => (
                        <option key={a.value} value={a.value}>
                          {a.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {form.config?.aggregation?.func &&
                    form.config?.aggregation?.func !== 'count' && (
                      <Field label="Numeric field">
                        <select
                          className={styles.select}
                          value={form.config?.aggregation?.field || ''}
                          onChange={(e) =>
                            setCfg('aggregation', {
                              ...form.config?.aggregation,
                              field: e.target.value,
                            })
                          }
                        >
                          <option value="">— Select field —</option>
                          {numericFields.map((f) => (
                            <option key={f.apiName} value={f.apiName}>
                              {f.label}
                            </option>
                          ))}
                        </select>
                      </Field>
                    )}
                </div>
                <Field label="Max results">
                  <input
                    type="number"
                    className={styles.input}
                    min={1}
                    max={50}
                    value={form.config?.limit || 10}
                    onChange={(e) => setCfg('limit', parseInt(e.target.value))}
                  />
                </Field>
              </>
            )}

            {/* Table */}
            {form.type === 'table' && (
              <>
                <Field
                  label="Columns to display"
                  hint="Select fields to show as table columns"
                >
                  <div className={styles.checkboxList}>
                    {allFields.map((f) => (
                      <label key={f.apiName} className={styles.checkboxItem}>
                        <input
                          type="checkbox"
                          checked={(form.config?.columns || []).includes(
                            f.apiName,
                          )}
                          onChange={(e) => {
                            const cols = form.config?.columns || [];
                            setCfg(
                              'columns',
                              e.target.checked
                                ? [...cols, f.apiName]
                                : cols.filter((c) => c !== f.apiName),
                            );
                          }}
                        />
                        {f.label}
                      </label>
                    ))}
                  </div>
                </Field>
                <Field label="Row limit">
                  <input
                    type="number"
                    className={styles.input}
                    min={1}
                    max={50}
                    value={form.config?.limit || 10}
                    onChange={(e) => setCfg('limit', parseInt(e.target.value))}
                  />
                </Field>
              </>
            )}

            {/* Filters (all data widgets) */}
            {form.config?.objectApiName && (
              <FiltersSection
                fields={allFields}
                filters={form.config?.filters || {}}
                onChange={(val) => setCfg('filters', val)}
              />
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
