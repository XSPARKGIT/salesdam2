import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { formatDistanceToNow } from 'date-fns';
import { CopyCheck, Plus, Pencil, Trash2, Power, X } from 'lucide-react';
import Layout from '../../layout/Layout';
import Button from '../../components/common/Button/Button';
import Modal from '../../components/common/Modal/Modal';
import { useTenantContext } from '../../context/TenantContext';
import { getFields, getAllFields } from '../../services/api/objects';
import {
  getDuplicateRules,
  createDuplicateRule,
  updateDuplicateRule,
  deleteDuplicateRule,
} from '../../services/api/duplicateRules';
import { getAutomations } from '../../services/api/automations';
import styles from '../Approvals/Approvals.module.css';

const MATCH_TYPES = [
  { value: 'normalized', label: 'Ignore case and spacing' },
  { value: 'exact', label: 'Exact match' },
];

const ON_MATCH = [
  { value: 'warn', label: 'Warn — show the matches, allow saving anyway' },
  { value: 'block', label: "Block — show the matches, don't allow saving" },
  { value: 'present_matches', label: 'Present matches — force the user to pick an existing record' },
  { value: 'use_existing', label: 'Use existing — return the existing record' },
  { value: 'trigger_flow', label: 'Trigger flow — fire an automation on match' },
];
const WARN_ALIASES = new Set([]);

// Fields whose values make poor match keys (computed, long text, yes/no…).
const UNMATCHABLE_TYPES = new Set([
  'formula',
  'rollup_summary',
  'auto_number',
  'textarea',
  'richtext',
  'boolean',
  'multipicklist',
  'address',
]);

const EMPTY = {
  name: '',
  objectApiName: '',
  active: true,
  logic: 'AND',
  onMatch: 'warn',
  flowId: '',
  conditions: [{ field: '', matchType: 'normalized' }],
};

const toForm = (rule) => ({
  name: rule.name || '',
  objectApiName: rule.objectApiName || '',
  active: rule.active !== false,
  logic: rule.logic || 'AND',
  onMatch: rule.onMatch || 'warn',
  flowId: rule.flowId || '',
  conditions: (rule.conditions || []).map((c) => ({
    field: c.field,
    matchType: c.matchType || 'normalized',
  })),
});

const onMatchLabel = (value) => {
  if (value === 'block') return 'Block';
  if (value === 'present_matches') return 'Present matches';
  if (value === 'use_existing') return 'Use existing';
  if (value === 'trigger_flow') return 'Trigger flow';
  if (value === 'allow') return 'Do nothing';
  return 'Warn';
};

/** Editor dialog for one rule. Mounted fresh (keyed) for each rule. */
function RuleDialog({ rule, objects, onClose, onSaved }) {
  const isNew = !rule?._id;
  const [form, setForm] = useState(rule?._id ? toForm(rule) : EMPTY);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const { data: fields = [] } = useQuery({
    queryKey: ['fields', form.objectApiName],
    queryFn: () => getFields(form.objectApiName),
    enabled: !!form.objectApiName,
  });

  const { data: automations = [] } = useQuery({
    queryKey: ['automations-list'],
    queryFn: () => getAutomations({ limit: 200 }),
  });
  const matchableFields = useMemo(
    () =>
      fields
        .filter((f) => !UNMATCHABLE_TYPES.has(f.type))
        .sort((a, b) => (a.label || '').localeCompare(b.label || '')),
    [fields],
  );

  const set = (patch) => setForm((prev) => ({ ...prev, ...patch }));
  const setConditions = (conditions) => {
    set({ conditions });
    setErrors((e) => ({ ...e, conditions: undefined }));
  };
  const updateCondition = (i, patch) =>
    setConditions(form.conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  const save = async () => {
    const errs = {};
    if (!form.name.trim()) errs.name = 'Give the rule a name.';
    if (!form.objectApiName) errs.objectApiName = 'Choose the object to check.';
    const conditions = form.conditions.filter((c) => c.field);
    if (conditions.length === 0) errs.conditions = 'Choose at least one field to match on.';
    else if (new Set(conditions.map((c) => c.field)).size !== conditions.length) {
      errs.conditions = 'Each field can only be used once.';
    }
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setSaving(true);
    try {
      if (form.onMatch === 'trigger_flow' && !form.flowId) {
        setErrors((e) => ({ ...e, flowId: 'Choose an automation to trigger.' }));
        setSaving(false);
        return;
      }
      const payload = {
        name: form.name.trim(),
        objectApiName: form.objectApiName,
        active: form.active,
        logic: form.logic,
        onMatch: form.onMatch,
        conditions,
        ...(form.onMatch === 'trigger_flow' ? { flowId: form.flowId } : { flowId: null }),
      };
      if (isNew) await createDuplicateRule(payload);
      else await updateDuplicateRule(rule._id, payload);
      toast.success(isNew ? 'Duplicate rule created.' : 'Duplicate rule saved.');
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save the rule.');
    } finally {
      setSaving(false);
    }
  };

  const usedFields = new Set(form.conditions.map((c) => c.field).filter(Boolean));
  const onMatchOptions = WARN_ALIASES.has(form.onMatch)
    ? [...ON_MATCH, { value: form.onMatch, label: `${form.onMatch} (behaves as Warn)` }]
    : ON_MATCH;

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={isNew ? 'New duplicate rule' : 'Edit duplicate rule'}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving}>
            {isNew ? 'Create rule' : 'Save changes'}
          </Button>
        </>
      }
    >
      <div className={styles.rows} style={{ gap: 'var(--spacing-4)' }}>
        <div className={styles.grid2}>
          <label className={styles.field}>
            <span className={styles.label}>Name</span>
            <input
              className={styles.input}
              value={form.name}
              onChange={(e) => {
                set({ name: e.target.value });
                setErrors((x) => ({ ...x, name: undefined }));
              }}
              placeholder="e.g. Same email address"
              maxLength={120}
              autoFocus
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
                // Field choices belong to the old object.
                set({ objectApiName: e.target.value, conditions: [{ field: '', matchType: 'normalized' }] });
                setErrors((x) => ({ ...x, objectApiName: undefined }));
              }}
            >
              <option value="">— Select an object —</option>
              {objects.map((o) => (
                <option key={o.apiName} value={o.apiName}>
                  {o.label}
                </option>
              ))}
            </select>
            {!isNew && <span className={styles.help}>The object can't be changed after creation.</span>}
            {errors.objectApiName && <span className={styles.error}>{errors.objectApiName}</span>}
          </label>
        </div>

        <div className={styles.field}>
          <div className={styles.cardHeader}>
            <span className={styles.label}>A record is a duplicate when</span>
            {form.conditions.length > 1 && (
              <label className={styles.logic}>
                <select
                  className={styles.select}
                  style={{ width: 'auto' }}
                  value={form.logic}
                  onChange={(e) => set({ logic: e.target.value })}
                  aria-label="Combine conditions"
                >
                  <option value="AND">all of these match</option>
                  <option value="OR">any of these match</option>
                </select>
              </label>
            )}
          </div>
          {!form.objectApiName ? (
            <p className={styles.help}>Choose an object first.</p>
          ) : (
            <div className={styles.rows}>
              {form.conditions.map((c, i) => (
                <div key={i} className={`${styles.row} ${styles.updateRow}`}>
                  <select
                    className={styles.select}
                    value={c.field}
                    onChange={(e) => updateCondition(i, { field: e.target.value })}
                    aria-label={`Match field ${i + 1}`}
                  >
                    <option value="">— Field —</option>
                    {matchableFields.map((f) => (
                      <option key={f.apiName} value={f.apiName} disabled={usedFields.has(f.apiName) && f.apiName !== c.field}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                  <select
                    className={styles.select}
                    value={c.matchType}
                    onChange={(e) => updateCondition(i, { matchType: e.target.value })}
                    aria-label={`Match type ${i + 1}`}
                  >
                    {MATCH_TYPES.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                    onClick={() => setConditions(form.conditions.filter((_, j) => j !== i))}
                    disabled={form.conditions.length === 1}
                    aria-label={`Remove field ${i + 1}`}
                  >
                    <X size={15} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                className={styles.addBtn}
                onClick={() => setConditions([...form.conditions, { field: '', matchType: 'normalized' }])}
              >
                <Plus size={14} /> Add field
              </button>
              <span className={styles.help}>
                {form.logic === 'AND' && form.conditions.length > 1
                  ? 'A record is only checked when every one of these fields has a value.'
                  : 'Empty fields are never treated as a match.'}
              </span>
            </div>
          )}
          {errors.conditions && <span className={styles.error}>{errors.conditions}</span>}
        </div>

        <label className={styles.field}>
          <span className={styles.label}>When a duplicate is found</span>
          <select className={styles.select} value={form.onMatch} onChange={(e) => set({ onMatch: e.target.value, flowId: '' })}>
            {onMatchOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <span className={styles.help}>
            Applies to records saved from forms, imports and the API.
          </span>
        </label>

        {form.onMatch === 'trigger_flow' && (
          <label className={styles.field}>
            <span className={styles.label}>Automation to trigger</span>
            <select
              className={styles.select}
              value={form.flowId}
              onChange={(e) => { set({ flowId: e.target.value }); setErrors((x) => ({ ...x, flowId: undefined })); }}
            >
              <option value="">— Select an automation —</option>
              {automations.map((a) => (
                <option key={a._id} value={a._id}>{a.name}</option>
              ))}
            </select>
            {errors.flowId && <span className={styles.error}>{errors.flowId}</span>}
            <span className={styles.help}>
              The automation will receive the incoming and matched record data as context.
            </span>
          </label>
        )}

        <label className={styles.check}>
          <input type="checkbox" checked={form.active} onChange={(e) => set({ active: e.target.checked })} />
          Active
        </label>
      </div>
    </Modal>
  );
}

/**
 * Setup › Duplicate Rules — which fields identify a duplicate record per
 * object, and whether a match warns or blocks the save (Core BRD §3.4).
 */
export default function DuplicateRules() {
  const queryClient = useQueryClient();
  const { objects } = useTenantContext();
  const [editing, setEditing] = useState(null); // null | {} (new) | rule

  const sortedObjects = useMemo(
    () => [...(objects || [])].sort((a, b) => (a.label || '').localeCompare(b.label || '')),
    [objects],
  );
  const objectLabel = (apiName) => objects?.find((o) => o.apiName === apiName)?.label || apiName;

  const { data: rules = [], isLoading } = useQuery({
    queryKey: ['duplicate-rules'],
    queryFn: () => getDuplicateRules(),
    staleTime: 0,
  });
  const { data: allFields = [] } = useQuery({
    queryKey: ['all-fields'],
    queryFn: getAllFields,
  });
  const fieldLabel = (objectApiName, apiName) =>
    allFields.find((f) => f.objectApiName === objectApiName && f.apiName === apiName)?.label || apiName;

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['duplicate-rules'] });

  const toggle = useMutation({
    mutationFn: (r) => updateDuplicateRule(r._id, { active: !r.active }),
    onSuccess: (r) => {
      toast.success(r.active ? 'Rule activated.' : 'Rule deactivated.');
      refresh();
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to update the rule.'),
  });

  const remove = useMutation({
    mutationFn: (r) => deleteDuplicateRule(r._id),
    onSuccess: () => {
      toast.success('Rule deleted.');
      refresh();
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to delete the rule.'),
  });

  const describe = (r) =>
    (r.conditions || [])
      .map((c) => `${fieldLabel(r.objectApiName, c.field)}${c.matchType === 'exact' ? ' (exact)' : ''}`)
      .join(r.logic === 'OR' ? ' or ' : ' and ');

  return (
    <Layout title="Duplicate Rules" description="Configure duplicate detection">
      <div className={styles.page}>
        <div className={styles.header}>
          <div>
            <h1 className={styles.title}>Duplicate Rules</h1>
            <p className={styles.subtitle}>
              Decide which fields identify the same customer, contact or other record. When someone saves a
              record that matches an existing one, they see the matches and can open them — and, depending on
              the rule, save anyway or be stopped.
            </p>
          </div>
          <Button icon={<Plus size={15} />} onClick={() => setEditing({})}>
            New rule
          </Button>
        </div>

        {isLoading ? (
          <div className={styles.loading}>Loading duplicate rules…</div>
        ) : rules.length === 0 ? (
          <div className={styles.empty}>
            <CopyCheck size={28} />
            <h3>No duplicate rules yet</h3>
            <p>Create one — for example "same email address" on Contacts — to catch duplicates before they're saved.</p>
            <Button icon={<Plus size={15} />} onClick={() => setEditing({})}>
              New rule
            </Button>
          </div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Object</th>
                  <th>Matches on</th>
                  <th>On match</th>
                  <th>Status</th>
                  <th>Updated</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r._id}>
                    <td>
                      <button
                        type="button"
                        className={styles.nameLink}
                        style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', cursor: 'pointer', textAlign: 'left' }}
                        onClick={() => setEditing(r)}
                      >
                        {r.name}
                      </button>
                    </td>
                    <td>{objectLabel(r.objectApiName)}</td>
                    <td>{describe(r)}</td>
                    <td>
                      <span className={`${styles.badge} ${r.onMatch === 'block' ? styles.badgeWarn : ''}`}>
                        {onMatchLabel(r.onMatch)}
                      </span>
                    </td>
                    <td>
                      <span className={`${styles.badge} ${r.active ? styles.badgeActive : ''}`}>
                        {r.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className={styles.muted}>
                      {r.updatedAt ? formatDistanceToNow(new Date(r.updatedAt), { addSuffix: true }) : '—'}
                    </td>
                    <td>
                      <div className={styles.rowActions}>
                        <button
                          type="button"
                          className={styles.iconBtn}
                          onClick={() => toggle.mutate(r)}
                          title={r.active ? 'Deactivate' : 'Activate'}
                          aria-label={r.active ? `Deactivate ${r.name}` : `Activate ${r.name}`}
                          disabled={toggle.isPending}
                        >
                          <Power size={15} />
                        </button>
                        <button
                          type="button"
                          className={styles.iconBtn}
                          onClick={() => setEditing(r)}
                          title="Edit"
                          aria-label={`Edit ${r.name}`}
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          type="button"
                          className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                          onClick={() => {
                            if (window.confirm(`Delete "${r.name}"? Records will no longer be checked against it.`)) {
                              remove.mutate(r);
                            }
                          }}
                          title="Delete"
                          aria-label={`Delete ${r.name}`}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <RuleDialog
          key={editing._id || 'new'}
          rule={editing}
          objects={sortedObjects}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}
    </Layout>
  );
}
