import React, {
  useState,
  useRef,
  useEffect,
  useMemo,
  useCallback,
} from 'react';
import { createPortal } from 'react-dom';
import api from '../../../services/api.js';
import styles from './shared.module.css';

export const genId = () =>
  `s_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

export const OPERATORS = [
  { value: 'equals', label: 'equals' },
  { value: 'not_equals', label: 'does not equal' },
  { value: 'contains', label: 'contains' },
  { value: 'starts_with', label: 'starts with' },
  { value: 'ends_with', label: 'ends with' },
  { value: 'greater_than', label: 'greater than' },
  { value: 'less_than', label: 'less than' },
  { value: 'gte', label: '>=' },
  { value: 'lte', label: '<=' },
  { value: 'is_null', label: 'is blank' },
  { value: 'is_not_null', label: 'is not blank' },
  { value: 'changed', label: 'has changed' },
];

export const SYSTEM_MERGE_FIELDS = [
  { apiName: '_id', label: 'Record — MongoDB _id' },
  { apiName: 'id', label: 'Record — ID (string)' },
  { apiName: 'objectApiName', label: 'Record — Object type' },
  { apiName: 'ownerId', label: 'Record — Owner ID' },
  { apiName: 'createdAt', label: 'Record — Created date' },
  { apiName: 'updatedAt', label: 'Record — Updated date' },
];

export const USER_MERGE_FIELDS = [
  { apiName: '$User.id', label: 'Running User — ID' },
  { apiName: '$User.firstName', label: 'Running User — First name' },
  { apiName: '$User.lastName', label: 'Running User — Last name' },
  { apiName: '$User.name', label: 'Running User — Full name' },
  { apiName: '$User.email', label: 'Running User — Email' },
  { apiName: '$User.systemRole', label: 'Running User — System role' },
  { apiName: '$User.tenantId', label: 'Running User — Tenant ID' },
];

// Record-page context merge fields (only available on embedded flows)
export const RECORD_PAGE_MERGE_FIELDS = [
  { apiName: 'record._id', label: 'Page Record — MongoDB _id' },
  { apiName: 'record.id', label: 'Page Record — ID (string)' },
  { apiName: 'record.name', label: 'Page Record — Name' },
  { apiName: 'record.objectApiName', label: 'Page Record — Object type' },
  { apiName: 'record.ownerId', label: 'Page Record — Owner ID' },
];

// ─── Portal floating-position hook ───────────────────────────
/**
 * Calculates `position: fixed` coordinates for a dropdown triggered by `triggerRef`.
 * Flips upward automatically when there isn't enough space below.
 * Re-calculates on scroll / resize.
 */
function useDropdownPos(
  triggerRef,
  open,
  { minWidth = 280, maxHeight = 260 } = {},
) {
  const [style, setStyle] = useState(null);

  const calc = useCallback(() => {
    const el = triggerRef.current;
    if (!open || !el) {
      setStyle(null);
      return;
    }
    const r = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom - 8;
    const spaceAbove = r.top - 8;
    const goUp = spaceBelow < maxHeight && spaceAbove > spaceBelow;

    setStyle({
      position: 'fixed',
      top: goUp
        ? Math.max(8, r.top - Math.min(maxHeight, spaceAbove) - 4)
        : r.bottom + 4,
      left: r.left,
      minWidth: Math.max(r.width, minWidth),
      maxHeight: goUp
        ? Math.min(maxHeight, spaceAbove)
        : Math.min(maxHeight, spaceBelow),
      zIndex: 9999,
    });
  }, [open, triggerRef, minWidth, maxHeight]);

  useEffect(() => {
    calc();
    if (!open) return;
    window.addEventListener('scroll', calc, true);
    window.addEventListener('resize', calc);
    return () => {
      window.removeEventListener('scroll', calc, true);
      window.removeEventListener('resize', calc);
    };
  }, [open, calc]);

  return style;
}

// ─── Shared form primitives ───────────────────────────────────
export function Inp({
  value,
  onChange,
  placeholder,
  type = 'text',
  disabled,
  style,
}) {
  return (
    <input
      type={type}
      className={styles.inp}
      style={style}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
    />
  );
}

export function Sel({ value, onChange, options, placeholder, style }) {
  return (
    <select
      className={styles.inp}
      style={style}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value ?? o} value={o.value ?? o}>
          {o.label ?? o}
        </option>
      ))}
    </select>
  );
}

export function Row({ label, hint, children }) {
  return (
    <div className={styles.cfgRow}>
      <div className={styles.cfgMeta}>
        <span className={styles.cfgLabel}>{label}</span>
        {hint && <span className={styles.cfgHint}>{hint}</span>}
      </div>
      <div className={styles.cfgValue}>{children}</div>
    </div>
  );
}

export function KvEditor({
  pairs,
  onChange,
  keyPlaceholder = 'Key',
  valPlaceholder = 'Value',
}) {
  const add = () => onChange([...pairs, { key: '', value: '' }]);
  const upd = (i, k, v) =>
    onChange(pairs.map((p, idx) => (idx === i ? { ...p, [k]: v } : p)));
  const del = (i) => onChange(pairs.filter((_, idx) => idx !== i));
  return (
    <div className={styles.kvList}>
      {pairs.map((p, i) => (
        <div key={i} className={styles.kvRow}>
          <Inp
            value={p.key}
            onChange={(v) => upd(i, 'key', v)}
            placeholder={keyPlaceholder}
          />
          <span className={styles.pairEq}>=</span>
          <Inp
            value={p.value}
            onChange={(v) => upd(i, 'value', v)}
            placeholder={valPlaceholder}
          />
          <button className={styles.delBtn} onClick={() => del(i)}>
            ×
          </button>
        </div>
      ))}
      <button className={styles.addBtn} onClick={add}>
        + Add
      </button>
    </div>
  );
}

export function FieldMapping({
  objectApiName,
  externalFields,
  mapping,
  onChange,
  fields = [],
  variables = [],
  outputVariables = [],
  recordPageFields = [],
}) {
  const [objFields, setObjFields] = useState(externalFields || []);
  const [addKey, setAddKey] = useState('');

  useEffect(() => {
    if (externalFields) {
      setObjFields(externalFields);
      return;
    }
    if (!objectApiName) {
      setObjFields([]);
      return;
    }
    api
      .get(`/objects/${objectApiName}`)
      .then((r) =>
        setObjFields(
          (r.data.data?.fields || [])
            .filter((f) => !['formula', 'rollup_summary', 'master_detail'].includes(f.type))
            .sort((a, b) => a.displayOrder - b.displayOrder),
        ),
      )
      .catch(() => setObjFields([]));
  }, [objectApiName, externalFields]);

  const setVal = (k, v) => onChange({ ...mapping, [k]: v });
  const delKey = (k) => {
    const n = { ...mapping };
    delete n[k];
    onChange(n);
  };
  const hasMergeCtx =
    fields.length > 0 ||
    variables.length > 0 ||
    outputVariables.length > 0 ||
    recordPageFields.length > 0;

  return (
    <div className={styles.kvList}>
      {Object.entries(mapping || {}).map(([k, v]) => {
        const fieldDef = objFields.find((f) => f.apiName === k);
        const isPicklist = fieldDef?.type === 'picklist' || fieldDef?.type === 'multipicklist';
        const isBoolean = fieldDef?.type === 'boolean' || fieldDef?.type === 'checkbox';
        const picklistOpts = isPicklist
          ? (fieldDef.picklistValues || []).filter((pv) => pv.isActive !== false)
          : [];
        return (
        <div key={k} className={styles.kvRow}>
          <span className={styles.pairField}>
            {fieldDef?.label || k}
          </span>
          <span className={styles.pairEq}>=</span>
          {isPicklist ? (
            <select
              className={styles.inp}
              value={v || ''}
              onChange={(e) => setVal(k, e.target.value)}
            >
              <option value="">— Select value —</option>
              {picklistOpts.map((pv) => (
                <option key={pv.value} value={pv.value}>{pv.label}</option>
              ))}
            </select>
          ) : isBoolean ? (
            <select
              className={styles.inp}
              value={v || ''}
              onChange={(e) => setVal(k, e.target.value)}
            >
              <option value="">— Select —</option>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          ) : hasMergeCtx ? (
            <MergeInput
              value={v}
              onChange={(val) => setVal(k, val)}
              placeholder="Value or {field_name}"
              fields={fields}
              variables={variables}
              outputVariables={outputVariables}
              recordPageFields={recordPageFields}
            />
          ) : (
            <Inp
              value={v}
              onChange={(val) => setVal(k, val)}
              placeholder="Value or {field_name}"
            />
          )}
          <button className={styles.delBtn} onClick={() => delKey(k)}>
            ×
          </button>
        </div>
        );
      })}
      <div className={styles.kvRow}>
        <Sel
          value={addKey}
          onChange={setAddKey}
          placeholder="— Add field —"
          options={objFields
            .filter((f) => !Object.keys(mapping || {}).includes(f.apiName))
            .map((f) => ({ value: f.apiName, label: f.label }))}
        />
        <button
          className={styles.addBtn}
          style={{ flexShrink: 0, marginTop: 0 }}
          onClick={() => {
            if (addKey) {
              setVal(addKey, '');
              setAddKey('');
            }
          }}
        >
          + Add field
        </button>
      </div>
    </div>
  );
}

// ─── MergeFieldPicker — portal-rendered dropdown ─────────────
export function MergeFieldPicker({
  fields = [],
  variables = [],
  relatedFields = {},
  outputVariables = [],
  recordPageFields = [],
  onInsert,
}) {
  const [open, setOpen] = useState(false);
  const [expandedRel, setExpandedRel] = useState(null);
  const [expandedOut, setExpandedOut] = useState(null);
  const btnRef = useRef(null);
  const dropRef = useRef(null);
  const dropStyle = useDropdownPos(btnRef, open, {
    minWidth: 300,
    maxHeight: 320,
  });

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (
        btnRef.current &&
        !btnRef.current.contains(e.target) &&
        dropRef.current &&
        !dropRef.current.contains(e.target)
      )
        setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const insert = (token) => {
    onInsert(token);
    setOpen(false);
  };
  const triggerFields = [...SYSTEM_MERGE_FIELDS, ...fields];

  return (
    <div className={styles.mergePickerWrap}>
      <button
        ref={btnRef}
        type="button"
        className={styles.mergeBtn}
        onClick={() => setOpen((o) => !o)}
      >
        {'{}'} Insert field
      </button>

      {open &&
        dropStyle &&
        createPortal(
          <div ref={dropRef} className={styles.mergeMenu} style={dropStyle}>
            <div className={styles.mergeHeader}>
              Click a field to insert at cursor
            </div>

            {triggerFields.length > 0 && (
              <>
                <div className={styles.mergeGroupLabel}>
                  Trigger / Current Record
                </div>
                {triggerFields.map((f) => (
                  <button
                    key={f.apiName}
                    type="button"
                    className={styles.mergeItem}
                    onClick={() => insert(`{${f.apiName}}`)}
                  >
                    <code>{`{${f.apiName}}`}</code>
                    <span>{f.label}</span>
                  </button>
                ))}
              </>
            )}

            {recordPageFields.length > 0 && (
              <>
                <div className={styles.mergeGroupLabel}>Page Record</div>
                {recordPageFields.map((f) => (
                  <button
                    key={f.apiName}
                    type="button"
                    className={styles.mergeItem}
                    onClick={() => insert(`{${f.apiName}}`)}
                  >
                    <code>{`{${f.apiName}}`}</code>
                    <span>{f.label}</span>
                  </button>
                ))}
              </>
            )}

            {Object.keys(relatedFields).length > 0 && (
              <>
                <div className={styles.mergeGroupLabel}>Related Records</div>
                {Object.entries(relatedFields).map(([lookupKey, rel]) => (
                  <div key={lookupKey}>
                    <button
                      type="button"
                      className={styles.relExpander}
                      onClick={() =>
                        setExpandedRel((r) =>
                          r === lookupKey ? null : lookupKey,
                        )
                      }
                    >
                      <span className={styles.relExpandIcon}>
                        {expandedRel === lookupKey ? '▼' : '▶'}
                      </span>
                      <span className={styles.relName}>{rel.objectLabel}</span>
                      <span className={styles.relToken}>
                        {rel.relationshipName || lookupKey}
                      </span>
                    </button>
                    {expandedRel === lookupKey && (
                      <div className={styles.relFields}>
                        {rel.fields.map((rf) => {
                          const relName = rel.relationshipName || lookupKey;
                          return (
                            <button
                              key={rf.apiName}
                              type="button"
                              className={styles.mergeItemIndented}
                              onClick={() =>
                                insert(`{${relName}.${rf.apiName}}`)
                              }
                            >
                              <code>{`{${relName}.${rf.apiName}}`}</code>
                              <span>{rf.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </>
            )}

            <div className={styles.mergeGroupLabel}>Running User</div>
            {USER_MERGE_FIELDS.map((f) => (
              <button
                key={f.apiName}
                type="button"
                className={styles.mergeItem}
                onClick={() => insert(`{${f.apiName}}`)}
              >
                <code>{`{${f.apiName}}`}</code>
                <span>{f.label}</span>
              </button>
            ))}

            {outputVariables.length > 0 && (
              <>
                <div className={styles.mergeGroupLabel}>Created Records</div>
                {outputVariables.map((v) => (
                  <div key={v.name}>
                    <button
                      type="button"
                      className={styles.relExpander}
                      onClick={() =>
                        setExpandedOut((n) => (n === v.name ? null : v.name))
                      }
                    >
                      <span className={styles.relExpandIcon}>
                        {expandedOut === v.name ? '▼' : '▶'}
                      </span>
                      <span className={styles.relName}>
                        {v.label || v.name}
                      </span>
                      <span className={styles.relToken}>{v.objectApiName}</span>
                    </button>
                    {expandedOut === v.name && (
                      <div className={styles.relFields}>
                        {[
                          { apiName: '_id', label: 'MongoDB _id' },
                          ...(v.fields || []),
                        ].map((f) => (
                          <button
                            key={f.apiName}
                            type="button"
                            className={styles.mergeItemIndented}
                            onClick={() => insert(`{${v.name}.${f.apiName}}`)}
                          >
                            <code>{`{${v.name}.${f.apiName}}`}</code>
                            <span>{f.label || f.apiName}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </>
            )}

            {variables.length > 0 && (
              <>
                <div className={styles.mergeGroupLabel}>Flow Variables</div>
                {variables.map((v) => (
                  <button
                    key={v.name}
                    type="button"
                    className={styles.mergeItem}
                    onClick={() => insert(`{$${v.name}}`)}
                  >
                    <code>{`{$${v.name}}`}</code>
                    <span>
                      {v.label || v.name} ({v.dataType})
                    </span>
                  </button>
                ))}
              </>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}

// ─── MergeInput — inline autocomplete via portal ─────────────
export function MergeInput({
  value,
  onChange,
  placeholder,
  rows,
  fields = [],
  variables = [],
  relatedFields = {},
  outputVariables = [],
  recordPageFields = [],
}) {
  const inputRef = useRef(null);
  const dropRef = useRef(null);
  const [showSugg, setShowSugg] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [queryStart, setQueryStart] = useState(-1);
  const dropStyle = useDropdownPos(inputRef, showSugg, {
    minWidth: 300,
    maxHeight: 240,
  });

  // ── All available tokens ──────────────────────────────────
  const allTokens = useMemo(() => {
    const list = [];
    [...SYSTEM_MERGE_FIELDS, ...fields].forEach((f) =>
      list.push({
        token: `{${f.apiName}}`,
        apiName: f.apiName,
        label: f.label,
        group: 'Current Record',
      }),
    );
    recordPageFields.forEach((f) =>
      list.push({
        token: `{${f.apiName}}`,
        apiName: f.apiName,
        label: f.label,
        group: 'Page Record',
      }),
    );
    Object.entries(relatedFields).forEach(([key, rel]) => {
      rel.fields.forEach((rf) =>
        list.push({
          token: `{${rel.relationshipName || key}.${rf.apiName}}`,
          apiName: `${rel.relationshipName || key}.${rf.apiName}`,
          label: `${rel.objectLabel} — ${rf.label}`,
          group: rel.objectLabel,
        }),
      );
    });
    USER_MERGE_FIELDS.forEach((f) =>
      list.push({
        token: `{${f.apiName}}`,
        apiName: f.apiName,
        label: f.label,
        group: 'Running User',
      }),
    );
    outputVariables.forEach((v) => {
      [{ apiName: '_id', label: 'MongoDB _id' }, ...(v.fields || [])].forEach(
        (f) =>
          list.push({
            token: `{${v.name}.${f.apiName}}`,
            apiName: `${v.name}.${f.apiName}`,
            label: `${v.label || v.name} — ${f.label || f.apiName}`,
            group: 'Created Records',
          }),
      );
    });
    variables.forEach((v) =>
      list.push({
        token: `{$${v.name}}`,
        apiName: `$${v.name}`,
        label: `${v.label || v.name} (${v.dataType})`,
        group: 'Flow Variables',
      }),
    );
    return list;
  }, [fields, relatedFields, variables, outputVariables, recordPageFields]);

  // Grouped with flat index for keyboard nav
  const groupedSuggestions = useMemo(() => {
    let idx = 0;
    const groups = {};
    suggestions.forEach((s) => {
      if (!groups[s.group]) groups[s.group] = [];
      groups[s.group].push({ ...s, flatIdx: idx++ });
    });
    return groups;
  }, [suggestions]);

  const detectSuggestions = (val, cursorPos) => {
    const textBefore = (val || '').slice(0, cursorPos);
    const lastOpen = textBefore.lastIndexOf('{');
    const lastClose = textBefore.lastIndexOf('}');
    if (lastOpen !== -1 && lastOpen > lastClose) {
      const query = textBefore.slice(lastOpen + 1).toLowerCase();
      setQueryStart(lastOpen);
      const filtered =
        query === ''
          ? allTokens.slice(0, 25)
          : allTokens
              .filter(
                (t) =>
                  t.apiName.toLowerCase().includes(query) ||
                  t.label.toLowerCase().includes(query),
              )
              .slice(0, 25);
      setSuggestions(filtered);
      setShowSugg(filtered.length > 0);
      setSelectedIdx(0);
    } else {
      setShowSugg(false);
      setQueryStart(-1);
    }
  };

  const handleChange = (e) => {
    onChange(e.target.value);
    detectSuggestions(e.target.value, e.target.selectionStart);
  };

  const insertSuggestion = (suggestion) => {
    const el = inputRef.current;
    const cur = el ? el.selectionStart : (value || '').length;
    const start = queryStart !== -1 ? queryStart : cur;
    const next =
      (value || '').slice(0, start) +
      suggestion.token +
      (value || '').slice(cur);
    onChange(next);
    setShowSugg(false);
    requestAnimationFrame(() => {
      if (el) {
        el.focus();
        el.setSelectionRange(
          start + suggestion.token.length,
          start + suggestion.token.length,
        );
      }
    });
  };

  const handleKeyDown = (e) => {
    if (!showSugg) return;
    const total = suggestions.length;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx((i) => (i + 1) % total);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx((i) => (i - 1 + total) % total);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      if (suggestions[selectedIdx]) {
        e.preventDefault();
        insertSuggestion(suggestions[selectedIdx]);
      }
    } else if (e.key === 'Escape') {
      setShowSugg(false);
    }
  };

  // Close suggestions on outside click
  useEffect(() => {
    if (!showSugg) return;
    const handler = (e) => {
      if (
        inputRef.current &&
        !inputRef.current.contains(e.target) &&
        dropRef.current &&
        !dropRef.current.contains(e.target)
      )
        setShowSugg(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showSugg]);

  const insertFromPicker = (token) => {
    const el = inputRef.current;
    if (!el) {
      onChange((value || '') + token);
      return;
    }
    const s = el.selectionStart ?? (value || '').length;
    const e = el.selectionEnd ?? s;
    const next = (value || '').slice(0, s) + token + (value || '').slice(e);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(s + token.length, s + token.length);
    });
  };

  const commonProps = {
    ref: inputRef,
    className: styles.inp,
    value: value ?? '',
    onChange: handleChange,
    onKeyDown: handleKeyDown,
    placeholder,
  };

  return (
    <div className={styles.mergeInputWrap}>
      {rows > 1 ? (
        <textarea {...commonProps} rows={rows} />
      ) : (
        <input {...commonProps} type="text" />
      )}

      {/* Autocomplete portal */}
      {showSugg &&
        dropStyle &&
        createPortal(
          <div
            ref={dropRef}
            className={styles.suggestDropdown}
            style={dropStyle}
          >
            {Object.entries(groupedSuggestions).map(([group, items]) => (
              <div key={group}>
                <div className={styles.suggestGroup}>{group}</div>
                {items.map((item) => (
                  <button
                    key={item.token}
                    type="button"
                    className={`${styles.suggestItem} ${item.flatIdx === selectedIdx ? styles.suggestItemActive : ''}`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      insertSuggestion(item);
                    }}
                    onMouseEnter={() => setSelectedIdx(item.flatIdx)}
                  >
                    <code className={styles.suggestToken}>{item.token}</code>
                    <span className={styles.suggestLabel}>{item.label}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>,
          document.body,
        )}

      <div className={styles.mergeInputActions}>
        <span className={styles.mergeHint}>
          Type <code>{'{'}</code> to insert a field
        </span>
        <MergeFieldPicker
          fields={fields}
          variables={variables}
          relatedFields={relatedFields}
          outputVariables={outputVariables}
          recordPageFields={recordPageFields}
          onInsert={insertFromPicker}
        />
      </div>
    </div>
  );
}

function ConditionValueInput({ condition, fieldMeta, onChange }) {
  if (['is_null', 'is_not_null', 'changed'].includes(condition.operator))
    return null;
  if (!fieldMeta)
    return (
      <Inp value={condition.value} onChange={onChange} placeholder="Value" />
    );
  switch (fieldMeta.type) {
    case 'picklist':
    case 'multipicklist': {
      const opts = (fieldMeta.picklistValues || []).filter(
        (pv) => pv.isActive !== false,
      );
      return (
        <select
          className={styles.inp}
          value={condition.value || ''}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">— Select value —</option>
          {opts.map((pv) => (
            <option key={pv.value} value={pv.value}>
              {pv.label}
            </option>
          ))}
        </select>
      );
    }
    case 'boolean':
      return (
        <select
          className={styles.inp}
          value={condition.value || ''}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">— Select —</option>
          <option value="true">Yes (true)</option>
          <option value="false">No (false)</option>
        </select>
      );
    case 'date':
      return (
        <input
          type="date"
          className={styles.inp}
          value={condition.value || ''}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'datetime':
      return (
        <input
          type="datetime-local"
          className={styles.inp}
          value={condition.value || ''}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'number':
    case 'currency':
    case 'percent':
      return (
        <input
          type="number"
          className={styles.inp}
          value={condition.value || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Number"
        />
      );
    default:
      return (
        <Inp value={condition.value} onChange={onChange} placeholder="Value" />
      );
  }
}

const SYSTEM_FILTER_FIELDS = [{ apiName: '_id', label: 'Record ID (_id)' }];

export function ConditionBuilder({
  conditions,
  onChange,
  fields = [],
  logic,
  onLogicChange,
  triggerFields = [],
  variables = [],
  outputVariables = [],
  recordPageFields = [],
}) {
  const upd = (i, k, v) =>
    onChange(conditions.map((c, idx) => (idx === i ? { ...c, [k]: v } : c)));
  const add = () =>
    onChange([...conditions, { field: '', operator: 'equals', value: '' }]);
  const del = (i) => onChange(conditions.filter((_, idx) => idx !== i));

  // Build extra field options from outputVariables (e.g. newContact.name) and recordPageFields
  const outputVarFields = outputVariables.flatMap((v) => [
    { apiName: `${v.name}._id`, label: `${v.label || v.name} — ID` },
    ...(v.fields || []).map((f) => ({
      apiName: `${v.name}.${f.apiName}`,
      label: `${v.label || v.name} — ${f.label || f.apiName}`,
    })),
  ]);
  const allFilterFields = [
    ...SYSTEM_FILTER_FIELDS,
    ...fields,
    ...recordPageFields,
    ...USER_MERGE_FIELDS.map((f) => ({ apiName: f.apiName, label: f.label })),
    ...outputVarFields,
  ];

  const hasMergeContext =
    triggerFields.length > 0 ||
    variables.length > 0 ||
    outputVariables.length > 0 ||
    recordPageFields.length > 0;
  return (
    <div className={styles.condBlock}>
      {onLogicChange && (
        <div className={styles.logicRow}>
          <span>Match</span>
          <Sel
            value={logic || 'all'}
            onChange={onLogicChange}
            options={[
              { value: 'all', label: 'ALL (AND)' },
              { value: 'any', label: 'ANY (OR)' },
            ]}
          />
          <span>of:</span>
        </div>
      )}
      {conditions.map((c, i) => {
        const fieldMeta = allFilterFields.find((f) => f.apiName === c.field);
        const showMerge =
          hasMergeContext &&
          !['is_null', 'is_not_null', 'changed'].includes(c.operator);
        return (
          <div key={i} className={styles.conditionRow}>
            <div className={styles.conditionField}>
              <Sel
                value={c.field}
                onChange={(v) => upd(i, 'field', v)}
                placeholder="Field"
                options={allFilterFields.map((f) => ({
                  value: f.apiName,
                  label: f.label,
                }))}
              />
            </div>
            <div className={styles.conditionOp}>
              <Sel
                value={c.operator}
                onChange={(v) => upd(i, 'operator', v)}
                options={OPERATORS}
              />
            </div>
            <div className={styles.conditionVal}>
              {showMerge ? (
                <MergeInput
                  value={c.value}
                  onChange={(v) => upd(i, 'value', v)}
                  placeholder="{field} or value"
                  fields={triggerFields}
                  variables={variables}
                  outputVariables={outputVariables}
                  recordPageFields={recordPageFields}
                />
              ) : (
                <ConditionValueInput
                  condition={c}
                  fieldMeta={fieldMeta}
                  onChange={(v) => upd(i, 'value', v)}
                />
              )}
            </div>
            <button className={styles.delBtn} onClick={() => del(i)}>
              ×
            </button>
          </div>
        );
      })}
      <button className={styles.addBtn} onClick={add}>
        + Add condition
      </button>
    </div>
  );
}
