import { useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { withoutHelperFields } from '../../utils/fieldVisibility';
import {
  MULTI_VALUE_OPERATORS,
  VALUELESS_OPERATORS,
  isFilterableField,
  operatorsForField,
} from '../Records/RecordList/listViewConstants';
import styles from './RelatedListsPanel.module.css';

/**
 * Which child records show beneath the record on a layout, and how (BRD 4.1.4):
 * the lists to show and their order, the columns, the default sort, default
 * filters, and which buttons each list offers.
 *
 * `value` is the layout's relatedLists array. Leaving every list unticked keeps
 * the old behaviour of showing all of them.
 */

const relKey = (o) => `${o.objectMeta.apiName}:${o.relatedField.apiName}:${o.isThrough ? 't' : 'd'}`;
const cfgKey = (c) => `${c.objectApiName}:${c.relationshipField}:${c.through ? 't' : 'd'}`;

const newConfig = (cand) => ({
  objectApiName: cand.objectMeta.apiName,
  relationshipField: cand.relatedField.apiName,
  through: !!cand.isThrough,
  label: '',
  columns: [],
  sortField: '',
  sortOrder: 'desc',
  limit: 5,
  filters: [],
  buttons: { new: true, edit: true, delete: true },
});

const listValue = (v) => (Array.isArray(v) ? v.join(', ') : (v ?? ''));

export default function RelatedListsPanel({ candidates, value, onChange }) {
  const [openKey, setOpenKey] = useState(null);

  if (!candidates || candidates.length === 0) return null;

  const patch = (key, changes) =>
    onChange(value.map((c) => (cfgKey(c) === key ? { ...c, ...changes } : c)));

  const toggle = (cand, on) =>
    onChange(
      on
        ? [...value, newConfig(cand)]
        : value.filter((c) => cfgKey(c) !== relKey(cand)),
    );

  const move = (key, dir) => {
    const i = value.findIndex((c) => cfgKey(c) === key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= value.length) return;
    const next = [...value];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  // Ticked lists first, in their saved order, then the rest.
  const ticked = value
    .map((cfg) => candidates.find((c) => relKey(c) === cfgKey(cfg)))
    .filter(Boolean);
  const unticked = candidates.filter((c) => !value.some((cfg) => cfgKey(cfg) === relKey(c)));

  const renderRow = (cand, cfg, index) => {
    const key = relKey(cand);
    const open = openKey === key;
    const fields = withoutHelperFields(cand.fields || []).filter(
      (f) => !['_id', 'tenantId'].includes(f.apiName),
    );
    const title = cand.objectMeta.pluralLabel || cand.objectMeta.label || cand.objectMeta.apiName;

    return (
      <div key={key} className={styles.row}>
        <div className={styles.rowHead}>
          <label className={styles.show}>
            <input
              type="checkbox"
              checked={!!cfg}
              onChange={(e) => toggle(cand, e.target.checked)}
              aria-label={`Show ${title}`}
            />
            <span className={styles.title}>{title}</span>
            {cand.isThrough && (
              <span className={styles.via}>via {cand.junctionObjectMeta?.label}</span>
            )}
          </label>
          {cfg && (
            <div className={styles.rowTools}>
              <button
                type="button"
                className={styles.iconBtn}
                title="Move up"
                disabled={index === 0}
                onClick={() => move(key, -1)}
              >
                <ArrowUp size={13} />
              </button>
              <button
                type="button"
                className={styles.iconBtn}
                title="Move down"
                disabled={index === value.length - 1}
                onClick={() => move(key, 1)}
              >
                <ArrowDown size={13} />
              </button>
              <button
                type="button"
                className={styles.configure}
                onClick={() => setOpenKey(open ? null : key)}
              >
                {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Configure
              </button>
            </div>
          )}
        </div>

        {cfg && open && (
          <div className={styles.body}>
            <label className={styles.field}>
              <span>Heading</span>
              <input
                className={styles.input}
                placeholder={title}
                value={cfg.label || ''}
                onChange={(e) => patch(key, { label: e.target.value })}
              />
            </label>

            <div className={styles.field}>
              <span>Columns (none ticked = the list&apos;s own default)</span>
              <div className={styles.colGrid}>
                {fields.map((f) => (
                  <label key={f.apiName} className={styles.colItem}>
                    <input
                      type="checkbox"
                      checked={cfg.columns.includes(f.apiName)}
                      onChange={(e) =>
                        patch(key, {
                          columns: e.target.checked
                            ? [...cfg.columns, f.apiName]
                            : cfg.columns.filter((x) => x !== f.apiName),
                        })
                      }
                    />
                    {f.label}
                  </label>
                ))}
              </div>
            </div>

            <div className={styles.inline}>
              <label className={styles.field}>
                <span>Default sort</span>
                <select
                  className={styles.input}
                  value={cfg.sortField || ''}
                  onChange={(e) => patch(key, { sortField: e.target.value })}
                >
                  <option value="">Newest first</option>
                  {fields
                    .filter((f) => !['textarea', 'richtext'].includes(f.type))
                    .map((f) => (
                      <option key={f.apiName} value={f.apiName}>{f.label}</option>
                    ))}
                </select>
              </label>
              {cfg.sortField && (
                <label className={styles.field}>
                  <span>Order</span>
                  <select
                    className={styles.input}
                    value={cfg.sortOrder || 'desc'}
                    onChange={(e) => patch(key, { sortOrder: e.target.value })}
                  >
                    <option value="asc">Ascending (A–Z, oldest first)</option>
                    <option value="desc">Descending (Z–A, newest first)</option>
                  </select>
                </label>
              )}
              <label className={styles.field}>
                <span>Rows shown</span>
                <input
                  className={styles.input}
                  type="number"
                  min={1}
                  max={50}
                  value={cfg.limit || 5}
                  onChange={(e) =>
                    patch(key, { limit: Math.min(50, Math.max(1, Number(e.target.value) || 5)) })
                  }
                />
              </label>
            </div>

            <div className={styles.field}>
              <span>Default filters (all must match)</span>
              {cfg.filters.map((cond, i) => {
                const meta = fields.find((f) => f.apiName === cond.field);
                const ops = operatorsForField(meta);
                const setCond = (changes) =>
                  patch(key, {
                    filters: cfg.filters.map((c, k) => (k === i ? { ...c, ...changes } : c)),
                  });
                return (
                  <div key={i} className={styles.filterRow}>
                    <select
                      className={styles.input}
                      value={cond.field}
                      onChange={(e) => {
                        const next = fields.find((f) => f.apiName === e.target.value);
                        setCond({
                          field: e.target.value,
                          operator: operatorsForField(next)[0]?.value || 'eq',
                          value: '',
                        });
                      }}
                    >
                      <option value="">Choose a field…</option>
                      {fields.filter(isFilterableField).map((f) => (
                        <option key={f.apiName} value={f.apiName}>{f.label}</option>
                      ))}
                    </select>
                    <select
                      className={styles.input}
                      value={cond.operator}
                      onChange={(e) =>
                        setCond({
                          operator: e.target.value,
                          value: MULTI_VALUE_OPERATORS.includes(e.target.value) ? [] : '',
                        })
                      }
                    >
                      {ops.map((op) => (
                        <option key={op.value} value={op.value}>{op.label}</option>
                      ))}
                    </select>
                    {!VALUELESS_OPERATORS.includes(cond.operator) && (
                      <input
                        className={styles.input}
                        placeholder={MULTI_VALUE_OPERATORS.includes(cond.operator) ? 'a, b, c' : 'value'}
                        value={listValue(cond.value)}
                        onChange={(e) =>
                          setCond({
                            value: MULTI_VALUE_OPERATORS.includes(cond.operator)
                              ? e.target.value.split(',').map((s) => s.trim()).filter(Boolean)
                              : e.target.value,
                          })
                        }
                      />
                    )}
                    <button
                      type="button"
                      className={styles.iconBtn}
                      title="Remove filter"
                      onClick={() => patch(key, { filters: cfg.filters.filter((_, k) => k !== i) })}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                );
              })}
              <button
                type="button"
                className={styles.addFilter}
                onClick={() =>
                  patch(key, { filters: [...cfg.filters, { field: '', operator: 'eq', value: '' }] })
                }
              >
                <Plus size={12} /> Add filter
              </button>
              {cand.isThrough && cfg.filters.length > 0 && (
                <p className={styles.hint}>
                  Filters are not applied to many-to-many lists; sort, columns and buttons are.
                </p>
              )}
            </div>

            <div className={styles.field}>
              <span>Buttons offered</span>
              <div className={styles.buttons}>
                {[
                  ['new', 'New'],
                  ['edit', 'Edit'],
                  ['delete', 'Delete'],
                ].map(([k, label]) => (
                  <label key={k} className={styles.colItem}>
                    <input
                      type="checkbox"
                      checked={cfg.buttons?.[k] !== false}
                      onChange={(e) =>
                        patch(key, { buttons: { ...cfg.buttons, [k]: e.target.checked } })
                      }
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <section className={styles.panel} aria-label="Related lists">
      <h3 className={styles.heading}>Related Lists</h3>
      <p className={styles.sub}>
        Choose which child records show beneath the record on this layout, in what order, and how.
        If none are ticked, every related list is shown.
      </p>
      {ticked.map((cand, i) =>
        renderRow(cand, value.find((c) => cfgKey(c) === relKey(cand)), i),
      )}
      {unticked.map((cand) => renderRow(cand, null, -1))}
    </section>
  );
}
