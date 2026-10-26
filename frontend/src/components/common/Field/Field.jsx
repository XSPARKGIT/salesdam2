import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import LookupInput from '../../forms/LookupInput/LookupInput';
import api from '../../../services/api';
import useCurrency from '../../../hooks/useCurrency';
import { resolveDisplayType } from '../../../utils/fieldDisplayType';
import styles from './Field.module.css';

// ─── FieldInput ───────────────────────────────────────────────
// Raw input control for a single field type. No label/error wrapping.
// Can be used standalone when you need just the control.
export function FieldInput({ field, value, onChange, error, disabled, disableCreate }) {
  const cls = (base) =>
    [styles[base], error ? styles.err : '', disabled ? styles.disabled : '']
      .filter(Boolean)
      .join(' ');

  const handleChange = (e) => {
    const val =
      e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    onChange(field.apiName, val);
  };

  switch (field.type) {
    case 'textarea':
    case 'richtext':
      return (
        <textarea
          className={cls('textarea')}
          value={value ?? ''}
          onChange={handleChange}
          rows={4}
          placeholder={field.helpText || `Enter ${field.label.toLowerCase()}`}
          disabled={disabled}
        />
      );

    case 'boolean':
      return (
        <label className={styles.checkboxLabel}>
          <input
            type="checkbox"
            className={styles.checkbox}
            checked={!!value}
            onChange={handleChange}
            disabled={disabled}
          />
          <span className={styles.checkboxText}>{field.label}</span>
        </label>
      );

    case 'picklist':
      return (
        <select
          className={cls('select')}
          value={value ?? ''}
          onChange={handleChange}
          disabled={disabled}
        >
          <option value="">-- Select --</option>
          {(field.picklistValues || [])
            .filter((pv) => pv.isActive !== false)
            .map((pv) => (
              <option key={pv.value} value={pv.value}>
                {pv.label}
              </option>
            ))}
        </select>
      );

    case 'multipicklist':
      return (
        <select
          multiple
          className={[
            styles.select,
            styles.multiselect,
            error ? styles.err : '',
          ]
            .filter(Boolean)
            .join(' ')}
          value={Array.isArray(value) ? value : []}
          onChange={(e) => {
            const vals = Array.from(e.target.selectedOptions, (o) => o.value);
            onChange(field.apiName, vals);
          }}
          disabled={disabled}
        >
          {(field.picklistValues || []).map((pv) => (
            <option key={pv.value} value={pv.value}>
              {pv.label}
            </option>
          ))}
        </select>
      );

    case 'date':
      return (
        <input
          type="date"
          className={cls('input')}
          value={value ? new Date(value).toISOString().split('T')[0] : ''}
          onChange={handleChange}
          disabled={disabled}
        />
      );

    case 'datetime': {
      // Convert UTC ISO string to local datetime-local format
      const formatDatetimeLocalValue = (val) => {
        if (!val) return '';
        const date = new Date(val);
        // Get local date/time components
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${year}-${month}-${day}T${hours}:${minutes}`;
      };
      return (
        <input
          type="datetime-local"
          className={cls('input')}
          value={formatDatetimeLocalValue(value)}
          onChange={handleChange}
          disabled={disabled}
        />
      );
    }

    case 'number':
    case 'currency':
    case 'percent':
      return (
        <input
          type="number"
          className={cls('input')}
          value={value ?? ''}
          onChange={handleChange}
          min={field.minValue}
          max={field.maxValue}
          step={field.scale > 0 ? Math.pow(10, -field.scale) : 1}
          placeholder={`Enter ${field.label.toLowerCase()}`}
          disabled={disabled}
        />
      );

    case 'email':
      return (
        <input
          type="email"
          className={cls('input')}
          value={value ?? ''}
          onChange={handleChange}
          placeholder="email@example.com"
          disabled={disabled}
        />
      );

    case 'phone':
      return (
        <input
          type="tel"
          className={cls('input')}
          value={value ?? ''}
          onChange={handleChange}
          disabled={disabled}
        />
      );

    case 'url':
      return (
        <input
          type="url"
          className={cls('input')}
          value={value ?? ''}
          onChange={handleChange}
          placeholder="https://"
          disabled={disabled}
        />
      );

    case 'time':
      return (
        <input
          type="time"
          className={cls('input')}
          value={value ?? ''}
          onChange={handleChange}
          disabled={disabled}
        />
      );

    case 'address': {
      const addr = typeof value === 'object' && value !== null ? value : {};
      const setAddr = (key, val) => {
        onChange(field.apiName, { ...addr, [key]: val });
      };
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <input className={cls('input')} placeholder="Street" value={addr.street ?? ''} onChange={e => setAddr('street', e.target.value)} disabled={disabled} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <input className={cls('input')} placeholder="City" value={addr.city ?? ''} onChange={e => setAddr('city', e.target.value)} disabled={disabled} />
            <input className={cls('input')} placeholder="State / Province" value={addr.state ?? ''} onChange={e => setAddr('state', e.target.value)} disabled={disabled} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <input className={cls('input')} placeholder="Postal Code" value={addr.postalCode ?? ''} onChange={e => setAddr('postalCode', e.target.value)} disabled={disabled} />
            <input className={cls('input')} placeholder="Country" value={addr.country ?? ''} onChange={e => setAddr('country', e.target.value)} disabled={disabled} />
          </div>
        </div>
      );
    }

    case 'lookup':
    case 'master_detail':
      return (
        <LookupInput
          value={value ?? ''}
          onChange={(id) => onChange(field.apiName, id)}
          objectApiName={field.lookupObjectApiName}
          displayField={field.lookupDisplayField || 'name'}
          placeholder={`Search ${field.lookupObjectApiName || 'records'}...`}
          error={!!error}
          allowCreate={!disableCreate && !disabled}
          disabled={disabled}
        />
      );

    default:
      return (
        <input
          type="text"
          className={cls('input')}
          value={value ?? ''}
          onChange={handleChange}
          maxLength={field.maxLength}
          placeholder={field.helpText || `Enter ${field.label.toLowerCase()}`}
          disabled={disabled}
        />
      );
  }
}

// ─── FieldValue ───────────────────────────────────────────────
// Read-only formatted display of a field value. Resolves lookups internally.
function FieldValue({ field, value }) {
  const { symbol } = useCurrency();
  const [resolved, setResolved] = useState(null);

  useEffect(() => {
    const isLookup = field.type === 'lookup' || field.type === 'master_detail';
    if (!isLookup || !value) {
      setResolved(null);
      return;
    }

    let cancelled = false;
    const run = async () => {
      try {
        if (field.lookupObjectApiName === 'user') {
          const res = await api.get(`/users/${value}`);
          const u = res.data.data;
          if (!cancelled)
            setResolved({ label: `${u.firstName} ${u.lastName}`, link: null });
        } else {
          const res = await api.get(
            `/records/${field.lookupObjectApiName}/${value}`,
          );
          const rec = res.data.data;
          const displayKey = field.lookupDisplayField || 'name';
          const label =
            rec[displayKey] ||
            (rec.first_name
              ? `${rec.first_name} ${rec.last_name || ''}`.trim()
              : null) ||
            String(value).slice(-8);
          if (!cancelled)
            setResolved({
              label,
              link: `/o/${field.lookupObjectApiName}/${value}`,
            });
        }
      } catch {
        if (!cancelled)
          setResolved({ label: String(value).slice(-8), link: null });
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [field.type, field.lookupObjectApiName, field.lookupDisplayField, value]);

  if (value === null || value === undefined || value === '') {
    return <span className={styles.empty}>—</span>;
  }

  if (field.type === 'lookup' || field.type === 'master_detail') {
    if (!resolved) return <span className={styles.resolving}>…</span>;
    return resolved.link ? (
      <Link to={resolved.link} className={styles.lookupLink}>
        <ExternalLink size={12} />
        {resolved.label}
      </Link>
    ) : (
      <span>{resolved.label}</span>
    );
  }

  // Formula fields render as their declared return type — see resolveDisplayType.
  switch (resolveDisplayType(field)) {
    case 'boolean':
      return <span className={styles.boolValue}>{value ? 'Yes' : 'No'}</span>;

    case 'date':
      return <span>{new Date(value).toLocaleDateString()}</span>;

    case 'datetime':
      return <span>{new Date(value).toLocaleString()}</span>;

    case 'currency':
      return (
        <span>{`${symbol}${parseFloat(value).toLocaleString(undefined, { minimumFractionDigits: 2 })}`}</span>
      );

    case 'percent':
      return <span>{`${value}%`}</span>;

    case 'email':
      return (
        <a href={`mailto:${value}`} className={styles.link}>
          {value}
        </a>
      );

    case 'phone':
      return (
        <a href={`tel:${value}`} className={styles.link}>
          {value}
        </a>
      );

    case 'url':
      return (
        <a
          href={value}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.link}
        >
          {value}
        </a>
      );

    case 'picklist': {
      const pv = field.picklistValues?.find((p) => p.value === value);
      return (
        <span
          className={styles.badge}
          style={
            pv?.color ? { background: `${pv.color}20`, color: pv.color } : {}
          }
        >
          {pv?.label || value}
        </span>
      );
    }

    case 'multipicklist': {
      const vals = Array.isArray(value) ? value : [value];
      return (
        <div className={styles.badgeGroup}>
          {vals.map((v) => {
            const pv = field.picklistValues?.find((p) => p.value === v);
            return (
              <span
                key={v}
                className={styles.badge}
                style={
                  pv?.color
                    ? { background: `${pv.color}20`, color: pv.color }
                    : {}
                }
              >
                {pv?.label || v}
              </span>
            );
          })}
        </div>
      );
    }

    case 'textarea':
    case 'richtext':
      return <span className={styles.multiline}>{value}</span>;

    case 'time':
      return <span>{value}</span>;

    case 'address': {
      if (typeof value === 'object' && value !== null) {
        const parts = [value.street, value.city, value.state, value.postalCode, value.country].filter(Boolean);
        return <span className={styles.multiline}>{parts.join(', ')}</span>;
      }
      return <span>{value}</span>;
    }

    default:
      return <span>{String(value)}</span>;
  }
}

// ─── Field ────────────────────────────────────────────────────
// Full field wrapper: label + helpText + input (edit) or value (view) + error.
//
// Props:
//   field      FieldMeta object from the API
//   value      Current value
//   onChange   (apiName, value) => void  [edit mode only]
//   mode       'edit' (default) | 'view'
//   error      Error message string      [edit mode only]
//   label      Override displayed label, or false to hide the label row
//   disabled   Disable the input         [edit mode only]
//   disableCreate Disable create in lookup fields [edit mode only]
//   className  Extra class on the wrapper div
const Field = ({
  field,
  value,
  onChange,
  mode = 'edit',
  error,
  label,
  disabled,
  disableCreate,
  className,
}) => {
  const showLabel = label !== false;
  const labelText = label || field.label;
  const isBoolean = field.type === 'boolean';

  return (
    // data-field lets a form locate a specific field in the DOM — used to scroll
    // to and focus the first input a failed save flagged.
    <div
      className={[styles.field, className].filter(Boolean).join(' ')}
      data-field={field.apiName}
      data-has-error={error ? 'true' : undefined}
    >
      {/* Boolean renders its own label inside the checkbox, skip the outer one */}
      {showLabel && mode === 'edit' && !isBoolean && (
        <label className={styles.label}>
          {labelText}
          {field.isRequired && <span className={styles.required}>*</span>}
        </label>
      )}
      {showLabel && mode === 'view' && (
        <span className={styles.label}>{labelText}</span>
      )}

      {mode === 'edit' && field.helpText && (
        <p className={styles.helpText}>{field.helpText}</p>
      )}

      {mode === 'edit' ? (
        <FieldInput
          field={field}
          value={value}
          onChange={onChange}
          error={error}
          disabled={disabled}
          disableCreate={disableCreate}
        />
      ) : (
        <div className={styles.viewValue}>
          <FieldValue field={field} value={value} />
        </div>
      )}

      {mode === 'edit' && error && (
        <span className={styles.error}>{error}</span>
      )}
    </div>
  );
};

export default Field;
