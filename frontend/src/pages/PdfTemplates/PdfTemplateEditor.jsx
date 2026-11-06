import React, { useEffect, useState, useCallback, useRef, useLayoutEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import {
  ArrowLeft,
  Save,
  Plus,
  Trash2,
  GripVertical,
  Settings2,
  Type,
  Table,
  Image,
  Minus,
  Scissors,
  AlignLeft,
  AlignCenter,
  AlignRight,
  ChevronDown,
  ChevronUp,
  Eye,
  X,
  FileText,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { v4 as uuidv4 } from 'uuid';
import api from '../../services/api';
import Button from '../../components/common/Button/Button';
import Layout from '../../layout/Layout';
import styles from './PdfTemplateEditor.module.css';

// ─── Block type registry ──────────────────────────────────────────────────────
const BLOCK_TYPES = {
  text: { label: 'Text / Merge', icon: <Type size={15} />, color: '#6366f1' },
  record_field: {
    label: 'Record Field',
    icon: <AlignLeft size={15} />,
    color: '#0891b2',
  },
  datatable: {
    label: 'Data Table',
    icon: <Table size={15} />,
    color: '#059669',
  },
  image: { label: 'Image', icon: <Image size={15} />, color: '#f59e0b' },
  divider: { label: 'Divider', icon: <Minus size={15} />, color: '#64748b' },
  page_break: {
    label: 'Page Break',
    icon: <Scissors size={15} />,
    color: '#dc2626',
  },
  spacer: {
    label: 'Spacer',
    icon: <AlignCenter size={15} />,
    color: '#94a3b8',
  },
};

const DEFAULT_BLOCK_CONFIG = {
  text: { content: '' },
  record_field: { inputName: '', fieldApiName: '', label: '', showLabel: true },
  datatable: { inputName: '', columns: [] },
  image: { inputName: '', url: '', width: 200, height: 'auto' },
  divider: { thickness: 1, color: '#e2e8f0' },
  page_break: {},
  spacer: { height: 24 },
};

const DEFAULT_BLOCK_STYLE = {
  fontSize: 13,
  bold: false,
  italic: false,
  align: 'left',
  color: '#111827',
  marginTop: 0,
  marginBottom: 8,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function newBlock(type) {
  return {
    id: uuidv4(),
    type,
    order: 0,
    style: { ...DEFAULT_BLOCK_STYLE },
    config: { ...DEFAULT_BLOCK_CONFIG[type] },
  };
}

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

// ─── Inline merge token inserter ──────────────────────────────────────────────
function MergeTokenPicker({ inputs, onInsert }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const h = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const tokens = [];
  inputs.forEach((inp) => {
    if (inp.type === 'record' && inp.objectApiName) {
      tokens.push({ token: `{${inp.name}._id}`, label: `${inp.label} — ID` });
      tokens.push({
        token: `{${inp.name}.name}`,
        label: `${inp.label} — Name`,
      });
      tokens.push({
        token: `{${inp.name}.*}`,
        label: `${inp.label} — (any field)`,
      });
    } else if (
      inp.type === 'text' ||
      inp.type === 'number' ||
      inp.type === 'date'
    ) {
      tokens.push({ token: `{${inp.name}}`, label: inp.label });
    }
  });
  // System tokens
  tokens.push({ token: '{$User.name}', label: 'Running User — Full name' });
  tokens.push({ token: '{$User.email}', label: 'Running User — Email' });
  tokens.push({ token: '{$now}', label: 'Current date/time' });
  tokens.push({ token: '{$today}', label: "Today's date" });

  return (
    <div className={styles.mergePickerWrap} ref={ref}>
      <button
        type="button"
        className={styles.mergeBtn}
        onClick={() => setOpen((o) => !o)}
      >
        {'{ }'} Insert merge field
      </button>
      {open && (
        <div className={styles.mergeMenu}>
          <div className={styles.mergeMenuHeader}>
            Click to insert at cursor
          </div>
          {tokens.length === 0 ? (
            <div className={styles.mergeMenuEmpty}>
              No inputs defined yet. Add inputs in the Settings panel.
            </div>
          ) : (
            tokens.map((t) => (
              <button
                key={t.token}
                type="button"
                className={styles.mergeMenuItem}
                onClick={() => {
                  onInsert(t.token);
                  setOpen(false);
                }}
              >
                <code>{t.token}</code>
                <span>{t.label}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ─── Block config editors ─────────────────────────────────────────────────────

function TextBlockConfig({ config, style, onConfig, onStyle, inputs }) {
  const taRef = useRef(null);
  const insert = (token) => {
    const el = taRef.current;
    if (!el) {
      onConfig({ ...config, content: (config.content || '') + token });
      return;
    }
    const s = el.selectionStart ?? (config.content || '').length;
    const e = el.selectionEnd ?? s;
    const next =
      (config.content || '').slice(0, s) +
      token +
      (config.content || '').slice(e);
    onConfig({ ...config, content: next });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(s + token.length, s + token.length);
    });
  };
  return (
    <div className={styles.blockCfg}>
      <div className={styles.cfgRow}>
        <label className={styles.cfgLabel}>Content</label>
        <MergeTokenPicker inputs={inputs} onInsert={insert} />
        <textarea
          ref={taRef}
          className={styles.cfgTextarea}
          rows={4}
          value={config.content || ''}
          onChange={(e) => onConfig({ ...config, content: e.target.value })}
          placeholder="Type text or insert {merge} fields…"
        />
      </div>
      <StyleControls style={style} onChange={onStyle} />
    </div>
  );
}

function RecordFieldConfig({ config, onConfig, style, onStyle, inputs }) {
  const recordInputs = inputs.filter((i) => i.type === 'record');
  const [objFields, setObjFields] = useState([]);
  const selectedInput = recordInputs.find((i) => i.name === config.inputName);

  useEffect(() => {
    if (!selectedInput?.objectApiName) {
      setObjFields([]);
      return;
    }
    api
      .get(`/objects/${selectedInput.objectApiName}`)
      .then((r) => setObjFields(r.data.data?.fields || []))
      .catch(() => setObjFields([]));
  }, [selectedInput?.objectApiName]);

  return (
    <div className={styles.blockCfg}>
      <div className={styles.cfgRow}>
        <label className={styles.cfgLabel}>Record input</label>
        <select
          className={styles.cfgSelect}
          value={config.inputName || ''}
          onChange={(e) =>
            onConfig({ ...config, inputName: e.target.value, fieldApiName: '' })
          }
        >
          <option value="">— Select input —</option>
          {recordInputs.map((i) => (
            <option key={i.name} value={i.name}>
              {i.label}
            </option>
          ))}
        </select>
      </div>
      {config.inputName && (
        <div className={styles.cfgRow}>
          <label className={styles.cfgLabel}>Field</label>
          <select
            className={styles.cfgSelect}
            value={config.fieldApiName || ''}
            onChange={(e) =>
              onConfig({ ...config, fieldApiName: e.target.value })
            }
          >
            <option value="">— Select field —</option>
            {objFields.map((f) => (
              <option key={f.apiName} value={f.apiName}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className={styles.cfgRow}>
        <label className={styles.cfgLabel}>Label override</label>
        <input
          className={styles.cfgInput}
          value={config.label || ''}
          onChange={(e) => onConfig({ ...config, label: e.target.value })}
          placeholder="Leave blank to use field label"
        />
      </div>
      <div className={styles.cfgRow}>
        <label className={styles.cfgLabel}>Show label</label>
        <input
          type="checkbox"
          checked={config.showLabel !== false}
          onChange={(e) => onConfig({ ...config, showLabel: e.target.checked })}
        />
      </div>
      <StyleControls style={style} onChange={onStyle} />
    </div>
  );
}

function DatatableConfig({ config, onConfig, inputs }) {
  const collectionInputs = inputs.filter((i) => i.type === 'collection');
  const [objFields, setObjFields] = useState([]);
  const selectedInput = collectionInputs.find(
    (i) => i.name === config.inputName,
  );

  useEffect(() => {
    if (!selectedInput?.objectApiName) {
      setObjFields([]);
      return;
    }
    api
      .get(`/objects/${selectedInput.objectApiName}`)
      .then((r) => setObjFields(r.data.data?.fields || []))
      .catch(() => setObjFields([]));
  }, [selectedInput?.objectApiName]);

  const addColumn = () =>
    onConfig({
      ...config,
      columns: [...(config.columns || []), { fieldApiName: '', label: '' }],
    });
  const updCol = (i, k, v) =>
    onConfig({
      ...config,
      columns: config.columns.map((c, idx) =>
        idx === i ? { ...c, [k]: v } : c,
      ),
    });
  const delCol = (i) =>
    onConfig({
      ...config,
      columns: config.columns.filter((_, idx) => idx !== i),
    });
  const moveCol = (i, dir) => {
    const cols = [...(config.columns || [])];
    const j = i + dir;
    if (j < 0 || j >= cols.length) return;
    [cols[i], cols[j]] = [cols[j], cols[i]];
    onConfig({ ...config, columns: cols });
  };

  return (
    <div className={styles.blockCfg}>
      <div className={styles.cfgRow}>
        <label className={styles.cfgLabel}>Collection input</label>
        <select
          className={styles.cfgSelect}
          value={config.inputName || ''}
          onChange={(e) =>
            onConfig({ ...config, inputName: e.target.value, columns: [] })
          }
        >
          <option value="">— Select input —</option>
          {collectionInputs.map((i) => (
            <option key={i.name} value={i.name}>
              {i.label}
            </option>
          ))}
        </select>
      </div>
      <div className={styles.cfgRow}>
        <label className={styles.cfgLabel}>Columns</label>
        <div className={styles.columnList}>
          {(config.columns || []).map((col, i) => (
            <div key={i} className={styles.columnRow}>
              <div className={styles.colMoveButtons}>
                <button
                  className={styles.colMoveBtn}
                  onClick={() => moveCol(i, -1)}
                  disabled={i === 0}
                  title="Move column up"
                >▲</button>
                <button
                  className={styles.colMoveBtn}
                  onClick={() => moveCol(i, 1)}
                  disabled={i >= (config.columns?.length ?? 0) - 1}
                  title="Move column down"
                >▼</button>
              </div>
              <select
                className={styles.cfgSelect}
                value={col.fieldApiName || ''}
                onChange={(e) => updCol(i, 'fieldApiName', e.target.value)}
              >
                <option value="">— Field —</option>
                {objFields.map((f) => (
                  <option key={f.apiName} value={f.apiName}>
                    {f.label}
                  </option>
                ))}
              </select>
              <input
                className={styles.cfgInput}
                value={col.label || ''}
                onChange={(e) => updCol(i, 'label', e.target.value)}
                placeholder="Header label"
              />
              <button className={styles.delBtn} onClick={() => delCol(i)}>
                ×
              </button>
            </div>
          ))}
          <button className={styles.addBtn} onClick={addColumn}>
            + Add column
          </button>
        </div>
      </div>
    </div>
  );
}

function ImageBlockConfig({ config, onConfig, inputs }) {
  const imageInputs = inputs.filter((i) => i.type === 'image');
  return (
    <div className={styles.blockCfg}>
      <div className={styles.cfgRow}>
        <label className={styles.cfgLabel}>Source</label>
        <select
          className={styles.cfgSelect}
          value={config.source || 'url'}
          onChange={(e) =>
            onConfig({
              ...config,
              source: e.target.value,
              inputName: '',
              url: '',
            })
          }
        >
          <option value="url">Static URL</option>
          <option value="input">From flow input</option>
        </select>
      </div>
      {config.source === 'input' ? (
        <div className={styles.cfgRow}>
          <label className={styles.cfgLabel}>Image input</label>
          <select
            className={styles.cfgSelect}
            value={config.inputName || ''}
            onChange={(e) => onConfig({ ...config, inputName: e.target.value })}
          >
            <option value="">— Select input —</option>
            {imageInputs.map((i) => (
              <option key={i.name} value={i.name}>
                {i.label}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <div className={styles.cfgRow}>
          <label className={styles.cfgLabel}>URL</label>
          <input
            className={styles.cfgInput}
            value={config.url || ''}
            onChange={(e) => onConfig({ ...config, url: e.target.value })}
            placeholder="https://…"
          />
        </div>
      )}
      <div className={styles.inlineRow}>
        <div className={styles.cfgRow} style={{ flex: 1 }}>
          <label className={styles.cfgLabel}>Width (px)</label>
          <input
            type="number"
            className={styles.cfgInput}
            value={config.width || 200}
            onChange={(e) =>
              onConfig({ ...config, width: parseInt(e.target.value) || 200 })
            }
          />
        </div>
        <div className={styles.cfgRow} style={{ flex: 1 }}>
          <label className={styles.cfgLabel}>Height (px / auto)</label>
          <input
            className={styles.cfgInput}
            value={config.height || 'auto'}
            onChange={(e) => onConfig({ ...config, height: e.target.value })}
            placeholder="auto"
          />
        </div>
      </div>
    </div>
  );
}

function DividerConfig({ config, onConfig }) {
  return (
    <div className={styles.blockCfg}>
      <div className={styles.inlineRow}>
        <div className={styles.cfgRow} style={{ flex: 1 }}>
          <label className={styles.cfgLabel}>Thickness (px)</label>
          <input
            type="number"
            className={styles.cfgInput}
            min={1}
            max={10}
            value={config.thickness || 1}
            onChange={(e) =>
              onConfig({ ...config, thickness: parseInt(e.target.value) || 1 })
            }
          />
        </div>
        <div className={styles.cfgRow} style={{ flex: 1 }}>
          <label className={styles.cfgLabel}>Color</label>
          <input
            type="color"
            className={styles.cfgColor}
            value={config.color || '#e2e8f0'}
            onChange={(e) => onConfig({ ...config, color: e.target.value })}
          />
        </div>
      </div>
    </div>
  );
}

function SpacerConfig({ config, onConfig }) {
  return (
    <div className={styles.blockCfg}>
      <div className={styles.cfgRow}>
        <label className={styles.cfgLabel}>Height (px)</label>
        <input
          type="number"
          className={styles.cfgInput}
          min={4}
          max={200}
          value={config.height || 24}
          onChange={(e) =>
            onConfig({ ...config, height: parseInt(e.target.value) || 24 })
          }
        />
      </div>
    </div>
  );
}

// ─── Style controls (text blocks) ────────────────────────────────────────────
function StyleControls({ style, onChange }) {
  const s = style || {};
  return (
    <div className={styles.styleControls}>
      <div className={styles.cfgRow}>
        <label className={styles.cfgLabel}>Font size</label>
        <input
          type="number"
          className={styles.cfgInput}
          min={8}
          max={72}
          value={s.fontSize || 13}
          onChange={(e) =>
            onChange({ ...s, fontSize: parseInt(e.target.value) || 13 })
          }
        />
      </div>
      <div className={styles.cfgRow}>
        <label className={styles.cfgLabel}>Color</label>
        <input
          type="color"
          className={styles.cfgColor}
          value={s.color || '#111827'}
          onChange={(e) => onChange({ ...s, color: e.target.value })}
        />
      </div>
      <div className={styles.cfgRow}>
        <label className={styles.cfgLabel}>Format</label>
        <div className={styles.formatBtns}>
          <button
            type="button"
            className={`${styles.fmtBtn} ${s.bold ? styles.fmtActive : ''}`}
            onClick={() => onChange({ ...s, bold: !s.bold })}
          >
            B
          </button>
          <button
            type="button"
            className={`${styles.fmtBtn} ${s.italic ? styles.fmtActive : ''}`}
            onClick={() => onChange({ ...s, italic: !s.italic })}
          >
            I
          </button>
        </div>
      </div>
      <div className={styles.cfgRow}>
        <label className={styles.cfgLabel}>Align</label>
        <div className={styles.formatBtns}>
          {['left', 'center', 'right'].map((a) => (
            <button
              key={a}
              type="button"
              className={`${styles.fmtBtn} ${s.align === a ? styles.fmtActive : ''}`}
              onClick={() => onChange({ ...s, align: a })}
            >
              {a === 'left' ? (
                <AlignLeft size={12} />
              ) : a === 'center' ? (
                <AlignCenter size={12} />
              ) : (
                <AlignRight size={12} />
              )}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.inlineRow}>
        <div className={styles.cfgRow} style={{ flex: 1 }}>
          <label className={styles.cfgLabel}>Margin top</label>
          <input
            type="number"
            className={styles.cfgInput}
            min={0}
            value={s.marginTop || 0}
            onChange={(e) =>
              onChange({ ...s, marginTop: parseInt(e.target.value) || 0 })
            }
          />
        </div>
        <div className={styles.cfgRow} style={{ flex: 1 }}>
          <label className={styles.cfgLabel}>Margin bottom</label>
          <input
            type="number"
            className={styles.cfgInput}
            min={0}
            value={s.marginBottom ?? 8}
            onChange={(e) =>
              onChange({ ...s, marginBottom: parseInt(e.target.value) || 0 })
            }
          />
        </div>
      </div>
    </div>
  );
}

// ─── Block preview (canvas representation) ───────────────────────────────────
function BlockPreview({ block, inputs }) {
  const { type, config, style } = block;
  const s = style || {};
  const textStyle = {
    fontSize: s.fontSize || 13,
    fontWeight: s.bold ? 700 : 400,
    fontStyle: s.italic ? 'italic' : 'normal',
    textAlign: s.align || 'left',
    color: s.color || '#111827',
    marginTop: s.marginTop || 0,
    marginBottom: s.marginBottom ?? 8,
  };

  if (type === 'text') {
    return (
      <div className={styles.previewText} style={textStyle}>
        {config.content || (
          <span className={styles.previewPlaceholder}>
            Empty text block — click to configure in panel →
          </span>
        )}
      </div>
    );
  }
  if (type === 'record_field') {
    const inp = inputs.find((i) => i.name === config.inputName);
    return (
      <div className={styles.previewField} style={textStyle}>
        {config.showLabel !== false && (
          <span className={styles.previewFieldLabel}>
            {config.label || config.fieldApiName || 'Field label'}:
          </span>
        )}
        <span
          className={styles.previewFieldValue}
        >{`{${config.inputName || 'input'}.${config.fieldApiName || 'field'}}`}</span>
      </div>
    );
  }
  if (type === 'datatable') {
    const inp = inputs.find((i) => i.name === config.inputName);
    return (
      <div className={styles.previewTable}>
        <div className={styles.previewTableHeader}>
          Data Table — {inp?.label || config.inputName || '(no input)'} (
          {(config.columns || []).length} columns)
        </div>
        {(config.columns || []).length > 0 ? (
          <table className={styles.previewTableEl}>
            <thead>
              <tr>
                {config.columns.map((c, i) => (
                  <th key={i}>{c.label || c.fieldApiName}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {config.columns.map((c, i) => (
                  <td
                    key={i}
                  >{`{${config.inputName || 'list'}[*].${c.fieldApiName}}`}</td>
                ))}
              </tr>
            </tbody>
          </table>
        ) : (
          <div className={styles.previewPlaceholder}>No columns defined</div>
        )}
      </div>
    );
  }
  if (type === 'image') {
    return (
      <div className={styles.previewImage}>
        <Image size={20} style={{ opacity: 0.3 }} />
        <span>
          {config.source === 'input'
            ? `{${config.inputName || 'image'}}`
            : config.url || 'No URL set'}
        </span>
        <span className={styles.previewPlaceholder}>
          {config.width}×{config.height}
        </span>
      </div>
    );
  }
  if (type === 'divider') {
    return (
      <hr
        className={styles.previewDivider}
        style={{
          borderTopWidth: config.thickness || 1,
          borderTopColor: config.color || '#e2e8f0',
        }}
      />
    );
  }
  if (type === 'page_break') {
    return (
      <div className={styles.previewPageBreak}>
        <Scissors size={12} /> Page Break
      </div>
    );
  }
  if (type === 'spacer') {
    return (
      <div
        className={styles.previewSpacer}
        style={{ height: config.height || 24 }}
      >
        <span>spacer {config.height || 24}px</span>
      </div>
    );
  }
  return null;
}

// ─── Inputs manager ───────────────────────────────────────────────────────────
function InputsManager({ inputs, onChange, objects }) {
  const add = () =>
    onChange([
      ...inputs,
      {
        name: `input${inputs.length + 1}`,
        label: `Input ${inputs.length + 1}`,
        type: 'record',
        objectApiName: '',
        required: true,
      },
    ]);
  const upd = (i, key, val) =>
    onChange(
      inputs.map((inp, idx) => (idx === i ? { ...inp, [key]: val } : inp)),
    );
  const del = (i) => onChange(inputs.filter((_, idx) => idx !== i));

  return (
    <div className={styles.inputsManager}>
      {inputs.map((inp, i) => (
        <div key={i} className={styles.inputRow}>
          <div className={styles.inputRowTop}>
            <input
              className={styles.cfgInput}
              value={inp.label}
              onChange={(e) => {
                upd(i, 'label', e.target.value);
                upd(i, 'name', slugify(e.target.value));
              }}
              placeholder="Label"
            />
            <select
              className={styles.cfgSelect}
              value={inp.type}
              onChange={(e) => upd(i, 'type', e.target.value)}
            >
              <option value="record">Record</option>
              <option value="collection">Collection (list)</option>
              <option value="text">Text</option>
              <option value="number">Number</option>
              <option value="date">Date</option>
              <option value="image">Image (URL)</option>
            </select>
            <button className={styles.delBtn} onClick={() => del(i)}>
              ×
            </button>
          </div>
          <div className={styles.inputRowMeta}>
            <span className={styles.inputApiName}>api: {inp.name}</span>
            {(inp.type === 'record' || inp.type === 'collection') && (
              <select
                className={styles.cfgSelectSmall}
                value={inp.objectApiName || ''}
                onChange={(e) => upd(i, 'objectApiName', e.target.value)}
              >
                <option value="">— Object type —</option>
                {objects.map((o) => (
                  <option key={o.apiName} value={o.apiName}>
                    {o.label}
                  </option>
                ))}
              </select>
            )}
            <label className={styles.requiredCheck}>
              <input
                type="checkbox"
                checked={inp.required !== false}
                onChange={(e) => upd(i, 'required', e.target.checked)}
              />
              Required
            </label>
          </div>
        </div>
      ))}
      <button className={styles.addBtn} onClick={add}>
        + Add input
      </button>
    </div>
  );
}

// ─── Main editor ──────────────────────────────────────────────────────────────
export default function PdfTemplateEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = !id || id === 'new';

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [objects, setObjects] = useState([]);

  const [name, setName] = useState('');
  const [apiName, setApiName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('General');
  const [isActive, setIsActive] = useState(true);
  const [pageSettings, setPageSettings] = useState({
    size: 'A4',
    orientation: 'portrait',
    marginTop: 40,
    marginRight: 40,
    marginBottom: 40,
    marginLeft: 40,
    headerHtml: '',
    footerHtml: '',
  });
  const [inputs, setInputs] = useState([]);
  const [blocks, setBlocks] = useState([]);

  const [selectedBlockId, setSelectedBlockId] = useState(null);
  const [rightPanel, setRightPanel] = useState('settings'); // 'settings' | 'inputs'
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [generateRecordId, setGenerateRecordId] = useState('');
  const rightPanelRef = useRef(null);
  const blockConfigRef = useRef(null);

  // Load objects and template
  useEffect(() => {
    api
      .get('/objects')
      .then((r) => setObjects(r.data.data || []))
      .catch(() => {});
    if (!isNew) {
      api
        .get(`/pdf-templates/${id}`)
        .then((r) => {
          const t = r.data.data;
          setName(t.name);
          setApiName(t.apiName);
          setDescription(t.description || '');
          setCategory(t.category || 'General');
          setIsActive(t.isActive !== false);
          setPageSettings(
            t.pageSettings || {
              size: 'A4',
              orientation: 'portrait',
              marginTop: 40,
              marginRight: 40,
              marginBottom: 40,
              marginLeft: 40,
            },
          );
          setInputs(t.inputs || []);
          setBlocks((t.blocks || []).sort((a, b) => a.order - b.order));
        })
        .catch(() => {
          toast.error('Template not found');
          navigate('/setup/pdf-templates');
        })
        .finally(() => setLoading(false));
    }
  }, [id]);

  const handleNameChange = (val) => {
    setName(val);
    if (isNew) setApiName(slugify(val));
  };

  const handleDragEnd = useCallback(
    (result) => {
      if (!result.destination) return;
      const reordered = Array.from(blocks);
      const [moved] = reordered.splice(result.source.index, 1);
      reordered.splice(result.destination.index, 0, moved);
      setBlocks(reordered.map((b, i) => ({ ...b, order: i })));
    },
    [blocks],
  );

  const addBlock = (type) => {
    const block = newBlock(type);
    block.order = blocks.length;
    setBlocks((prev) => [...prev, block]);
    setSelectedBlockId(block.id);
  };

  const deleteBlock = (blockId) => {
    setBlocks((prev) => prev.filter((b) => b.id !== blockId));
    if (selectedBlockId === blockId) setSelectedBlockId(null);
  };

  const updateBlock = (blockId, key, val) => {
    setBlocks((prev) =>
      prev.map((b) => (b.id === blockId ? { ...b, [key]: val } : b)),
    );
  };

  const selectedBlock = blocks.find((b) => b.id === selectedBlockId);

  // When a block is selected, switch to settings panel and scroll to config
  useLayoutEffect(() => {
    if (!selectedBlockId) return;
    setRightPanel('settings');
    const timer = setTimeout(() => {
      blockConfigRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 80);
    return () => clearTimeout(timer);
  }, [selectedBlockId]);

  const handleGenerate = () => {
    setGenerateRecordId('');
    setGenerateOpen(true);
  };

  const doGenerate = async () => {
    setGenerateOpen(false);
    try {
      const res = await api.get(`/pdf-templates/${id}/render`, {
        params: generateRecordId.trim() ? { recordId: generateRecordId.trim() } : {},
        responseType: 'blob',
      });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${apiName || 'document'}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('PDF generated and downloaded');
    } catch (err) {
      const msg = err?.response?.data?.message || 'PDF generation failed';
      toast.error(msg);
    }
  };
  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('Template name is required');
      return;
    }
    if (!apiName.trim()) {
      toast.error('API name is required');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name,
        apiName,
        description,
        category,
        isActive,
        pageSettings,
        inputs,
        blocks: blocks.map((b, i) => ({ ...b, order: i })),
      };
      if (isNew) {
        const res = await api.post('/pdf-templates', payload);
        toast.success('Template created');
        navigate(`/setup/pdf-templates/${res.data.data._id}`);
      } else {
        await api.put(`/pdf-templates/${id}`, payload);
        toast.success('Template saved');
      }
    } catch (err) {
      toast.error(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  // Generate PDF modal — rendered inside the editor
  const GenerateModal = generateOpen ? (
    <div className={styles.modalBackdrop} onClick={() => setGenerateOpen(false)}>
      <div className={styles.modalBox} onClick={e => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <span>Generate PDF</span>
          <button className={styles.modalClose} onClick={() => setGenerateOpen(false)}><X size={15} /></button>
        </div>
        <div className={styles.modalBody}>
          <p className={styles.modalHint}>
            Leave the record ID blank to generate a template preview with placeholder values.
            Enter a record ID to populate the PDF with real data.
          </p>
          <label className={styles.modalLabel}>Record ID <span className={styles.modalOpt}>(optional)</span></label>
          <input
            className={styles.modalInput}
            placeholder="e.g. 6b3a2f1e9c0d..."
            value={generateRecordId}
            onChange={e => setGenerateRecordId(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && doGenerate()}
            autoFocus
          />
        </div>
        <div className={styles.modalFooter}>
          <button className={styles.modalBtnSecondary} onClick={() => setGenerateOpen(false)}>Cancel</button>
          <button className={styles.modalBtnPrimary} onClick={doGenerate}>
            <FileText size={14} /> Generate PDF
          </button>
        </div>
      </div>
    </div>
  ) : null;

  if (loading)
    return (
      <Layout title="PDF Template">
        <div style={{ padding: 40, textAlign: 'center' }}>Loading…</div>
      </Layout>
    );

  return (
    <Layout
      title={isNew ? 'New PDF Template' : name}
      description="Drag-and-drop PDF document builder"
    >
      <div className={styles.editorPage}>
        {/* Top bar */}
        <div className={styles.topBar}>
          <div className={styles.topBarLeft}>
            <Link to="/setup/pdf-templates" className={styles.backBtn}>
              <ArrowLeft size={16} />
            </Link>
            <div className={styles.templateTitle}>
              <input
                className={styles.nameInput}
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="Template name…"
              />
              <input
                className={styles.apiNameInput}
                value={apiName}
                onChange={(e) => setApiName(e.target.value)}
                placeholder="api_name"
              />
            </div>
          </div>
          <div className={styles.topBarRight}>
            <button
              className={`${styles.tabBtn} ${rightPanel === 'settings' ? styles.tabActive : ''}`}
              onClick={() => setRightPanel('settings')}
            >
              <Settings2 size={14} /> Settings
            </button>
            <button
              className={`${styles.tabBtn} ${rightPanel === 'inputs' ? styles.tabActive : ''}`}
              onClick={() => setRightPanel('inputs')}
            >
              <FileText size={14} /> Inputs
            </button>
            <Button
              icon={<Save size={14} />}
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save'}
            </Button>
            <Button
              icon={<FileText size={14} />}
              onClick={handleGenerate}
              variant="secondary"
            >
              Generate PDF
            </Button>
          </div>
        </div>

        <div className={styles.editorBody}>
          {/* Left palette */}
          <div className={styles.palette}>
            <div className={styles.paletteTitle}>Blocks</div>
            {Object.entries(BLOCK_TYPES).map(([type, def]) => (
              <button
                key={type}
                className={styles.paletteItem}
                onClick={() => addBlock(type)}
                title={`Add ${def.label}`}
              >
                <span
                  className={styles.paletteIcon}
                  style={{ color: def.color }}
                >
                  {def.icon}
                </span>
                <span className={styles.paletteLabel}>{def.label}</span>
                <Plus size={12} className={styles.paletteAdd} />
              </button>
            ))}
          </div>

          {/* Canvas */}
          <div className={styles.canvasWrap}>
            <div
              className={styles.canvasPage}
              style={{
                padding: `${pageSettings.marginTop}px ${pageSettings.marginRight}px ${pageSettings.marginBottom}px ${pageSettings.marginLeft}px`,
              }}
            >
              {blocks.length === 0 && (
                <div className={styles.canvasEmpty}>
                  <FileText size={32} style={{ opacity: 0.2 }} />
                  <p>Click a block type on the left to add content</p>
                </div>
              )}
              <DragDropContext onDragEnd={handleDragEnd}>
                <Droppable droppableId="canvas">
                  {(provided) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className={styles.droppable}
                    >
                      {blocks.map((block, index) => (
                        <Draggable
                          key={block.id}
                          draggableId={block.id}
                          index={index}
                        >
                          {(drag, snapshot) => (
                            <div
                              ref={drag.innerRef}
                              {...drag.draggableProps}
                              {...drag.dragHandleProps}
                              className={`${styles.blockWrap} ${selectedBlockId === block.id ? styles.blockSelected : ''} ${snapshot.isDragging ? styles.blockDragging : ''}`}
                              onClick={() => setSelectedBlockId(block.id)}
                            >
                              <div className={styles.dragHandle}>
                                <GripVertical size={14} />
                              </div>
                              <div className={styles.blockContent}>
                                <BlockPreview block={block} inputs={inputs} />
                              </div>
                              <button
                                className={styles.blockDelete}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  deleteBlock(block.id);
                                }}
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </DragDropContext>
            </div>
          </div>

          {/* Right panel */}
          <div className={styles.rightPanel} ref={rightPanelRef}>
            {rightPanel === 'settings' && (
              <div className={styles.panelSection}>
                <div className={styles.panelTitle}>Template settings</div>

                <div className={styles.cfgRow}>
                  <label className={styles.cfgLabel}>Description</label>
                  <input
                    className={styles.cfgInput}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Optional description"
                  />
                </div>
                <div className={styles.cfgRow}>
                  <label className={styles.cfgLabel}>Category</label>
                  <input
                    className={styles.cfgInput}
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    placeholder="General"
                  />
                </div>
                <div className={styles.cfgRow}>
                  <label className={styles.cfgLabel}>Active</label>
                  <input
                    type="checkbox"
                    checked={isActive}
                    onChange={(e) => setIsActive(e.target.checked)}
                  />
                </div>

                <div className={styles.sectionDivider} />
                <div className={styles.panelSubtitle}>Page</div>
                <div className={styles.cfgRow}>
                  <label className={styles.cfgLabel}>Size</label>
                  <select
                    className={styles.cfgSelect}
                    value={pageSettings.size || 'A4'}
                    onChange={(e) =>
                      setPageSettings((p) => ({ ...p, size: e.target.value }))
                    }
                  >
                    <option value="A4">A4</option>
                    <option value="Letter">Letter</option>
                    <option value="Legal">Legal</option>
                  </select>
                </div>
                <div className={styles.cfgRow}>
                  <label className={styles.cfgLabel}>Orientation</label>
                  <select
                    className={styles.cfgSelect}
                    value={pageSettings.orientation || 'portrait'}
                    onChange={(e) =>
                      setPageSettings((p) => ({
                        ...p,
                        orientation: e.target.value,
                      }))
                    }
                  >
                    <option value="portrait">Portrait</option>
                    <option value="landscape">Landscape</option>
                  </select>
                </div>
                <div className={styles.inlineRow}>
                  {[
                    'marginTop',
                    'marginRight',
                    'marginBottom',
                    'marginLeft',
                  ].map((m) => (
                    <div key={m} className={styles.cfgRow} style={{ flex: 1 }}>
                      <label className={styles.cfgLabel}>
                        {m.replace('margin', '')}
                      </label>
                      <input
                        type="number"
                        className={styles.cfgInput}
                        min={0}
                        value={pageSettings[m] ?? 40}
                        onChange={(e) =>
                          setPageSettings((p) => ({
                            ...p,
                            [m]: parseInt(e.target.value) || 0,
                          }))
                        }
                      />
                    </div>
                  ))}
                </div>

                <div className={styles.sectionDivider} />
                <div className={styles.panelSubtitle}>Header HTML</div>
                <textarea
                  className={styles.cfgTextarea}
                  rows={3}
                  value={pageSettings.headerHtml || ''}
                  onChange={(e) =>
                    setPageSettings((p) => ({
                      ...p,
                      headerHtml: e.target.value,
                    }))
                  }
                  placeholder="Optional HTML shown at top of every page"
                />

                <div className={styles.panelSubtitle} style={{ marginTop: 8 }}>
                  Footer HTML
                </div>
                <textarea
                  className={styles.cfgTextarea}
                  rows={3}
                  value={pageSettings.footerHtml || ''}
                  onChange={(e) =>
                    setPageSettings((p) => ({
                      ...p,
                      footerHtml: e.target.value,
                    }))
                  }
                  placeholder="Optional HTML shown at bottom — use {pageNumber} / {totalPages}"
                />

                {selectedBlock && (
                  <>
                    <div className={styles.sectionDivider} ref={blockConfigRef} />
                    <div className={styles.panelTitle}>
                      {BLOCK_TYPES[selectedBlock.type]?.label ||
                        selectedBlock.type}
                      <button
                        className={styles.deselectBtn}
                        onClick={() => setSelectedBlockId(null)}
                      >
                        <X size={12} />
                      </button>
                    </div>
                    {selectedBlock.type === 'text' && (
                      <TextBlockConfig
                        config={selectedBlock.config}
                        style={selectedBlock.style}
                        onConfig={(v) =>
                          updateBlock(selectedBlock.id, 'config', v)
                        }
                        onStyle={(v) =>
                          updateBlock(selectedBlock.id, 'style', v)
                        }
                        inputs={inputs}
                      />
                    )}
                    {selectedBlock.type === 'record_field' && (
                      <RecordFieldConfig
                        config={selectedBlock.config}
                        style={selectedBlock.style}
                        onConfig={(v) =>
                          updateBlock(selectedBlock.id, 'config', v)
                        }
                        onStyle={(v) =>
                          updateBlock(selectedBlock.id, 'style', v)
                        }
                        inputs={inputs}
                      />
                    )}
                    {selectedBlock.type === 'datatable' && (
                      <DatatableConfig
                        config={selectedBlock.config}
                        onConfig={(v) =>
                          updateBlock(selectedBlock.id, 'config', v)
                        }
                        inputs={inputs}
                      />
                    )}
                    {selectedBlock.type === 'image' && (
                      <ImageBlockConfig
                        config={selectedBlock.config}
                        onConfig={(v) =>
                          updateBlock(selectedBlock.id, 'config', v)
                        }
                        inputs={inputs}
                      />
                    )}
                    {selectedBlock.type === 'divider' && (
                      <DividerConfig
                        config={selectedBlock.config}
                        onConfig={(v) =>
                          updateBlock(selectedBlock.id, 'config', v)
                        }
                      />
                    )}
                    {selectedBlock.type === 'spacer' && (
                      <SpacerConfig
                        config={selectedBlock.config}
                        onConfig={(v) =>
                          updateBlock(selectedBlock.id, 'config', v)
                        }
                      />
                    )}
                  </>
                )}
              </div>
            )}

            {rightPanel === 'inputs' && (
              <div className={styles.panelSection}>
                <div className={styles.panelTitle}>Template inputs</div>
                <p className={styles.panelHint}>
                  Define what data the flow must provide. Record and Collection
                  inputs expose merge fields for blocks.
                </p>
                <InputsManager
                  inputs={inputs}
                  onChange={setInputs}
                  objects={objects}
                />
              </div>
            )}
          </div>
        </div>
      </div>
      {GenerateModal}
    </Layout>
  );
}
