import React, {
  useEffect,
  useState,
  useCallback,
  useRef,
  useMemo,
} from 'react';
import { createPortal } from 'react-dom';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Save,
  Plus,
  Trash2,
  ChevronDown,
  ChevronUp,
  Zap,
  Bell,
  Globe,
  Edit3,
  Clock,
  Database,
  Filter,
  Mail,
  ArrowRight,
  CheckCircle,
  Settings,
  Monitor,
  Search,
  GitBranch,
  Repeat,
  Hash,
  Shuffle,
  ArrowUpDown,
  Share2,
  PauseCircle,
  Variable,
  SortAsc,
  Play,
  Navigation,
  FileText,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../services/api';
import { useTenantContext } from '../../context/TenantContext';
import Button from '../../components/common/Button/Button';
import Layout from '../../layout/Layout';

// ─── Shared primitives (used by inline configs below) ──────────────────────────
import {
  Inp,
  Sel,
  Row,
  KvEditor,
  FieldMapping,
  MergeInput,
  ConditionBuilder,
  genId,
} from './Elements/shared.jsx';

// ─── Element configs ─────────────────────────────────────────────────────────
import DecisionElement from './Elements/DecisionElement.jsx';
import AssignmentElement from './Elements/AssignmentElement.jsx';
import LoopElement from './Elements/LoopElement.jsx';
import FormulaElement from './Elements/FormulaElement.jsx';
import TransformElement from './Elements/TransformElement.jsx';
import CollectionFilterElement from './Elements/CollectionFilterElement.jsx';
import CollectionSortElement from './Elements/CollectionSortElement.jsx';
import DeleteRecordsElement from './Elements/DeleteRecordsElement.jsx';
import SubflowElement from './Elements/SubflowElement.jsx';
import PauseElement from './Elements/PauseElement.jsx';
import ScreenElement from './Elements/ScreenElement.jsx';
import NavigateElement from './Elements/NavigateElement.jsx';
import GeneratePdfElement from './Elements/GeneratePdfElement.jsx';
import UpdateRelatedRecordsElement from './Elements/UpdateRelatedRecordsElement.jsx';

// ─── Variables panel ──────────────────────────────────────────────────────────
import VariablesPanel from './Variables/VariablesPanel.jsx';

// ─── Scheduled path card ─────────────────────────────────────────────────────
import ScheduledPathCard from './Elements/ScheduledPathCard.jsx';

// ─── Flow type selector (shown when creating a new flow) ─────────────────────
import FlowTypeSelector from './FlowTypeSelector.jsx';

// ─── Debug / test panel ───────────────────────────────────────────────────────
import FlowDebugPanel from './FlowDebugPanel.jsx';

import styles from './FlowBuilder.module.css';

// ─── Step type registry ───────────────────────────────────────────────────────
const STEP_TYPES = {
  // Logic
  decision: {
    label: 'Decision',
    icon: <GitBranch size={16} />,
    color: '#7c3aed',
    group: 'Logic',
  },
  assignment: {
    label: 'Assignment',
    icon: <Variable size={16} />,
    color: '#059669',
    group: 'Logic',
  },
  loop: {
    label: 'Loop',
    icon: <Repeat size={16} />,
    color: '#b45309',
    group: 'Logic',
  },
  formula: {
    label: 'Formula',
    icon: <Hash size={16} />,
    color: '#0284c7',
    group: 'Logic',
  },
  condition: {
    label: 'Condition / Filter',
    icon: <Filter size={16} />,
    color: '#3b82f6',
    group: 'Logic',
  },
  action_wait: {
    label: 'Wait / Delay',
    icon: <Clock size={16} />,
    color: '#64748b',
    group: 'Logic',
  },
  pause: {
    label: 'Pause',
    icon: <PauseCircle size={16} />,
    color: '#64748b',
    group: 'Logic',
  },
  // Data
  get_records: {
    label: 'Get Records',
    icon: <Search size={16} />,
    color: '#0891b2',
    group: 'Data',
  },
  transform: {
    label: 'Transform Data',
    icon: <Shuffle size={16} />,
    color: '#7c3aed',
    group: 'Data',
  },
  collection_filter: {
    label: 'Collection Filter',
    icon: <Filter size={16} />,
    color: '#2563eb',
    group: 'Data',
  },
  collection_sort: {
    label: 'Collection Sort',
    icon: <ArrowUpDown size={16} />,
    color: '#2563eb',
    group: 'Data',
  },
  // Records
  action_update_record: {
    label: 'Update Record',
    icon: <Edit3 size={16} />,
    color: '#10b981',
    group: 'Record',
  },
  action_update_related_records: {
    label: 'Update Related Records',
    icon: <Share2 size={16} />,
    color: '#10b981',
    group: 'Record',
  },
  action_create_record: {
    label: 'Create Record',
    icon: <Database size={16} />,
    color: '#6366f1',
    group: 'Record',
  },
  delete_records: {
    label: 'Delete Records',
    icon: <Trash2 size={16} />,
    color: '#dc2626',
    group: 'Record',
  },
  // Actions
  action_send_notification: {
    label: 'Send Notification',
    icon: <Bell size={16} />,
    color: '#8b5cf6',
    group: 'Actions',
  },
  action_send_email: {
    label: 'Send Email',
    icon: <Mail size={16} />,
    color: '#0ea5e9',
    group: 'Actions',
  },
  action_http_request: {
    label: 'HTTP Request',
    icon: <Globe size={16} />,
    color: '#f59e0b',
    group: 'Actions',
  },
  action_toast: {
    label: 'Show Toast',
    icon: <Bell size={16} />,
    color: '#f59e0b',
    group: 'Actions',
  },
  action_generate_pdf: {
    label: 'Generate PDF',
    icon: <FileText size={16} />,
    color: '#dc2626',
    group: 'Actions',
  },
  // Advanced
  subflow: {
    label: 'Subflow',
    icon: <Share2 size={16} />,
    color: '#0ea5e9',
    group: 'Advanced',
  },
  // Screen
  screen: {
    label: 'Screen',
    icon: <Monitor size={16} />,
    color: '#ec4899',
    group: 'Screen',
  },
  navigate: {
    label: 'Navigate',
    icon: <Navigation size={16} />,
    color: '#f97316',
    group: 'Actions',
  },
};

// Steps excluded per flow type
const EXCLUDED_STEPS = {
  record_triggered: ['screen', 'pause'],
  scheduled: ['screen', 'pause', 'navigate'],
  screen_flow: [],
};

// ─── Inline element configs (kept here — simpler ones) ────────────────────────

function ConditionConfig({ config, onChange, fields }) {
  return (
    <div className={styles.cfgSection}>
      <ConditionBuilder
        conditions={config.conditions || []}
        logic={config.logic}
        onLogicChange={(v) => onChange({ ...config, logic: v })}
        onChange={(v) => onChange({ ...config, conditions: v })}
        fields={fields}
      />
    </div>
  );
}

function GetRecordsConfig({
  config,
  onChange,
  objects,
  variables,
  triggerFields = [],
}) {
  const [objFields, setObjFields] = useState([]);
  useEffect(() => {
    if (!config.objectApiName) {
      setObjFields([]);
      return;
    }
    api
      .get(`/objects/${config.objectApiName}`)
      .then((r) =>
        setObjFields(
          (r.data.data?.fields || []).sort(
            (a, b) => a.displayOrder - b.displayOrder,
          ),
        ),
      )
      .catch(() => {});
  }, [config.objectApiName]);

  const sortDir = (config.sort || '-createdAt').startsWith('-')
    ? 'desc'
    : 'asc';
  const sortField = (config.sort || 'createdAt').replace(/^-/, '');

  const varOptions = variables.map((v) => ({
    value: v.name,
    label: `${v.label || v.name}`,
  }));

  return (
    <div className={styles.cfgSection}>
      <Row label="Object">
        <Sel
          value={config.objectApiName || ''}
          onChange={(v) =>
            onChange({ ...config, objectApiName: v, filters: [] })
          }
          placeholder="— Select object —"
          options={objects.map((o) => ({ value: o.apiName, label: o.label }))}
        />
      </Row>
      <Row
        label="Filters"
        hint="Use {id} or {fieldName} to reference the trigger record"
      >
        <ConditionBuilder
          conditions={config.filters || []}
          fields={objFields}
          onChange={(v) => onChange({ ...config, filters: v })}
          triggerFields={triggerFields}
          variables={variables}
        />
      </Row>
      <Row label="Sort by">
        <div className={styles.inlineRow}>
          <Sel
            value={sortField}
            onChange={(v) =>
              onChange({ ...config, sort: (sortDir === 'desc' ? '-' : '') + v })
            }
            placeholder="Sort field"
            options={[
              { value: 'createdAt', label: 'Created At' },
              { value: 'updatedAt', label: 'Updated At' },
              ...objFields.map((f) => ({ value: f.apiName, label: f.label })),
            ]}
          />
          <Sel
            value={sortDir}
            onChange={(v) =>
              onChange({
                ...config,
                sort: (v === 'desc' ? '-' : '') + sortField,
              })
            }
            options={[
              { value: 'desc', label: 'Newest first' },
              { value: 'asc', label: 'Oldest first' },
            ]}
          />
        </div>
      </Row>
      <Row label="Max records">
        <Inp
          type="number"
          value={config.limit || 10}
          onChange={(v) => onChange({ ...config, limit: parseInt(v) || 10 })}
        />
      </Row>
      <Row label="Store as variable" hint="Use {$variableName} in later steps">
        {varOptions.length > 0 ? (
          <div className={styles.inlineRow}>
            <Sel
              value={config.variableName || ''}
              onChange={(v) => onChange({ ...config, variableName: v })}
              placeholder="— Select or type variable name —"
              options={varOptions}
            />
            <Inp
              value={config.variableName || ''}
              onChange={(v) => onChange({ ...config, variableName: v })}
              placeholder="or type name"
            />
          </div>
        ) : (
          <Inp
            value={config.variableName || ''}
            onChange={(v) => onChange({ ...config, variableName: v })}
            placeholder="e.g. contacts"
          />
        )}
      </Row>
    </div>
  );
}

function UpdateRecordConfig({
  config,
  onChange,
  fields,
  variables = [],
  outputVariables = [],
  recordPageFields = [],
}) {
  const recordMode = config.recordMode || 'trigger';
  return (
    <div className={styles.cfgSection}>
      <Row label="Which record to update">
        <Sel
          value={recordMode}
          onChange={(v) => onChange({ ...config, recordMode: v, recordId: '' })}
          options={[
            { value: 'trigger', label: 'Triggering record' },
            { value: 'variable', label: 'Record from a variable' },
            { value: 'id', label: 'Record ID (value / merge field)' },
          ]}
        />
      </Row>
      {recordMode === 'variable' && (
        <Row label="Variable" hint="Must contain a record with an _id field">
          <Sel
            value={config.recordVariable || ''}
            onChange={(v) => onChange({ ...config, recordVariable: v })}
            placeholder="— Select variable —"
            options={variables.map((v) => ({
              value: v.name,
              label: v.label || v.name,
            }))}
          />
        </Row>
      )}
      {recordMode === 'id' && (
        <Row
          label="Record ID"
          hint="Use {_id} for the trigger record or {$varName._id} for a variable"
        >
          <Inp
            value={config.recordId || ''}
            onChange={(v) => onChange({ ...config, recordId: v })}
            placeholder="e.g. {_id} or {$newContact._id}"
          />
        </Row>
      )}
      <Row
        label="Fields to update"
        hint="Use {field_name} to copy a value from the trigger record"
      >
        <FieldMapping
          externalFields={fields}
          mapping={config.fields || {}}
          onChange={(m) => onChange({ ...config, fields: m })}
          fields={fields}
          variables={variables}
          outputVariables={outputVariables}
          recordPageFields={recordPageFields}
        />
      </Row>
    </div>
  );
}

function CreateRecordConfig({
  config,
  onChange,
  objects,
  fields = [],
  variables = [],
  outputVariables = [],
  recordPageFields = [],
}) {
  return (
    <div className={styles.cfgSection}>
      <Row label="Object">
        <Sel
          value={config.objectApiName || ''}
          onChange={(v) =>
            onChange({ ...config, objectApiName: v, fields: {} })
          }
          placeholder="— Select object —"
          options={objects.map((o) => ({ value: o.apiName, label: o.label }))}
        />
      </Row>
      {config.objectApiName && (
        <Row
          label="Field values"
          hint="Use {field_name} to reference trigger record values"
        >
          <FieldMapping
            objectApiName={config.objectApiName}
            mapping={config.fields || {}}
            onChange={(m) => onChange({ ...config, fields: m })}
            fields={fields}
            variables={variables}
            outputVariables={outputVariables}
            recordPageFields={recordPageFields}
          />
        </Row>
      )}
      <Row
        label="Store result as variable"
        hint="Saves the created record (with _id) — use {$varName} in later steps"
      >
        <Inp
          value={config.outputVariable || ''}
          onChange={(v) => onChange({ ...config, outputVariable: v })}
          placeholder="e.g. newContact (optional)"
        />
      </Row>
    </div>
  );
}

function NotificationConfig({
  config,
  onChange,
  fields,
  relatedFields = {},
  variables = [],
}) {
  const userLookupFields = fields.filter(
    (f) =>
      f.type === 'lookup' &&
      (f.lookupObjectApiName === 'user' || f.lookupObjectApiName === 'users'),
  );
  // Variables that could hold a user ID or array of user IDs
  const userVars = variables.filter(
    (v) =>
      ['Text', 'Record', 'Record Collection'].includes(v.dataType) ||
      !v.dataType,
  );
  return (
    <div className={styles.cfgSection}>
      <Row label="Recipient">
        <Sel
          value={config.recipientType || 'owner'}
          onChange={(v) => onChange({ ...config, recipientType: v })}
          options={[
            { value: 'owner', label: 'Record owner' },
            { value: 'creator', label: 'Record creator' },
            { value: 'field', label: 'User from lookup field' },
            { value: 'variable', label: 'Variable (user ID or ID array)' },
          ]}
        />
      </Row>
      {config.recipientType === 'field' && (
        <Row label="User lookup field">
          {userLookupFields.length > 0 ? (
            <Sel
              value={config.recipientField || ''}
              onChange={(v) => onChange({ ...config, recipientField: v })}
              placeholder="— Select user lookup field —"
              options={userLookupFields.map((f) => ({
                value: f.apiName,
                label: f.label,
              }))}
            />
          ) : (
            <p
              className={styles.cfgHint}
              style={{ color: '#d97706', fontStyle: 'italic' }}
            >
              No user lookup fields on this object.
            </p>
          )}
        </Row>
      )}
      {config.recipientType === 'variable' && (
        <Row
          label="Variable"
          hint="A variable holding a user _id string, or an array of user _id strings"
        >
          {userVars.length > 0 ? (
            <Sel
              value={config.recipientVariable || ''}
              onChange={(v) => onChange({ ...config, recipientVariable: v })}
              placeholder="— Select variable —"
              options={userVars.map((v) => ({
                value: v.name,
                label: `${v.label || v.name} (${v.dataType || 'Text'})`,
              }))}
            />
          ) : (
            <p
              className={styles.cfgHint}
              style={{ color: '#d97706', fontStyle: 'italic' }}
            >
              No variables available. Add a variable in the Variables panel.
            </p>
          )}
        </Row>
      )}
      <Row label="Title" hint="Supports {field_name} merge fields">
        <MergeInput
          value={config.title}
          onChange={(v) => onChange({ ...config, title: v })}
          placeholder="Notification title"
          fields={fields}
          relatedFields={relatedFields}
          variables={variables}
        />
      </Row>
      <Row label="Message" hint="Supports {field_name} merge fields">
        <MergeInput
          value={config.body}
          rows={2}
          onChange={(v) => onChange({ ...config, body: v })}
          placeholder="Notification message"
          fields={fields}
          relatedFields={relatedFields}
          variables={variables}
        />
      </Row>
    </div>
  );
}

function EmailConfig({ config, onChange, fields, relatedFields = {} }) {
  const [templates, setTemplates] = useState([]);
  useEffect(() => {
    api
      .get('/email-templates', { params: { active: true } })
      .then((r) => setTemplates(r.data.data || []))
      .catch(() => {});
  }, []);

  const applyTemplate = async (templateId) => {
    if (!templateId) return;
    try {
      const res = await api.get(`/email-templates/${templateId}`);
      const t = res.data.data;
      onChange({
        ...config,
        templateId,
        subject: t.subject,
        body: t.bodyText || t.bodyHtml || '',
      });
    } catch {}
  };

  const emailFields = fields.filter((f) => f.type === 'email');
  const toMode = config.toMode || 'custom';

  return (
    <div className={styles.cfgSection}>
      {templates.length > 0 && (
        <Row label="Use template">
          <Sel
            value={config.templateId || ''}
            onChange={applyTemplate}
            placeholder="— Select a template (optional) —"
            options={templates.map((t) => ({
              value: t._id,
              label: `${t.category} › ${t.name}`,
            }))}
          />
        </Row>
      )}
      <Row label="To — recipient">
        <div className={styles.inlineRow}>
          <Sel
            value={toMode}
            onChange={(v) =>
              onChange({ ...config, toMode: v, to: '', toField: '' })
            }
            options={[
              { value: 'custom', label: 'Custom / variable' },
              { value: 'field', label: 'Email field on record' },
            ]}
          />
          {toMode === 'field' ? (
            <Sel
              value={config.toField || ''}
              onChange={(v) => onChange({ ...config, toField: v })}
              placeholder="— Select email field —"
              options={emailFields.map((f) => ({
                value: f.apiName,
                label: f.label,
              }))}
            />
          ) : (
            <Inp
              value={config.to}
              onChange={(v) => onChange({ ...config, to: v })}
              placeholder="{email} or static@example.com"
            />
          )}
        </div>
      </Row>
      <Row label="Subject">
        <MergeInput
          value={config.subject}
          onChange={(v) => onChange({ ...config, subject: v })}
          placeholder="e.g. Updated: {name}"
          fields={fields}
          relatedFields={relatedFields}
        />
      </Row>
      <Row label="Body">
        <MergeInput
          value={config.body}
          rows={5}
          onChange={(v) => onChange({ ...config, body: v })}
          placeholder="Email body"
          fields={fields}
          relatedFields={relatedFields}
        />
      </Row>
    </div>
  );
}

function HttpRequestConfig({ config, onChange, externalObjects }) {
  const headerPairs = Object.entries(config.headers || {}).map(
    ([key, value]) => ({ key, value }),
  );
  const responseMaps = config.responseMapping || [];
  const setHeaders = (pairs) =>
    onChange({
      ...config,
      headers: Object.fromEntries(
        pairs.filter((p) => p.key).map((p) => [p.key, p.value]),
      ),
    });
  const setRespMaps = (maps) => onChange({ ...config, responseMapping: maps });
  const method = (config.method || 'POST').toUpperCase();

  return (
    <div className={styles.cfgSection}>
      <Row label="External object">
        <Sel
          value={config.externalObjectId || ''}
          onChange={(v) =>
            onChange({ ...config, externalObjectId: v || undefined })
          }
          placeholder="— None (use full URL) —"
          options={externalObjects.map((e) => ({
            value: e._id,
            label: e.name,
          }))}
        />
      </Row>
      <Row label="Method">
        <Sel
          value={method}
          onChange={(v) => onChange({ ...config, method: v })}
          options={['GET', 'POST', 'PUT', 'PATCH', 'DELETE']}
        />
      </Row>
      <Row label="URL / Path">
        <Inp
          value={config.url}
          onChange={(v) => onChange({ ...config, url: v })}
          placeholder="https://... or /api/endpoint"
        />
      </Row>
      <Row label="Request headers">
        <KvEditor
          pairs={headerPairs}
          onChange={setHeaders}
          keyPlaceholder="Header name"
          valPlaceholder="Header value"
        />
      </Row>
      {!['GET', 'HEAD', 'DELETE'].includes(method) && (
        <Row label="Request body (JSON)">
          <textarea
            className={styles.inp}
            rows={4}
            value={config.body || ''}
            onChange={(e) => onChange({ ...config, body: e.target.value })}
            placeholder={'{\n  "id": "{id}",\n  "name": "{name}"\n}'}
          />
        </Row>
      )}
      <Row label="Save response → variables">
        <KvEditor
          pairs={responseMaps.map((r) => ({ key: r.variable, value: r.path }))}
          onChange={(pairs) =>
            setRespMaps(pairs.map((p) => ({ variable: p.key, path: p.value })))
          }
          keyPlaceholder="Variable name (e.g. leadId)"
          valPlaceholder="JSON path (e.g. data.id)"
        />
      </Row>
      <Row label="Timeout (ms)">
        <Inp
          type="number"
          value={config.timeout || 10000}
          onChange={(v) =>
            onChange({ ...config, timeout: parseInt(v) || 10000 })
          }
        />
      </Row>
    </div>
  );
}

function WaitConfig({ config, onChange }) {
  return (
    <div className={styles.cfgSection}>
      <Row label="Wait duration">
        <div className={styles.inlineRow}>
          <Inp
            type="number"
            value={config.amount || 1}
            onChange={(v) => onChange({ ...config, amount: parseInt(v) || 1 })}
          />
          <Sel
            value={config.unit || 'minutes'}
            onChange={(v) => onChange({ ...config, unit: v })}
            options={['seconds', 'minutes', 'hours', 'days']}
          />
        </div>
      </Row>
    </div>
  );
}

function ToastConfig({ config, onChange, fields, relatedFields = {} }) {
  return (
    <div className={styles.cfgSection}>
      <Row label="Message">
        <MergeInput
          value={config.message}
          onChange={(v) => onChange({ ...config, message: v })}
          placeholder="e.g. Record {name} was processed"
          fields={fields}
          relatedFields={relatedFields}
        />
      </Row>
      <Row label="Type">
        <Sel
          value={config.type || 'success'}
          onChange={(v) => onChange({ ...config, type: v })}
          options={[
            { value: 'success', label: '✓ Success' },
            { value: 'error', label: '✗ Error' },
            { value: 'info', label: 'ℹ Info' },
            { value: 'warning', label: '⚠ Warning' },
          ]}
        />
      </Row>
      <Row label="Duration (ms)">
        <Inp
          type="number"
          value={config.duration || 3000}
          onChange={(v) =>
            onChange({ ...config, duration: parseInt(v) || 3000 })
          }
        />
      </Row>
    </div>
  );
}

function ScreenConfig({
  config,
  onChange,
  fields,
  objects,
  variables,
  outputVariables,
  recordPageFields,
}) {
  return (
    <ScreenElement
      config={config}
      onChange={onChange}
      fields={fields}
      objects={objects}
      variables={variables}
      outputVariables={outputVariables}
      recordPageFields={recordPageFields}
    />
  );
}

// ─── Nested step list (for Decision & Loop) ───────────────────────────────────
function NestedStepList({
  steps,
  onChange,
  depth = 1,
  ancestorTypes = new Set(),
  ...cardProps
}) {
  // Prevent nested loops and nested decisions
  const filteredTypes = (
    cardProps.availableTypes || Object.keys(STEP_TYPES)
  ).filter((t) => {
    if (t === 'loop' && ancestorTypes.has('loop')) return false;
    if (t === 'decision' && ancestorTypes.has('decision')) return false;
    return true;
  });

  const addStep = (type, afterIdx) => {
    const newStep = {
      id: genId(),
      type,
      label: STEP_TYPES[type]?.label || type,
      config: {},
      _new: true,
    };
    const inserted = [
      ...steps.slice(0, afterIdx + 1),
      newStep,
      ...steps.slice(afterIdx + 1),
    ];
    onChange(inserted);
  };
  const updStep = (i, upd) =>
    onChange(steps.map((s, idx) => (idx === i ? upd : s)));
  const delStep = (i) => onChange(steps.filter((_, idx) => idx !== i));
  const movStep = (i, dir) => {
    const ni = i + dir;
    if (ni < 0 || ni >= steps.length) return;
    const n = [...steps];
    [n[i], n[ni]] = [n[ni], n[i]];
    onChange(n);
  };

  return (
    <div>
      {steps.length === 0 && (
        <AddStepMenu
          onAdd={(type) => addStep(type, -1)}
          availableTypes={filteredTypes}
          compact
        />
      )}
      {steps.map((step, i) => (
        <React.Fragment key={step.id}>
          <StepCard
            step={step}
            index={i}
            totalSteps={steps.length}
            depth={depth}
            ancestorTypes={ancestorTypes}
            onChange={(upd) => updStep(i, upd)}
            onDelete={() => delStep(i)}
            onMove={(_, dir) => movStep(i, dir)}
            {...cardProps}
            availableTypes={filteredTypes}
          />
          <AddStepMenu
            onAdd={(type) => addStep(type, i)}
            availableTypes={filteredTypes}
            compact
          />
        </React.Fragment>
      ))}
    </div>
  );
}

// ─── Step card ────────────────────────────────────────────────────────────────
function StepCard({
  step,
  index,
  totalSteps,
  depth = 0,
  fields,
  objects,
  externalObjects,
  variables,
  relatedFields = {},
  availableTypes,
  outputVariables = [],
  recordPageFields = [],
  flowType,
  ancestorTypes = new Set(),
  onChange,
  onDelete,
  onMove,
}) {
  const [expanded, setExpanded] = useState(!!step._new);
  const meta = STEP_TYPES[step.type] || {
    label: step.type,
    color: '#6366f1',
    icon: <Zap size={16} />,
  };
  const setConfig = useCallback(
    (cfg) => onChange({ ...step, config: cfg }),
    [step, onChange],
  );

  // Propagate ancestor nesting context so children can block further nesting
  const childAncestors = useMemo(() => {
    const next = new Set(ancestorTypes);
    if (step.type === 'loop' || step.type === 'decision') next.add(step.type);
    return next;
  }, [ancestorTypes, step.type]);

  // Build the renderStepList function for nested elements
  const renderStepList = useCallback(
    (nestedSteps, onNestedChange) => (
      <NestedStepList
        steps={nestedSteps}
        onChange={onNestedChange}
        depth={depth + 1}
        ancestorTypes={childAncestors}
        fields={fields}
        objects={objects}
        externalObjects={externalObjects}
        variables={variables}
        relatedFields={relatedFields}
        availableTypes={availableTypes}
        outputVariables={outputVariables}
        recordPageFields={recordPageFields}
        flowType={flowType}
      />
    ),
    [
      depth,
      childAncestors,
      fields,
      objects,
      externalObjects,
      variables,
      relatedFields,
      availableTypes,
      outputVariables,
      recordPageFields,
      flowType,
    ],
  );

  const summary = () => {
    const c = step.config || {};
    switch (step.type) {
      case 'condition':
        return `${c.conditions?.length || 0} condition(s), match ${c.logic || 'all'}`;
      case 'decision':
        return `${(c.outcomes || []).length} outcome(s)`;
      case 'assignment':
        return `${(c.assignments || []).length} assignment(s)`;
      case 'loop':
        return c.collectionVariable
          ? `Loop over {$${c.collectionVariable}}`
          : 'Not configured';
      case 'formula':
        return c.outputVariable
          ? `${c.outputVariable} = formula`
          : 'Not configured';
      case 'transform':
        return c.outputVariable ? `→ {$${c.outputVariable}}` : 'Not configured';
      case 'collection_filter':
        return c.outputVariable
          ? `Filter → {$${c.outputVariable}}`
          : 'Not configured';
      case 'collection_sort':
        return c.outputVariable
          ? `Sort → {$${c.outputVariable}}`
          : 'Not configured';
      case 'get_records':
        return c.variableName
          ? `${c.objectApiName || '?'} → {$${c.variableName}}`
          : 'Not configured';
      case 'action_update_record':
        return Object.keys(c.fields || {}).length
          ? `Set: ${Object.keys(c.fields).join(', ')}`
          : 'Not configured';
      case 'action_update_related_records':
        return c.objectApiName && c.lookupField
          ? `${c.objectApiName} via ${c.lookupField}`
          : 'Not configured';
      case 'action_create_record':
        return c.objectApiName ? `Create ${c.objectApiName}` : 'Not configured';
      case 'delete_records':
        return c.mode === 'trigger_record'
          ? 'Delete trigger record'
          : c.objectApiName || 'Not configured';
      case 'action_send_notification':
        return c.title || 'Not configured';
      case 'action_send_email':
        return c.toField
          ? `To field: {${c.toField}}`
          : c.to
            ? `To: ${c.to}`
            : 'Not configured';
      case 'action_http_request':
        return c.url ? `${c.method || 'POST'} ${c.url}` : 'Not configured';
      case 'screen':
        return c.title ? `Screen: ${c.title}` : 'Not configured';
      case 'navigate':
        return c.objectApiName
          ? `${c.targetType === 'record_detail' ? 'Record detail' : 'Record list'} — ${c.objectApiName}`
          : 'Not configured';
      case 'action_toast':
        return c.message
          ? `${c.type || 'success'}: ${c.message.slice(0, 40)}`
          : 'Not configured';
      case 'action_wait':
        return c.amount
          ? `${c.amount} ${c.unit || 'minutes'}`
          : 'Not configured';
      case 'action_generate_pdf':
        return c.templateId
          ? c.fileName
            ? `PDF: ${c.fileName}`
            : 'PDF configured'
          : 'Not configured';
      case 'subflow':
        return c.automationId ? 'Subflow configured' : 'Not configured';
      case 'pause':
        return c.resumeType === 'time'
          ? `${c.duration || 1} ${c.unit || 'hours'}`
          : 'Until condition met';
      default:
        return '';
    }
  };

  const renderConfig = () => {
    const c = step.config || {};
    switch (step.type) {
      case 'condition':
        return (
          <ConditionConfig config={c} onChange={setConfig} fields={fields} />
        );
      case 'decision':
        return (
          <DecisionElement
            config={c}
            onChange={setConfig}
            fields={fields}
            variables={variables}
            outputVariables={outputVariables}
            recordPageFields={recordPageFields}
            renderStepList={renderStepList}
          />
        );
      case 'assignment':
        return (
          <AssignmentElement
            config={c}
            onChange={setConfig}
            variables={variables}
            fields={fields}
            relatedFields={relatedFields}
          />
        );
      case 'loop':
        return (
          <LoopElement
            config={c}
            onChange={setConfig}
            variables={variables}
            renderStepList={renderStepList}
          />
        );
      case 'formula':
        return (
          <FormulaElement
            config={c}
            onChange={setConfig}
            fields={fields}
            variables={variables}
            relatedFields={relatedFields}
          />
        );
      case 'transform':
        return (
          <TransformElement
            config={c}
            onChange={setConfig}
            variables={variables}
          />
        );
      case 'collection_filter':
        return (
          <CollectionFilterElement
            config={c}
            onChange={setConfig}
            fields={fields}
            variables={variables}
          />
        );
      case 'collection_sort':
        return (
          <CollectionSortElement
            config={c}
            onChange={setConfig}
            fields={fields}
            variables={variables}
          />
        );
      case 'get_records':
        return (
          <GetRecordsConfig
            config={c}
            onChange={setConfig}
            objects={objects}
            variables={variables}
            triggerFields={fields}
          />
        );
      case 'action_update_record':
        return (
          <UpdateRecordConfig
            config={c}
            onChange={setConfig}
            fields={fields}
            variables={variables}
            outputVariables={outputVariables}
            recordPageFields={recordPageFields}
          />
        );
      case 'action_update_related_records':
        return (
          <UpdateRelatedRecordsElement
            config={c}
            onChange={setConfig}
            objects={objects}
            fields={fields}
            variables={variables}
            outputVariables={outputVariables}
            recordPageFields={recordPageFields}
          />
        );
      case 'action_create_record':
        return (
          <CreateRecordConfig
            config={c}
            onChange={setConfig}
            objects={objects}
            fields={fields}
            variables={variables}
            outputVariables={outputVariables}
            recordPageFields={recordPageFields}
          />
        );
      case 'delete_records':
        return (
          <DeleteRecordsElement
            config={c}
            onChange={setConfig}
            objects={objects}
            variables={variables}
          />
        );
      case 'action_send_notification':
        return (
          <NotificationConfig
            config={c}
            onChange={setConfig}
            fields={fields}
            relatedFields={relatedFields}
            variables={variables}
          />
        );
      case 'action_send_email':
        return (
          <EmailConfig
            config={c}
            onChange={setConfig}
            fields={fields}
            relatedFields={relatedFields}
          />
        );
      case 'action_http_request':
        return (
          <HttpRequestConfig
            config={c}
            onChange={setConfig}
            externalObjects={externalObjects}
          />
        );
      case 'screen':
        return (
          <ScreenConfig
            config={c}
            onChange={setConfig}
            fields={fields}
            objects={objects}
            variables={variables}
            outputVariables={outputVariables}
            recordPageFields={recordPageFields}
          />
        );
      case 'navigate':
        return (
          <NavigateElement
            config={c}
            onChange={setConfig}
            fields={fields}
            objects={objects}
            variables={variables}
            outputVariables={outputVariables}
          />
        );
      case 'action_toast':
        return (
          <ToastConfig
            config={c}
            onChange={setConfig}
            fields={fields}
            relatedFields={relatedFields}
          />
        );
      case 'action_wait':
        return <WaitConfig config={c} onChange={setConfig} />;
      case 'subflow':
        return (
          <SubflowElement
            config={c}
            onChange={setConfig}
            variables={variables}
          />
        );
      case 'pause':
        return <PauseElement config={c} onChange={setConfig} fields={fields} />;
      case 'action_generate_pdf':
        return (
          <GeneratePdfElement
            config={c}
            onChange={setConfig}
            variables={variables}
            fields={fields}
            outputVariables={outputVariables}
            recordPageFields={recordPageFields}
            flowType={flowType}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div
      className={`${styles.stepCard} ${expanded ? styles.stepExpanded : ''}`}
      style={depth > 0 ? { marginLeft: 0 } : undefined}
    >
      <div className={styles.stepHeader} onClick={() => setExpanded((e) => !e)}>
        <span
          className={styles.stepIcon}
          style={{ background: `${meta.color}20`, color: meta.color }}
        >
          {meta.icon}
        </span>
        <div className={styles.stepInfo}>
          <span className={styles.stepLabel}>{step.label || meta.label}</span>
          {!expanded && <span className={styles.stepSummary}>{summary()}</span>}
        </div>
        <div
          className={styles.stepActions}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className={styles.stepBtn}
            onClick={() => onMove(index, -1)}
            disabled={index === 0}
          >
            <ChevronUp size={13} />
          </button>
          <button
            className={styles.stepBtn}
            onClick={() => onMove(index, 1)}
            disabled={index === totalSteps - 1}
          >
            <ChevronDown size={13} />
          </button>
          <button
            className={`${styles.stepBtn} ${styles.stepBtnDanger}`}
            onClick={() => onDelete(index)}
          >
            <Trash2 size={13} />
          </button>
        </div>
        <span className={styles.chevron}>
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </span>
      </div>
      {expanded && (
        <div className={styles.stepBody}>
          <Row label="Step label">
            <Inp
              value={step.label}
              onChange={(v) => onChange({ ...step, label: v })}
              placeholder={meta.label}
            />
          </Row>
          {renderConfig()}
        </div>
      )}
    </div>
  );
}

// ─── Add step menu — portal-rendered so it's never clipped ──────────────────
function useDropdownPos(triggerRef, open) {
  const [style, setStyle] = useState(null);
  useEffect(() => {
    const calc = () => {
      const el = triggerRef.current;
      if (!open || !el) {
        setStyle(null);
        return;
      }
      const r = el.getBoundingClientRect();
      const spaceBelow = window.innerHeight - r.bottom - 8;
      const spaceAbove = r.top - 8;
      const maxH = 380;
      const goUp = spaceBelow < maxH && spaceAbove > spaceBelow;
      setStyle({
        position: 'fixed',
        top: goUp
          ? Math.max(8, r.top - Math.min(maxH, spaceAbove) - 4)
          : r.bottom + 4,
        left: r.left,
        minWidth: 220,
        maxHeight: goUp
          ? Math.min(maxH, spaceAbove)
          : Math.min(maxH, spaceBelow),
        zIndex: 9999,
      });
    };
    calc();
    if (!open) return;
    window.addEventListener('scroll', calc, true);
    window.addEventListener('resize', calc);
    return () => {
      window.removeEventListener('scroll', calc, true);
      window.removeEventListener('resize', calc);
    };
  }, [open, triggerRef]);
  return style;
}

function AddStepMenu({ onAdd, availableTypes = Object.keys(STEP_TYPES) }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef(null);
  const dropRef = useRef(null);
  const style = useDropdownPos(btnRef, open);

  const groups = useMemo(() => {
    const g = {};
    Object.entries(STEP_TYPES)
      .filter(([type]) => availableTypes.includes(type))
      .forEach(([type, meta]) => {
        (g[meta.group] = g[meta.group] || []).push({ type, ...meta });
      });
    return g;
  }, [availableTypes]);

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

  return (
    <div className={styles.connector}>
      <div className={styles.connLine} />
      <button
        ref={btnRef}
        className={styles.addStepBtn}
        onClick={() => setOpen((o) => !o)}
      >
        <Plus size={14} /> Add Step
      </button>
      {open &&
        style &&
        createPortal(
          <div ref={dropRef} className={styles.addMenu} style={style}>
            {Object.entries(groups).map(([group, items]) => (
              <div key={group}>
                <div className={styles.menuGroup}>{group}</div>
                {items.map((item) => (
                  <button
                    key={item.type}
                    className={styles.menuItem}
                    onClick={() => {
                      onAdd(item.type);
                      setOpen(false);
                    }}
                  >
                    <span style={{ color: item.color }}>{item.icon}</span>
                    {item.label}
                  </button>
                ))}
              </div>
            ))}
          </div>,
          document.body,
        )}
      <div className={styles.connLine} />
    </div>
  );
}

// ─── Trigger panel ────────────────────────────────────────────────────────────
const FLOW_TYPE_META = {
  record_triggered: {
    label: 'Record-Triggered Flow',
    icon: <Database size={18} />,
    color: '#6366f1',
    bg: '#eef2ff',
  },
  scheduled: {
    label: 'Scheduled-Triggered Flow',
    icon: <Clock size={18} />,
    color: '#0891b2',
    bg: '#ecfeff',
  },
  screen_flow: {
    label: 'Screen Flow',
    icon: <Monitor size={18} />,
    color: '#db2777',
    bg: '#fdf2f8',
  },
};

function TriggerPanel({ form, setForm, objects, fields, onFieldsChange }) {
  const setTrig = (k, v) =>
    setForm((f) => ({ ...f, trigger: { ...f.trigger, [k]: v } }));
  const toggleEv = (ev) => {
    const evts = form.trigger?.events || [];
    setTrig(
      'events',
      evts.includes(ev) ? evts.filter((x) => x !== ev) : [...evts, ev],
    );
  };

  const typeMeta = FLOW_TYPE_META[form.type] || FLOW_TYPE_META.record_triggered;

  return (
    <div className={styles.triggerPanel}>
      {/* ── Locked flow type indicator ── */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Flow type</div>
        <div
          className={styles.flowTypeLocked}
          style={{ borderColor: typeMeta.color, background: typeMeta.bg }}
        >
          <span
            className={styles.flowTypeLockedIcon}
            style={{ color: typeMeta.color }}
          >
            {typeMeta.icon}
          </span>
          <div className={styles.flowTypeLockedMeta}>
            <span
              className={styles.flowTypeLockedLabel}
              style={{ color: typeMeta.color }}
            >
              {typeMeta.label}
            </span>
            <span className={styles.flowTypeLockedHint}>
              Flow type is locked after creation.
            </span>
          </div>
          <span className={styles.lockIcon}>🔒</span>
        </div>
      </div>

      {form.type === 'record_triggered' && (
        <>
          <div className={styles.section}>
            <div className={styles.sectionTitle}>Object</div>
            <Sel
              value={form.trigger?.objectApiName || ''}
              placeholder="— Select object —"
              onChange={(v) => {
                setTrig('objectApiName', v);
                onFieldsChange(v);
              }}
              options={objects.map((o) => ({
                value: o.apiName,
                label: o.label,
              }))}
            />
          </div>
          <div className={styles.section}>
            <div className={styles.sectionTitle}>Trigger on</div>
            <div className={styles.eventBoxes}>
              {[
                { ev: 'create', label: 'Created' },
                { ev: 'update', label: 'Updated' },
                { ev: 'delete', label: 'Deleted' },
              ].map(({ ev, label }) => {
                const on = (form.trigger?.events || []).includes(ev);
                return (
                  <button
                    key={ev}
                    type="button"
                    className={`${styles.eventBox} ${on ? styles.eventBoxOn : ''}`}
                    onClick={() => toggleEv(ev)}
                  >
                    <span className={styles.eventCheck}>{on ? '✓' : ''}</span>
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className={styles.section}>
            <div className={styles.sectionTitle}>Run when</div>
            <div className={styles.runWhenCards}>
              {[
                {
                  v: 'always',
                  label: 'Every time',
                  desc: 'Run on every matching record event',
                },
                {
                  v: 'conditions_met',
                  label: 'Only when conditions met',
                  desc: 'Define entry conditions below',
                },
              ].map((rw) => (
                <button
                  key={rw.v}
                  type="button"
                  className={`${styles.runWhenCard} ${(form.trigger?.runWhen || 'always') === rw.v ? styles.runWhenActive : ''}`}
                  onClick={() => setTrig('runWhen', rw.v)}
                >
                  <strong>{rw.label}</strong>
                  <span>{rw.desc}</span>
                </button>
              ))}
            </div>
          </div>
          {form.trigger?.runWhen === 'conditions_met' && (
            <div className={styles.section}>
              <div className={styles.sectionTitle}>Entry conditions</div>
              <ConditionBuilder
                conditions={form.trigger?.conditions || []}
                logic={form.trigger?.conditionLogic || 'all'}
                onLogicChange={(v) => setTrig('conditionLogic', v)}
                onChange={(v) => setTrig('conditions', v)}
                fields={fields}
              />
            </div>
          )}
        </>
      )}

      {form.type === 'scheduled' && (
        <>
          <div className={styles.section}>
            <div className={styles.sectionTitle}>Cron schedule</div>
            <Inp
              value={form.trigger?.schedule?.cron || ''}
              onChange={(v) =>
                setTrig('schedule', { ...form.trigger?.schedule, cron: v })
              }
              placeholder="e.g. 0 9 * * 1  (every Monday 9am)"
            />
            <p className={styles.hint} style={{ marginTop: 6 }}>
              <code>min hour day month weekday</code> · <code>0 * * * *</code>{' '}
              hourly · <code>0 9 * * *</code> daily 9am
            </p>
          </div>
          <div className={styles.section}>
            <div className={styles.sectionTitle}>
              Run on object{' '}
              <span style={{ fontWeight: 400, color: 'var(--color-gray-400)' }}>
                (optional)
              </span>
            </div>
            <Sel
              value={form.trigger?.objectApiName || ''}
              placeholder="— Select object —"
              onChange={(v) => {
                setTrig('objectApiName', v);
                onFieldsChange(v);
              }}
              options={[
                { value: '', label: '— None —' },
                ...objects.map((o) => ({ value: o.apiName, label: o.label })),
              ]}
            />
            <p className={styles.hint} style={{ marginTop: 6 }}>
              Each run will iterate over all records of this object.
            </p>
          </div>
          {form.trigger?.objectApiName && (
            <>
              <div className={styles.section}>
                <div className={styles.sectionTitle}>Run when</div>
                <div className={styles.runWhenCards}>
                  {[
                    {
                      v: 'always',
                      label: 'Every record',
                      desc: 'Process all records of this object on each run',
                    },
                    {
                      v: 'conditions_met',
                      label: 'Only when conditions met',
                      desc: 'Filter records by entry conditions below',
                    },
                  ].map((rw) => (
                    <button
                      key={rw.v}
                      type="button"
                      className={`${styles.runWhenCard} ${(form.trigger?.runWhen || 'always') === rw.v ? styles.runWhenActive : ''}`}
                      onClick={() => setTrig('runWhen', rw.v)}
                    >
                      <strong>{rw.label}</strong>
                      <span>{rw.desc}</span>
                    </button>
                  ))}
                </div>
              </div>
              {form.trigger?.runWhen === 'conditions_met' && (
                <div className={styles.section}>
                  <div className={styles.sectionTitle}>Entry conditions</div>
                  <ConditionBuilder
                    conditions={form.trigger?.conditions || []}
                    logic={form.trigger?.conditionLogic || 'all'}
                    onLogicChange={(v) => setTrig('conditionLogic', v)}
                    onChange={(v) => setTrig('conditions', v)}
                    fields={fields}
                  />
                </div>
              )}
            </>
          )}
        </>
      )}

      {form.type === 'screen_flow' && (
        <>
          <div className={styles.section}>
            <div className={styles.sectionTitle}>
              How is this screen flow started?
            </div>
            <div className={styles.runWhenCards}>
              {[
                {
                  v: 'manual',
                  label: 'Manually',
                  desc: 'User launches it from the automation list or a button',
                },
                {
                  v: 'embedded',
                  label: 'Embedded in record',
                  desc: "Appears as a tab on the selected object's record detail page",
                },
              ].map((opt) => (
                <button
                  key={opt.v}
                  type="button"
                  className={`${styles.runWhenCard} ${(form.trigger?.entryPoint || 'manual') === opt.v ? styles.runWhenActive : ''}`}
                  onClick={() => setTrig('entryPoint', opt.v)}
                >
                  <strong>{opt.label}</strong>
                  <span>{opt.desc}</span>
                </button>
              ))}
            </div>
          </div>
          {form.trigger?.entryPoint === 'embedded' && (
            <div className={styles.section}>
              <div className={styles.sectionTitle}>Embed on object</div>
              <Sel
                value={form.trigger?.objectApiName || ''}
                placeholder="— Select object —"
                onChange={(v) => {
                  setTrig('objectApiName', v);
                  onFieldsChange(v);
                }}
                options={objects.map((o) => ({
                  value: o.apiName,
                  label: o.label,
                }))}
              />
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginTop: 8,
                }}
              >
                <label
                  style={{
                    fontSize: 'var(--font-size-sm)',
                    color: 'var(--color-gray-600)',
                    flexShrink: 0,
                  }}
                >
                  Tab order:
                </label>
                <input
                  type="number"
                  className={styles.inp}
                  style={{ width: 80 }}
                  value={form.trigger?.order ?? 0}
                  onChange={(e) =>
                    setTrig('order', parseInt(e.target.value) || 0)
                  }
                  min={0}
                  max={99}
                />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function FlowBuilder() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { objects } = useTenantContext();
  const isEdit = !!id;

  const [form, setForm] = useState({
    name: '',
    description: '',
    type: 'record_triggered',
    trigger: {
      objectApiName: '',
      events: ['create'],
      runWhen: 'always',
      conditions: [],
    },
  });
  const [typeChosen, setTypeChosen] = useState(isEdit); // new flows start at selector
  const [steps, setSteps] = useState([]);
  const [scheduledPaths, setScheduledPaths] = useState([]);
  const [variables, setVariables] = useState([]);
  const [fields, setFields] = useState([]);
  const [relatedFields, setRelatedFields] = useState({});
  const [externalObjects, setExtObjs] = useState([]);
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const [isValid, setIsValid] = useState(false);
  const [activeTab, setActiveTab] = useState('trigger');
  const [loading, setLoading] = useState(isEdit);
  const [debugOpen, setDebugOpen] = useState(false);

  // Available step types for the current flow type
  const availableTypes = Object.keys(STEP_TYPES).filter(
    (t) => !(EXCLUDED_STEPS[form.type] || []).includes(t),
  );

  useEffect(() => {
    api
      .get('/external-objects')
      .then((r) => setExtObjs(r.data.data || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!isEdit) return;
    api
      .get(`/automations/${id}`)
      .then((res) => {
        const auto = res.data.data;
        setIsActive(auto.isActive ?? false);
        setIsValid(auto.isValid ?? false);
        setForm({
          name: auto.name,
          description: auto.description || '',
          type: auto.type,
          trigger: auto.trigger || {},
          order: auto.order ?? 0,
          maxDepth: auto.maxDepth ?? 1,
          allowRecursion: auto.allowRecursion ?? false,
        });
        setVariables(auto.variables || []);
        setScheduledPaths(auto.scheduledPaths || []);
        const nodeMap = Object.fromEntries(
          (auto.nodes || []).map((n) => [n.id, n]),
        );
        const start = (auto.nodes || []).find((n) => n.type === 'trigger');
        const ordered = [];
        let cur = start;
        const seen = new Set();
        while (cur && !seen.has(cur.id)) {
          if (cur.type !== 'trigger' && cur.type !== 'end') {
            ordered.push({
              id: cur.id,
              type: cur.type,
              label: cur.label,
              config: cur.config || {},
            });
          }
          seen.add(cur.id);
          cur = nodeMap[cur.nextNodes?.[0]?.nodeId];
        }
        setSteps(ordered);
        if (auto.trigger?.objectApiName) loadFields(auto.trigger.objectApiName);
      })
      .catch(() => navigate('/automation'))
      .finally(() => setLoading(false));
  }, [id, isEdit, navigate]);

  const loadFields = async (objApiName) => {
    if (!objApiName) {
      setFields([]);
      setRelatedFields({});
      return;
    }
    try {
      const r = await api.get(`/objects/${objApiName}`);
      const fs = (r.data.data?.fields || []).sort(
        (a, b) => a.displayOrder - b.displayOrder,
      );
      setFields(fs);

      // Load related (lookup) fields — e.g. Account.Name
      const lookups = fs.filter(
        (f) => f.type === 'lookup' && f.lookupObjectApiName,
      );
      const relMap = {};
      await Promise.all(
        lookups.slice(0, 6).map(async (lf) => {
          try {
            const lr = await api.get(`/objects/${lf.lookupObjectApiName}`);
            const relName = lf.apiName.replace(/Id$/i, '');
            relMap[lf.apiName] = {
              objectLabel: lr.data.data?.label || lf.lookupObjectApiName,
              relationshipName: relName,
              fields: (lr.data.data?.fields || [])
                .filter((f) => !f.isSystem || f.apiName === 'name')
                .sort((a, b) => a.displayOrder - b.displayOrder)
                .slice(0, 20),
            };
          } catch {}
        }),
      );
      setRelatedFields(relMap);
    } catch {
      setFields([]);
      setRelatedFields({});
    }
  };

  const addStep = (type, afterIdx = null) => {
    const newStep = {
      id: genId(),
      type,
      label: STEP_TYPES[type]?.label || type,
      config: {},
      _new: true,
    };
    setSteps((s) =>
      afterIdx === null
        ? [...s, newStep]
        : [...s.slice(0, afterIdx + 1), newStep, ...s.slice(afterIdx + 1)],
    );
    setActiveTab('steps');
  };
  const updateStep = useCallback(
    (idx, upd) => setSteps((s) => s.map((st, i) => (i === idx ? upd : st))),
    [],
  );
  const deleteStep = useCallback(
    (idx) => setSteps((s) => s.filter((_, i) => i !== idx)),
    [],
  );
  const moveStep = useCallback((idx, dir) => {
    setSteps((s) => {
      const ni = idx + dir;
      if (ni < 0 || ni >= s.length) return s;
      const n = [...s];
      [n[idx], n[ni]] = [n[ni], n[idx]];
      return n;
    });
  }, []);

  // ── Scheduled paths helpers ────────────────────────────────────────────────
  const addScheduledPath = () => {
    setScheduledPaths((sp) => [
      ...sp,
      {
        id: genId(),
        label: '',
        offsetNumber: 1,
        offsetUnit: 'days',
        offsetDirection: 'after',
        offsetField: 'createdAt',
        steps: [],
      },
    ]);
  };
  const updateScheduledPath = useCallback(
    (idx, upd) =>
      setScheduledPaths((sp) => sp.map((p, i) => (i === idx ? upd : p))),
    [],
  );
  const deleteScheduledPath = useCallback(
    (idx) => setScheduledPaths((sp) => sp.filter((_, i) => i !== idx)),
    [],
  );
  const moveScheduledPath = useCallback((idx, dir) => {
    setScheduledPaths((sp) => {
      const ni = idx + dir;
      if (ni < 0 || ni >= sp.length) return sp;
      const n = [...sp];
      [n[idx], n[ni]] = [n[ni], n[idx]];
      return n;
    });
  }, []);

  const buildNodes = () => {
    const tid = 'trigger_node',
      eid = 'end_node';
    return [
      {
        id: tid,
        type: 'trigger',
        label: 'Trigger',
        position: { x: 250, y: 0 },
        config: {},
        nextNodes: steps.length ? [{ nodeId: steps[0].id }] : [{ nodeId: eid }],
      },
      ...steps.map((s, i) => ({
        id: s.id,
        type: s.type,
        label: s.label,
        position: { x: 250, y: (i + 1) * 140 },
        config: s.config || {},
        nextNodes: [{ nodeId: i < steps.length - 1 ? steps[i + 1].id : eid }],
      })),
      {
        id: eid,
        type: 'end',
        label: 'End',
        position: { x: 250, y: (steps.length + 1) * 140 },
        config: {},
        nextNodes: [],
      },
    ];
  };

  const handleToggle = async () => {
    if (!id) {
      toast.error('Save the automation first.');
      return;
    }
    if (!isValid && !isActive) {
      toast.error('Save first to activate.');
      return;
    }
    setToggling(true);
    try {
      const res = await api.patch(`/automations/${id}/toggle`);
      const nextActive = res.data.data.isActive;
      setIsActive(nextActive);
      toast.success(
        nextActive ? 'Automation activated.' : 'Automation deactivated.',
      );
    } catch (err) {
      toast.error(err.message || 'Toggle failed.');
    } finally {
      setToggling(false);
    }
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error('Name is required.');
      return;
    }
    if (form.type === 'record_triggered' && !form.trigger?.objectApiName) {
      toast.error('Select a trigger object.');
      return;
    }
    if (form.type === 'record_triggered' && !form.trigger?.events?.length) {
      toast.error('Select at least one trigger event.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        variables,
        scheduledPaths,
        apiName:
          form.name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_|_$/g, '') +
          '_' +
          Date.now(),
        nodes: buildNodes(),
        isValid: true,
      };
      if (isEdit) {
        await api.put(`/automations/${id}`, payload);
        setIsValid(true);
        toast.success('Automation saved.');
      } else {
        const res = await api.post('/automations', payload);
        toast.success('Automation created.');
        navigate(`/automation/${res.data.data._id}`);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  if (loading)
    return (
      <Layout
        title="Flow Builder"
        description="Build and configure automation flows"
      >
        <div className={styles.loading}>
          <div className={styles.spinner} />
        </div>
      </Layout>
    );

  // ── Show flow type selector for brand-new flows ─────────────────────────────
  if (!typeChosen) {
    return (
      <Layout title="New Flow" description="Choose a flow type to get started">
        <FlowTypeSelector
          onSelect={(type) => {
            setForm((f) => ({ ...f, type }));
            setTypeChosen(true);
          }}
        />
      </Layout>
    );
  }

  // Output variables: create_record steps that have an outputVariable set
  const outputVariables = steps
    .filter(
      (s) => s.type === 'action_create_record' && s.config?.outputVariable,
    )
    .map((s) => ({
      name: s.config.outputVariable,
      label: s.config.outputVariable,
      objectApiName: s.config.objectApiName || '',
      fields: [],
    }));

  // Record-page context fields: available when flow is embedded in a record page
  const recordPageFields =
    form.type === 'screen_flow' && form.trigger?.entryPoint === 'embedded'
      ? [
          { apiName: 'record._id', label: 'Page Record — MongoDB _id' },
          { apiName: 'record.id', label: 'Page Record — ID (string)' },
          { apiName: 'record.name', label: 'Page Record — Name' },
          {
            apiName: 'record.objectApiName',
            label: 'Page Record — Object type',
          },
          { apiName: 'record.ownerId', label: 'Page Record — Owner ID' },
          ...fields.map((f) => ({
            apiName: `record.${f.apiName}`,
            label: `Page Record — ${f.label}`,
          })),
        ]
      : [];

  const stepCardProps = {
    fields,
    objects,
    externalObjects,
    variables,
    relatedFields,
    availableTypes,
    outputVariables,
    recordPageFields,
    flowType: form.type,
  };
  const typeMeta = FLOW_TYPE_META[form.type] || FLOW_TYPE_META.record_triggered;

  return (
    <Layout
      title="Flow Builder"
      description="Build and configure automation flows"
    >
      <div className={styles.page}>
        <div className={styles.header}>
          <Link to="/automation" className={styles.backLink}>
            <ArrowLeft size={16} /> Automation
          </Link>
          <div className={styles.headerRow}>
            <input
              className={styles.nameInput}
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Automation name…"
            />
            {/* Flow type pill — locked, read-only */}
            <span
              className={styles.flowTypePill}
              style={{ background: typeMeta.bg, color: typeMeta.color }}
            >
              {typeMeta.icon} {typeMeta.label}
            </span>
            <span
              className={`${styles.statusBadge} ${isActive ? styles.statusActive : styles.statusInactive}`}
            >
              {isActive ? '● Active' : '○ Inactive'}
            </span>
            {isEdit && (
              <Button
                variant={isActive ? 'secondary' : 'success'}
                size="sm"
                loading={toggling}
                onClick={handleToggle}
              >
                {isActive ? 'Deactivate' : 'Activate'}
              </Button>
            )}
            {isEdit && (
              <Button
                variant="secondary"
                icon={<Play size={13} />}
                onClick={() => setDebugOpen(true)}
              >
                Test
              </Button>
            )}
            <Button
              icon={<Save size={13} />}
              loading={saving}
              onClick={handleSave}
            >
              Save
            </Button>
          </div>
        </div>

        <div className={styles.tabs}>
          {[
            { key: 'trigger', label: 'Trigger', icon: <Zap size={14} /> },
            {
              key: 'steps',
              label: `Steps (${steps.length}${scheduledPaths.length ? ` + ${scheduledPaths.length} scheduled` : ''})`,
              icon: <ArrowRight size={14} />,
            },
            {
              key: 'variables',
              label: `Variables (${variables.length})`,
              icon: <Variable size={14} />,
            },
            {
              key: 'settings',
              label: 'Settings',
              icon: <Settings size={14} />,
            },
          ].map((t) => (
            <button
              key={t.key}
              className={`${styles.tab} ${activeTab === t.key ? styles.activeTab : ''}`}
              onClick={() => setActiveTab(t.key)}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {activeTab === 'trigger' && (
          <TriggerPanel
            form={form}
            setForm={setForm}
            objects={objects}
            fields={fields}
            onFieldsChange={loadFields}
          />
        )}

        {activeTab === 'steps' && (
          <div className={styles.stepsPanel}>
            <div
              className={styles.triggerSummary}
              onClick={() => setActiveTab('trigger')}
            >
              <span
                className={styles.stepIcon}
                style={{ background: '#ede9fe', color: '#7c3aed' }}
              >
                <Zap size={16} />
              </span>
              <div className={styles.stepInfo}>
                <span className={styles.stepLabel}>
                  {form.type === 'record_triggered'
                    ? `When ${form.trigger?.objectApiName || '(object)'} is ${(form.trigger?.events || []).join(' / ') || '(select events)'}`
                    : form.type === 'screen_flow'
                      ? `Screen Flow — ${form.trigger?.entryPoint === 'embedded' ? `embedded in ${form.trigger?.objectApiName || '(object)'}` : 'manual start'}`
                      : `Scheduled: ${form.trigger?.schedule?.cron || '(not set)'}${form.trigger?.objectApiName ? ` · ${form.trigger.objectApiName}` : ''}`}
                </span>
                <span className={styles.stepSummary}>
                  {form.trigger?.runWhen === 'conditions_met'
                    ? `${(form.trigger?.conditions || []).length} entry condition(s)`
                    : 'Runs every time'}
                </span>
              </div>
              <span className={styles.editHint}>click to edit</span>
            </div>

            {steps.length === 0 && (
              <div className={styles.emptySteps}>
                No steps yet — add actions and logic below.
              </div>
            )}

            {steps.map((step, i) => (
              <React.Fragment key={step.id}>
                <StepCard
                  step={step}
                  index={i}
                  totalSteps={steps.length}
                  {...stepCardProps}
                  onChange={(upd) => updateStep(i, upd)}
                  onDelete={() => deleteStep(i)}
                  onMove={(_, dir) => moveStep(i, dir)}
                />
                <AddStepMenu
                  onAdd={(type) => addStep(type, i)}
                  availableTypes={availableTypes}
                />
              </React.Fragment>
            ))}
            {steps.length === 0 && (
              <AddStepMenu
                onAdd={(type) => addStep(type, -1)}
                availableTypes={availableTypes}
              />
            )}
            <div className={styles.endNode}>
              <CheckCircle size={15} style={{ color: '#94a3b8' }} />
              <span>End — Immediate Path</span>
            </div>

            {/* ── Scheduled Paths — only for Record-Triggered flows ── */}
            {form.type === 'record_triggered' && (
              <div className={styles.scheduledSection}>
                <div className={styles.scheduledDivider}>
                  <div className={styles.scheduledDividerLine} />
                  <div className={styles.scheduledDividerBadge}>
                    <Clock size={13} />
                    <span>Scheduled Paths</span>
                  </div>
                  <div className={styles.scheduledDividerLine} />
                </div>

                <p className={styles.scheduledHint}>
                  Scheduled paths run asynchronously at a future time relative
                  to each record's field values — similar to Salesforce's
                  Scheduled Paths feature.
                </p>

                {scheduledPaths.map((path, i) => {
                  const renderNestedForPath = (nestedSteps, onNestedChange) => (
                    <NestedStepList
                      steps={nestedSteps}
                      onChange={onNestedChange}
                      depth={1}
                      {...stepCardProps}
                    />
                  );
                  const dateFields = fields.filter(
                    (f) => f.type === 'date' || f.type === 'datetime',
                  );
                  return (
                    <React.Fragment key={path.id}>
                      <ScheduledPathCard
                        path={path}
                        index={i}
                        total={scheduledPaths.length}
                        dateFields={dateFields}
                        onMove={moveScheduledPath}
                        onChange={(upd) => updateScheduledPath(i, upd)}
                        onDelete={() => deleteScheduledPath(i)}
                        renderStepList={renderNestedForPath}
                      />
                      {i < scheduledPaths.length - 1 && (
                        <div style={{ height: 8 }} />
                      )}
                    </React.Fragment>
                  );
                })}

                {scheduledPaths.length === 0 && (
                  <div className={styles.scheduledEmpty}>
                    No scheduled paths yet. Add one to run actions after a
                    delay.
                  </div>
                )}

                <button
                  className={styles.addScheduledBtn}
                  onClick={addScheduledPath}
                >
                  <Clock size={14} /> Add Scheduled Path
                </button>
              </div>
            )}
          </div>
        )}

        {activeTab === 'variables' && (
          <VariablesPanel
            variables={variables}
            onChange={setVariables}
            objects={objects}
          />
        )}

        {activeTab === 'settings' && (
          <div className={styles.settingsPanel}>
            <div className={styles.section}>
              <div className={styles.sectionTitle}>Activation</div>
              <div className={styles.activationRow}>
                <div className={styles.activationStatus}>
                  <span
                    className={`${styles.statusDot} ${isActive ? styles.dotActive : styles.dotInactive}`}
                  />
                  <div>
                    <span className={styles.activationLabel}>
                      {isActive
                        ? 'Active — automation is running'
                        : 'Inactive — automation will not fire'}
                    </span>
                    {!isValid && isEdit && (
                      <p className={styles.activationHint}>
                        Save to mark as valid, then activate.
                      </p>
                    )}
                  </div>
                </div>
                {isEdit && (
                  <Button
                    variant={isActive ? 'secondary' : 'success'}
                    size="sm"
                    loading={toggling}
                    onClick={handleToggle}
                  >
                    {isActive ? 'Deactivate' : 'Activate'}
                  </Button>
                )}
              </div>
            </div>
            <div className={styles.section}>
              <div className={styles.sectionTitle}>Description</div>
              <textarea
                className={styles.inp}
                rows={3}
                value={form.description}
                onChange={(e) =>
                  setForm((f) => ({ ...f, description: e.target.value }))
                }
                placeholder="What does this automation do?"
              />
            </div>
            <div className={styles.section}>
              <div className={styles.sectionTitle}>Execution Order</div>
              <p className={styles.hint}>
                Lower numbers run first (0 = highest priority).
              </p>
              <div
                className={styles.inlineRow}
                style={{ gap: 8, alignItems: 'center' }}
              >
                <label
                  style={{
                    fontSize: 'var(--font-size-sm)',
                    color: 'var(--color-gray-600)',
                    flexShrink: 0,
                  }}
                >
                  Order:
                </label>
                <input
                  type="number"
                  className={styles.inp}
                  style={{ width: 80 }}
                  value={form.order ?? 0}
                  min={0}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      order: parseInt(e.target.value) || 0,
                    }))
                  }
                />
              </div>
            </div>
            <div className={styles.section}>
              <div className={styles.sectionTitle}>Recursion Prevention</div>
              <p className={styles.hint}>
                Controls whether this automation can re-trigger itself.
              </p>
              <div
                style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
              >
                <div
                  className={styles.inlineRow}
                  style={{ gap: 8, alignItems: 'center' }}
                >
                  <label
                    style={{
                      fontSize: 'var(--font-size-sm)',
                      color: 'var(--color-gray-600)',
                      flexShrink: 0,
                    }}
                  >
                    Max depth:
                  </label>
                  <input
                    type="number"
                    className={styles.inp}
                    style={{ width: 80 }}
                    value={form.maxDepth ?? 1}
                    min={1}
                    max={10}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        maxDepth: parseInt(e.target.value) || 1,
                      }))
                    }
                  />
                </div>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 'var(--font-size-sm)',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={!!form.allowRecursion}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        allowRecursion: e.target.checked,
                      }))
                    }
                    style={{
                      accentColor: 'var(--color-primary)',
                      width: 15,
                      height: 15,
                    }}
                  />
                  Allow recursion —{' '}
                  <span
                    style={{ color: 'var(--color-warning)', fontWeight: 500 }}
                  >
                    use with caution
                  </span>
                </label>
              </div>
            </div>
            <div className={styles.section}>
              <div className={styles.sectionTitle}>External Objects</div>
              {externalObjects.length === 0 ? (
                <p className={styles.hint} style={{ fontStyle: 'italic' }}>
                  None configured.
                </p>
              ) : (
                externalObjects.map((e) => (
                  <div key={e._id} className={styles.extItem}>
                    <Globe size={14} style={{ color: '#f59e0b' }} />
                    <div className={styles.extMeta}>
                      <span className={styles.extName}>{e.name}</span>
                      <span className={styles.extUrl}>{e.baseUrl}</span>
                    </div>
                    <span className={styles.extAuth}>{e.authType}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Debug / Test panel ── */}
      <FlowDebugPanel
        automationId={id}
        flowType={form.type}
        triggerObjectApiName={form.trigger?.objectApiName}
        triggerEvents={form.trigger?.events || ['create']}
        open={debugOpen}
        onClose={() => setDebugOpen(false)}
      />
    </Layout>
  );
}
