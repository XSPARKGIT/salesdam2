import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { ArrowLeft, Plus, X, ArrowUp, ArrowDown } from 'lucide-react';
import Layout from '../../layout/Layout';
import Button from '../../components/common/Button/Button';
import { useTenantContext } from '../../context/TenantContext';
import { getFields } from '../../services/api/objects';
import { getUsers } from '../../services/api/users';
import { getRoles } from '../../services/api/roles';
import { getAutomations } from '../../services/api/automations';
import {
  getApprovalProcess,
  createApprovalProcess,
  updateApprovalProcess,
} from '../../services/api/approvals';
import styles from './Approvals.module.css';

const OPERATORS = [
  { value: 'equals', label: 'equals' },
  { value: 'not_equals', label: 'does not equal' },
  { value: 'greater_than', label: 'is greater than' },
  { value: 'greater_or_equal', label: 'is at least' },
  { value: 'less_than', label: 'is less than' },
  { value: 'less_or_equal', label: 'is at most' },
  { value: 'contains', label: 'contains' },
  { value: 'is_empty', label: 'is empty' },
  { value: 'is_not_empty', label: 'is not empty' },
];
const NO_VALUE_OPERATORS = new Set(['is_empty', 'is_not_empty']);

const APPROVER_TYPES = [
  { value: 'user', label: 'A specific user' },
  { value: 'manager', label: "The submitter's manager" },
  { value: 'field', label: 'A user field on the record' },
  { value: 'queue', label: 'Anyone with a role' },
];

// Field types whose value is computed, so they can't be set by an action.
const READ_ONLY_TYPES = new Set(['formula', 'rollup_summary', 'auto_number']);

const STAGES = [
  {
    key: 'onSubmit',
    title: 'When submitted',
    hint: 'Runs as soon as the record is submitted. Recalling the request restores these fields.',
  },
  {
    key: 'onApprove',
    title: 'When finally approved',
    hint: 'Runs after the last step is approved.',
  },
  {
    key: 'onReject',
    title: 'When rejected',
    hint: 'Runs as soon as any step is rejected.',
  },
];

const emptyStage = () => ({ fieldUpdates: [], flowId: '', lockRecord: false, unlockRecord: true });

const EMPTY = {
  name: '',
  description: '',
  objectApiName: '',
  active: true,
  entryCriteria: { logic: 'AND', conditions: [] },
  steps: [{ name: '', approverType: 'manager', approverUserId: '', approverFieldApiName: '', approverRoleId: '' }],
  actions: { onSubmit: emptyStage(), onApprove: emptyStage(), onReject: emptyStage() },
};

const idOf = (v) => (v && typeof v === 'object' ? v._id : v) || '';

/** Turn a stored process into editable form state (ids as strings, no nulls). */
const toForm = (p) => ({
  name: p.name || '',
  description: p.description || '',
  objectApiName: p.objectApiName || '',
  active: p.active !== false,
  entryCriteria: {
    logic: p.entryCriteria?.logic || 'AND',
    conditions: (p.entryCriteria?.conditions || []).map((c) => ({
      field: c.field,
      operator: c.operator || 'equals',
      value: c.value ?? '',
      valueType: c.valueType || 'literal',
    })),
  },
  steps: [...(p.steps || [])]
    .sort((a, b) => a.order - b.order)
    .map((s) => ({
      name: s.name || '',
      approverType: s.approverType,
      approverUserId: idOf(s.approverUserId),
      approverFieldApiName: s.approverFieldApiName || '',
      approverRoleId: idOf(s.approverRoleId),
    })),
  actions: Object.fromEntries(
    STAGES.map(({ key }) => {
      const a = p.actions?.[key] || {};
      return [
        key,
        {
          fieldUpdates: (a.fieldUpdates || []).map((u) => ({ field: u.field, value: u.value ?? '' })),
          flowId: idOf(a.flowId),
          lockRecord: Boolean(a.lockRecord),
          unlockRecord: a.unlockRecord !== false,
        },
      ];
    }),
  ),
});

/** Turn form state back into the API shape, dropping blanks and stale ids. */
const toPayload = (form) => ({
  name: form.name.trim(),
  description: form.description.trim(),
  objectApiName: form.objectApiName,
  active: form.active,
  entryCriteria: {
    logic: form.entryCriteria.logic,
    conditions: form.entryCriteria.conditions
      .filter((c) => c.field)
      .map((c) => ({
        field: c.field,
        operator: c.operator,
        value: NO_VALUE_OPERATORS.has(c.operator) ? null : c.value,
        valueType: c.valueType || 'literal',
      })),
  },
  steps: form.steps.map((s, i) => ({
    order: i + 1,
    name: s.name.trim(),
    approverType: s.approverType,
    ...(s.approverType === 'user' ? { approverUserId: s.approverUserId } : {}),
    ...(s.approverType === 'field' ? { approverFieldApiName: s.approverFieldApiName } : {}),
    ...(s.approverType === 'queue' ? { approverRoleId: s.approverRoleId } : {}),
  })),
  actions: Object.fromEntries(
    STAGES.map(({ key }) => {
      const a = form.actions[key];
      return [
        key,
        {
          fieldUpdates: a.fieldUpdates.filter((u) => u.field),
          flowId: a.flowId || null,
          lockRecord: key === 'onSubmit' ? a.lockRecord : false,
          unlockRecord: a.unlockRecord,
        },
      ];
    }),
  ),
});

const validate = (form) => {
  const errors = {};
  if (!form.name.trim()) errors.name = 'Give the process a name.';
  if (!form.objectApiName) errors.objectApiName = 'Choose the object this process applies to.';
  if (form.steps.length === 0) errors.steps = 'Add at least one approval step.';
  form.steps.forEach((s, i) => {
    if (s.approverType === 'user' && !s.approverUserId) errors[`step_${i}`] = 'Choose the approver.';
    if (s.approverType === 'field' && !s.approverFieldApiName) errors[`step_${i}`] = 'Choose the user field.';
    if (s.approverType === 'queue' && !s.approverRoleId) errors[`step_${i}`] = 'Choose the role.';
  });
  return errors;
};

/** Value input that fits the field: picklist options, yes/no, number, date or text. */
const FieldValueInput = ({ field, value, onChange, ariaLabel }) => {
  const options = (field?.picklistValues || []).filter((o) => o.isActive !== false);
  if (field && (field.type === 'picklist' || field.type === 'multipicklist') && options.length) {
    return (
      <select className={styles.select} value={value ?? ''} onChange={(e) => onChange(e.target.value)} aria-label={ariaLabel}>
        <option value="">— Select —</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  if (field?.type === 'boolean') {
    return (
      <select
        className={styles.select}
        value={value === true || value === 'true' ? 'true' : value === false || value === 'false' ? 'false' : ''}
        onChange={(e) => onChange(e.target.value === '' ? '' : e.target.value === 'true')}
        aria-label={ariaLabel}
      >
        <option value="">— Select —</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    );
  }
  const numeric = ['number', 'currency', 'percent'].includes(field?.type);
  return (
    <input
      className={styles.input}
      type={numeric ? 'number' : field?.type === 'date' ? 'date' : 'text'}
      value={value ?? ''}
      onChange={(e) => onChange(numeric && e.target.value !== '' ? Number(e.target.value) : e.target.value)}
      placeholder="Value"
      aria-label={ariaLabel}
    />
  );
};

/**
 * Setup › Approval Processes › new/edit. Entry criteria, ordered approval
 * steps, and per-stage actions (field updates, record lock, launch a flow).
 */
export default function ApprovalProcessEditor() {
  const { id } = useParams();
  const { data: existing, isLoading, isError } = useQuery({
    queryKey: ['approval-process', id],
    queryFn: () => getApprovalProcess(id),
    enabled: !!id,
    staleTime: 0,
  });

  if (id && (isLoading || isError)) {
    return (
      <Layout title="Approval Process">
        <div className={styles.loading}>
          {isError ? (
            <span>
              This approval process couldn't be loaded.{' '}
              <Link to="/setup/approval-processes">Back to approval processes</Link>
            </span>
          ) : (
            'Loading…'
          )}
        </div>
      </Layout>
    );
  }

  // Keyed so switching between processes starts from fresh form state.
  return <ProcessForm key={id || 'new'} id={id} initial={existing ? toForm(existing) : EMPTY} />;
}

function ProcessForm({ id, initial }) {
  const isNew = !id;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { objects } = useTenantContext();

  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const { data: fields = [] } = useQuery({
    queryKey: ['fields', form.objectApiName],
    queryFn: () => getFields(form.objectApiName),
    enabled: !!form.objectApiName,
  });
  const { data: users = [] } = useQuery({
    queryKey: ['users-for-approvals'],
    queryFn: () => getUsers({ limit: 200, status: 'active' }),
    staleTime: 0,
  });
  const { data: roles = [] } = useQuery({
    queryKey: ['roles'],
    queryFn: () => getRoles().then((res) => res.data.data || []),
  });
  const { data: flows = [] } = useQuery({
    // Its own key with no cache, so a flow built a moment ago is offered.
    queryKey: ['approval-flow-options'],
    queryFn: () => getAutomations(),
    staleTime: 0,
  });

  const sortedObjects = useMemo(
    () => [...(objects || [])].sort((a, b) => (a.label || '').localeCompare(b.label || '')),
    [objects],
  );
  const sortedFields = useMemo(
    () => [...fields].sort((a, b) => (a.label || '').localeCompare(b.label || '')),
    [fields],
  );
  const fieldByApi = useMemo(() => Object.fromEntries(fields.map((f) => [f.apiName, f])), [fields]);
  const writableFields = sortedFields.filter((f) => !READ_ONLY_TYPES.has(f.type));
  const userFields = sortedFields.filter((f) => f.type === 'lookup' && f.lookupObjectApiName === 'user');
  const launchableFlows = flows.filter((f) => f.type !== 'screen_flow');

  const set = (patch) => setForm((prev) => ({ ...prev, ...patch }));
  const clearError = (key) => setErrors((prev) => ({ ...prev, [key]: undefined }));

  /* ── Entry criteria ─────────────────────────────────────────────────── */
  const setConditions = (conditions) => set({ entryCriteria: { ...form.entryCriteria, conditions } });
  const updateCondition = (i, patch) =>
    setConditions(form.entryCriteria.conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  /* ── Steps ──────────────────────────────────────────────────────────── */
  const setSteps = (steps) => set({ steps });
  const updateStep = (i, patch) => {
    setSteps(form.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)));
    clearError(`step_${i}`);
  };
  const moveStep = (i, dir) => {
    const next = [...form.steps];
    [next[i], next[i + dir]] = [next[i + dir], next[i]];
    setSteps(next);
  };

  /* ── Stage actions ──────────────────────────────────────────────────── */
  const updateStage = (key, patch) =>
    set({ actions: { ...form.actions, [key]: { ...form.actions[key], ...patch } } });
  const updateFieldUpdate = (key, i, patch) =>
    updateStage(key, {
      fieldUpdates: form.actions[key].fieldUpdates.map((u, j) => (j === i ? { ...u, ...patch } : u)),
    });

  const handleSave = async () => {
    const errs = validate(form);
    setErrors(errs);
    if (Object.values(errs).some(Boolean)) {
      toast.error('Fix the highlighted fields first.');
      return;
    }
    setSaving(true);
    try {
      const payload = toPayload(form);
      if (isNew) await createApprovalProcess(payload);
      else await updateApprovalProcess(id, payload);
      toast.success(isNew ? 'Approval process created.' : 'Approval process saved.');
      queryClient.invalidateQueries({ queryKey: ['approval-processes'] });
      queryClient.invalidateQueries({ queryKey: ['approval-process', id] });
      queryClient.invalidateQueries({ queryKey: ['approval-state'] });
      navigate('/setup/approval-processes');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save the approval process.');
    } finally {
      setSaving(false);
    }
  };

  const title = isNew ? 'New approval process' : form.name || 'Approval process';

  return (
    <Layout title={title} description="Configure an approval process">
      <div className={styles.page}>
        <div className={styles.header}>
          <div>
            <Link to="/setup/approval-processes" className={styles.back}>
              <ArrowLeft size={14} /> Approval processes
            </Link>
            <h1 className={styles.title}>{title}</h1>
          </div>
          <div className={styles.headerActions}>
            <Button variant="secondary" onClick={() => navigate('/setup/approval-processes')} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} loading={saving}>
              {isNew ? 'Create process' : 'Save changes'}
            </Button>
          </div>
        </div>

        {/* ── Details ── */}
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Details</h2>
          <div className={styles.grid2}>
            <label className={styles.field}>
              <span className={styles.label}>Name</span>
              <input
                className={styles.input}
                value={form.name}
                onChange={(e) => {
                  set({ name: e.target.value });
                  clearError('name');
                }}
                placeholder="e.g. Large deal approval"
                maxLength={120}
              />
              {errors.name && <span className={styles.error}>{errors.name}</span>}
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Object</span>
              <select
                className={styles.select}
                value={form.objectApiName}
                disabled={!isNew}
                onChange={(e) => {
                  // Field references belong to the old object, so start clean.
                  setForm((prev) => ({
                    ...prev,
                    objectApiName: e.target.value,
                    entryCriteria: { ...prev.entryCriteria, conditions: [] },
                    steps: prev.steps.map((s) => ({ ...s, approverFieldApiName: '' })),
                    actions: Object.fromEntries(
                      STAGES.map(({ key }) => [key, { ...prev.actions[key], fieldUpdates: [] }]),
                    ),
                  }));
                  clearError('objectApiName');
                }}
              >
                <option value="">— Select an object —</option>
                {sortedObjects.map((o) => (
                  <option key={o.apiName} value={o.apiName}>
                    {o.label}
                  </option>
                ))}
              </select>
              {!isNew && <span className={styles.help}>The object can't be changed after creation.</span>}
              {errors.objectApiName && <span className={styles.error}>{errors.objectApiName}</span>}
            </label>
            <label className={`${styles.field} ${styles.fieldFull}`}>
              <span className={styles.label}>Description</span>
              <textarea
                className={styles.textarea}
                rows={2}
                value={form.description}
                onChange={(e) => set({ description: e.target.value })}
                placeholder="What this process is for (optional)"
              />
            </label>
            <label className={styles.check}>
              <input type="checkbox" checked={form.active} onChange={(e) => set({ active: e.target.checked })} />
              Active — matching records show “Submit for approval”
            </label>
          </div>
        </section>

        {/* ── Entry criteria ── */}
        <section className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <h2 className={styles.cardTitle}>Entry criteria</h2>
              <p className={styles.cardHint}>
                Which records can be submitted. With no conditions, every record of the object can.
                When several processes match, the user picks one.
              </p>
            </div>
            {form.entryCriteria.conditions.length > 1 && (
              <label className={styles.logic}>
                Match
                <select
                  className={styles.select}
                  style={{ width: 'auto' }}
                  value={form.entryCriteria.logic}
                  onChange={(e) => set({ entryCriteria: { ...form.entryCriteria, logic: e.target.value } })}
                >
                  <option value="AND">all conditions</option>
                  <option value="OR">any condition</option>
                </select>
              </label>
            )}
          </div>

          {!form.objectApiName ? (
            <p className={styles.help}>Choose an object first.</p>
          ) : (
            <div className={styles.rows}>
              {form.entryCriteria.conditions.map((c, i) => (
                <div key={i} className={`${styles.row} ${styles.conditionRow}`}>
                  <select
                    className={styles.select}
                    value={c.field}
                    onChange={(e) => updateCondition(i, { field: e.target.value, value: '' })}
                    aria-label={`Condition ${i + 1} field`}
                  >
                    <option value="">— Field —</option>
                    {sortedFields.map((f) => (
                      <option key={f.apiName} value={f.apiName}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                  <select
                    className={styles.select}
                    value={c.operator}
                    onChange={(e) => updateCondition(i, { operator: e.target.value })}
                    aria-label={`Condition ${i + 1} operator`}
                  >
                    {OPERATORS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  {NO_VALUE_OPERATORS.has(c.operator) ? (
                    <span />
                  ) : c.valueType === 'tenantConfig' ? (
                    <input
                      className={styles.input}
                      value={c.value ?? ''}
                      onChange={(e) => updateCondition(i, { value: e.target.value })}
                      title="Compared against this tenant setting"
                      aria-label={`Condition ${i + 1} tenant setting key`}
                    />
                  ) : (
                    <FieldValueInput
                      field={fieldByApi[c.field]}
                      value={c.value}
                      onChange={(value) => updateCondition(i, { value })}
                      ariaLabel={`Condition ${i + 1} value`}
                    />
                  )}
                  <button
                    type="button"
                    className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                    onClick={() => setConditions(form.entryCriteria.conditions.filter((_, j) => j !== i))}
                    aria-label={`Remove condition ${i + 1}`}
                  >
                    <X size={15} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                className={styles.addBtn}
                onClick={() =>
                  setConditions([
                    ...form.entryCriteria.conditions,
                    { field: '', operator: 'equals', value: '', valueType: 'literal' },
                  ])
                }
              >
                <Plus size={14} /> Add condition
              </button>
            </div>
          )}
        </section>

        {/* ── Steps ── */}
        <section className={styles.card}>
          <div>
            <h2 className={styles.cardTitle}>Approval steps</h2>
            <p className={styles.cardHint}>
              Steps run in order. Each approver is notified when their step starts; a rejection at any step ends the request.
            </p>
          </div>
          {errors.steps && <span className={styles.error}>{errors.steps}</span>}
          <div className={styles.rows}>
            {form.steps.map((s, i) => (
              <div key={i} className={styles.step}>
                <span className={styles.stepNumber}>{i + 1}</span>
                <div>
                  <div className={styles.stepFields}>
                    <label className={styles.field}>
                      <span className={styles.label}>Step name</span>
                      <input
                        className={styles.input}
                        value={s.name}
                        onChange={(e) => updateStep(i, { name: e.target.value })}
                        placeholder={`Step ${i + 1}`}
                      />
                    </label>
                    <label className={styles.field}>
                      <span className={styles.label}>Approved by</span>
                      <select
                        className={styles.select}
                        value={s.approverType}
                        onChange={(e) => updateStep(i, { approverType: e.target.value })}
                      >
                        {APPROVER_TYPES.map((t) => (
                          <option key={t.value} value={t.value}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    {s.approverType === 'user' && (
                      <label className={styles.field}>
                        <span className={styles.label}>User</span>
                        <select
                          className={styles.select}
                          value={s.approverUserId}
                          onChange={(e) => updateStep(i, { approverUserId: e.target.value })}
                        >
                          <option value="">— Select a user —</option>
                          {users.map((u) => (
                            <option key={u._id} value={u._id}>
                              {[u.firstName, u.lastName].filter(Boolean).join(' ') || u.email}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    {s.approverType === 'field' && (
                      <label className={styles.field}>
                        <span className={styles.label}>User field</span>
                        <select
                          className={styles.select}
                          value={s.approverFieldApiName}
                          onChange={(e) => updateStep(i, { approverFieldApiName: e.target.value })}
                          disabled={!form.objectApiName}
                        >
                          <option value="">{form.objectApiName ? '— Select a field —' : 'Choose an object first'}</option>
                          {userFields.map((f) => (
                            <option key={f.apiName} value={f.apiName}>
                              {f.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    {s.approverType === 'queue' && (
                      <label className={styles.field}>
                        <span className={styles.label}>Role</span>
                        <select
                          className={styles.select}
                          value={s.approverRoleId}
                          onChange={(e) => updateStep(i, { approverRoleId: e.target.value })}
                        >
                          <option value="">— Select a role —</option>
                          {roles.map((r) => (
                            <option key={r._id} value={r._id}>
                              {r.label || r.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    {s.approverType === 'manager' && (
                      <span className={styles.help} style={{ alignSelf: 'end', paddingBottom: 8 }}>
                        Uses the Manager set on the submitter's user record.
                      </span>
                    )}
                  </div>
                  {errors[`step_${i}`] && <span className={styles.error}>{errors[`step_${i}`]}</span>}
                </div>
                <div className={styles.stepTools}>
                  <button
                    type="button"
                    className={styles.iconBtn}
                    onClick={() => moveStep(i, -1)}
                    disabled={i === 0}
                    aria-label={`Move step ${i + 1} up`}
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    type="button"
                    className={styles.iconBtn}
                    onClick={() => moveStep(i, 1)}
                    disabled={i === form.steps.length - 1}
                    aria-label={`Move step ${i + 1} down`}
                  >
                    <ArrowDown size={14} />
                  </button>
                  <button
                    type="button"
                    className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                    onClick={() => setSteps(form.steps.filter((_, j) => j !== i))}
                    disabled={form.steps.length === 1}
                    aria-label={`Remove step ${i + 1}`}
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            ))}
            <button
              type="button"
              className={styles.addBtn}
              onClick={() => {
                setSteps([
                  ...form.steps,
                  { name: '', approverType: 'user', approverUserId: '', approverFieldApiName: '', approverRoleId: '' },
                ]);
                clearError('steps');
              }}
            >
              <Plus size={14} /> Add step
            </button>
          </div>
        </section>

        {/* ── Actions ── */}
        <section className={styles.card}>
          <div>
            <h2 className={styles.cardTitle}>Actions</h2>
            <p className={styles.cardHint}>
              Update fields and launch a flow at each stage. Flows receive the variables
              {' '}<code>approvalOutcome</code>, <code>approvalComment</code>, <code>approvalProcessName</code>
              {' '}and <code>approvalRequestId</code>, usable as <code>{'{approvalOutcome}'}</code> in flow text.
            </p>
          </div>
          {STAGES.map(({ key, title: stageTitle, hint }) => {
            const stage = form.actions[key];
            const selectedFlow = flows.find((f) => f._id === stage.flowId);
            return (
              <div key={key} className={styles.stage}>
                <div>
                  <h3 className={styles.stageTitle}>{stageTitle}</h3>
                  <p className={styles.cardHint}>{hint}</p>
                </div>

                <div className={styles.rows}>
                  {stage.fieldUpdates.map((u, i) => (
                    <div key={i} className={`${styles.row} ${styles.updateRow}`}>
                      <select
                        className={styles.select}
                        value={u.field}
                        onChange={(e) => updateFieldUpdate(key, i, { field: e.target.value, value: '' })}
                        aria-label={`${stageTitle}: field ${i + 1}`}
                      >
                        <option value="">— Set field —</option>
                        {writableFields.map((f) => (
                          <option key={f.apiName} value={f.apiName}>
                            {f.label}
                          </option>
                        ))}
                      </select>
                      <FieldValueInput
                        field={fieldByApi[u.field]}
                        value={u.value}
                        onChange={(value) => updateFieldUpdate(key, i, { value })}
                        ariaLabel={`${stageTitle}: value ${i + 1}`}
                      />
                      <button
                        type="button"
                        className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                        onClick={() =>
                          updateStage(key, { fieldUpdates: stage.fieldUpdates.filter((_, j) => j !== i) })
                        }
                        aria-label={`${stageTitle}: remove field update ${i + 1}`}
                      >
                        <X size={15} />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className={styles.addBtn}
                    disabled={!form.objectApiName}
                    onClick={() =>
                      updateStage(key, { fieldUpdates: [...stage.fieldUpdates, { field: '', value: '' }] })
                    }
                  >
                    <Plus size={14} /> {form.objectApiName ? 'Add field update' : 'Choose an object to add field updates'}
                  </button>
                </div>

                <div className={styles.grid2}>
                  <label className={styles.field}>
                    <span className={styles.label}>Launch flow</span>
                    <select
                      className={styles.select}
                      value={stage.flowId}
                      onChange={(e) => updateStage(key, { flowId: e.target.value })}
                    >
                      <option value="">No flow</option>
                      {launchableFlows.map((f) => (
                        <option key={f._id} value={f._id}>
                          {f.name}
                          {f.isActive ? '' : ' (inactive)'}
                        </option>
                      ))}
                    </select>
                    {selectedFlow && !selectedFlow.isActive && (
                      <span className={styles.error}>This flow is inactive and won't run until it's activated.</span>
                    )}
                  </label>
                </div>

                <div className={styles.stageOptions}>
                  {key === 'onSubmit' ? (
                    <label className={styles.check}>
                      <input
                        type="checkbox"
                        checked={stage.lockRecord}
                        onChange={(e) => updateStage(key, { lockRecord: e.target.checked })}
                      />
                      Lock the record against edits while it awaits approval
                    </label>
                  ) : form.actions.onSubmit.lockRecord ? (
                    <label className={styles.check}>
                      <input
                        type="checkbox"
                        checked={stage.unlockRecord}
                        onChange={(e) => updateStage(key, { unlockRecord: e.target.checked })}
                      />
                      Unlock the record
                    </label>
                  ) : null}
                </div>
              </div>
            );
          })}
        </section>

        <div className={styles.footerBar}>
          <Button variant="secondary" onClick={() => navigate('/setup/approval-processes')} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} loading={saving}>
            {isNew ? 'Create process' : 'Save changes'}
          </Button>
        </div>
      </div>
    </Layout>
  );
}
