import { useEffect, useState, useCallback } from 'react';
import { Share2, Plus, Trash2, Save } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../../services/api';
import AdminSettingsPage from '../AdminSettingsPage';
import styles from './SharingSettings.module.css';

const OWD_OPTIONS = [
  { value: 'private', label: 'Private' },
  { value: 'public_read_only', label: 'Public Read-Only' },
  { value: 'public_read_write', label: 'Public Read-Write' },
];

const OPERATORS = ['eq', 'ne', 'in', 'contains', 'startsWith', 'gt', 'lt', 'gte', 'lte'];

const emptyRule = () => ({
  objectApiName: '',
  name: '',
  description: '',
  ruleType: 'criteria',
  criteria: [{ field: 'type', operator: 'eq', value: '' }],
  targetType: 'group',
  targetId: '',
  accessLevel: 'read',
  isActive: true,
});

export default function SharingSettings() {
  const [objects, setObjects] = useState([]);
  const [rules, setRules] = useState([]);
  const [targets, setTargets] = useState({ roles: [], groups: [], users: [] });
  const [loading, setLoading] = useState(true);
  const [savingOwd, setSavingOwd] = useState('');
  const [form, setForm] = useState(emptyRule());
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [settingsRes, rulesRes, targetsRes] = await Promise.all([
        api.get('/sharing/settings'),
        api.get('/sharing/rules'),
        api.get('/sharing/targets'),
      ]);
      setObjects(settingsRes.data.data || []);
      setRules(rulesRes.data.data || []);
      setTargets(targetsRes.data.data || { roles: [], groups: [], users: [] });
      setForm((f) => ({ ...f, objectApiName: f.objectApiName || settingsRes.data.data?.[0]?.objectApiName || '' }));
    } catch {
      toast.error('Could not load sharing settings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const changeOwd = async (objectApiName, orgWideDefault) => {
    setSavingOwd(objectApiName);
    try {
      await api.put(`/sharing/settings/${objectApiName}`, { orgWideDefault });
      setObjects((prev) =>
        prev.map((o) => (o.objectApiName === objectApiName ? { ...o, orgWideDefault, configured: true } : o)),
      );
      toast.success('Org-wide default saved.');
    } catch {
      toast.error('Could not save org-wide default.');
    } finally {
      setSavingOwd('');
    }
  };

  const updateCriterion = (index, patch) => {
    setForm((f) => ({
      ...f,
      criteria: f.criteria.map((c, i) => (i === index ? { ...c, ...patch } : c)),
    }));
  };

  const addCriterion = () =>
    setForm((f) => ({ ...f, criteria: [...f.criteria, { field: '', operator: 'eq', value: '' }] }));

  const removeCriterion = (index) =>
    setForm((f) => ({ ...f, criteria: f.criteria.filter((_, i) => i !== index) }));

  const submitRule = async (e) => {
    e.preventDefault();
    if (!form.objectApiName || !form.name.trim() || !form.targetId) {
      toast.error('Object, name and sharing target are required.');
      return;
    }
    if (form.ruleType === 'criteria' && !form.criteria.some((c) => c.field.trim())) {
      toast.error('Add at least one criterion or choose “All records”.');
      return;
    }
    setCreating(true);
    try {
      await api.post('/sharing/rules', {
        objectApiName: form.objectApiName,
        name: form.name,
        description: form.description,
        ruleType: form.ruleType,
        criteria: form.ruleType === 'criteria' ? form.criteria.filter((c) => c.field) : [],
        sharedWith: { type: form.targetType, id: form.targetId },
        accessLevel: form.accessLevel,
        isActive: form.isActive,
      });
      toast.success('Sharing rule created.');
      setForm({ ...emptyRule(), objectApiName: form.objectApiName });
      load();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Could not create sharing rule.');
    } finally {
      setCreating(false);
    }
  };

  const toggleRule = async (rule) => {
    try {
      await api.put(`/sharing/rules/${rule._id}`, { isActive: !rule.isActive });
      setRules((prev) => prev.map((r) => (r._id === rule._id ? { ...r, isActive: !r.isActive } : r)));
    } catch {
      toast.error('Could not update rule.');
    }
  };

  const deleteRule = async (rule) => {
    if (!window.confirm(`Delete sharing rule "${rule.name}"?`)) return;
    try {
      await api.delete(`/sharing/rules/${rule._id}`);
      setRules((prev) => prev.filter((r) => r._id !== rule._id));
      toast.success('Sharing rule deleted.');
    } catch {
      toast.error('Could not delete rule.');
    }
  };

  const targetOptions = [
    ...(targets.groups || []).map((g) => ({ ...g, type: 'group', label: `Group · ${g.label}` })),
    ...(targets.roles || []).map((r) => ({ ...r, type: 'role', label: `Team · ${r.label}` })),
    ...(targets.users || []).map((u) => ({ ...u, type: 'user', label: `User · ${u.name}` })),
  ];
  const targetLabel = (rule) => targetOptions.find(
    (t) => t.type === rule.sharedWith?.type && String(t.id) === String(rule.sharedWith?.id?._id || rule.sharedWith?.id),
  )?.label || rule.sharedWith?.type;

  return (
    <AdminSettingsPage
      title="Sharing Settings"
      description="Set the org-wide default for each object and grant extra access with sharing rules."
      icon={Share2}
      iconColor="#0ea5e9"
    >
      <section className={styles.panel}>
        <h2 className={styles.heading}>Org-Wide Defaults</h2>
        <p className={styles.hint}>
          The baseline visibility for every record on an object. Private means owners,
          their managers and explicitly shared users only.
        </p>
        {loading ? <p className={styles.hint}>Loading…</p> : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr><th>Object</th><th>Default record visibility</th></tr>
              </thead>
              <tbody>
                {objects.map((o) => (
                  <tr key={o.objectApiName}>
                    <td>
                      <strong>{o.label}</strong>
                      <span className={styles.apiName}>{o.objectApiName}</span>
                    </td>
                    <td>
                      <select
                        className={styles.select}
                        value={o.orgWideDefault}
                        disabled={savingOwd === o.objectApiName}
                        onChange={(e) => changeOwd(o.objectApiName, e.target.value)}
                      >
                        {OWD_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={styles.panel}>
        <h2 className={styles.heading}>Sharing Rules</h2>
        <p className={styles.hint}>
          Share matching records with a Team, Public Group or user. Rules add to the
          org-wide default.
        </p>

        <form className={styles.form} onSubmit={submitRule}>
          <div className={styles.grid}>
            <label className={styles.field}>
              <span>Object</span>
              <select className={styles.select} value={form.objectApiName}
                onChange={(e) => setForm((f) => ({ ...f, objectApiName: e.target.value }))}>
                {objects.map((o) => <option key={o.objectApiName} value={o.objectApiName}>{o.label}</option>)}
              </select>
            </label>
            <label className={styles.field}>
              <span>Rule name</span>
              <input className={styles.input} value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Funeral policies to Funeral Team" />
            </label>
            <label className={styles.field}>
              <span>Share with</span>
              <select className={styles.select} value={`${form.targetType}:${form.targetId}`}
                onChange={(e) => {
                  const [type, ...id] = e.target.value.split(':');
                  setForm((f) => ({ ...f, targetType: type, targetId: id.join(':') }));
                }}>
                <option value="group:">Select a Team, Group or user…</option>
                {['group', 'role', 'user'].map((type) => (
                  <optgroup key={type} label={type === 'role' ? 'Teams' : type === 'group' ? 'Public Groups' : 'Users'}>
                    {targetOptions.filter((t) => t.type === type).map((t) => (
                      <option key={`${t.type}:${t.id}`} value={`${t.type}:${t.id}`}>{t.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span>Access level</span>
              <select className={styles.select} value={form.accessLevel}
                onChange={(e) => setForm((f) => ({ ...f, accessLevel: e.target.value }))}>
                <option value="read">Read-Only</option>
                <option value="readWrite">Read-Write</option>
              </select>
            </label>
            <label className={styles.field}>
              <span>Match</span>
              <select className={styles.select} value={form.ruleType}
                onChange={(e) => setForm((f) => ({ ...f, ruleType: e.target.value }))}>
                <option value="criteria">Records matching criteria</option>
                <option value="all">All records</option>
              </select>
            </label>
          </div>

          {form.ruleType === 'criteria' && (
            <div className={styles.criteria}>
              <span className={styles.criteriaLabel}>Criteria</span>
              {form.criteria.map((c, i) => (
                <div key={i} className={styles.criteriaRow}>
                  <input className={styles.input} placeholder="field (e.g. type)" value={c.field}
                    onChange={(e) => updateCriterion(i, { field: e.target.value })} />
                  <select className={styles.select} value={c.operator}
                    onChange={(e) => updateCriterion(i, { operator: e.target.value })}>
                    {OPERATORS.map((op) => <option key={op} value={op}>{op}</option>)}
                  </select>
                  <input className={styles.input} placeholder="value (e.g. Funeral)" value={c.value}
                    onChange={(e) => updateCriterion(i, { value: e.target.value })} />
                  <button type="button" className={styles.iconBtn} onClick={() => removeCriterion(i)} title="Remove criterion">
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
              <button type="button" className={styles.secondaryBtn} onClick={addCriterion}>
                <Plus size={14} /> Add criterion
              </button>
            </div>
          )}

          <label className={styles.checkboxRow}>
            <input type="checkbox" checked={form.isActive}
              onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} />
            Active
          </label>

          <button type="submit" className={styles.primaryBtn} disabled={creating}>
            <Save size={15} /> {creating ? 'Creating…' : 'Create sharing rule'}
          </button>
        </form>

        {rules.length === 0 ? (
          <p className={styles.hint}>No sharing rules yet.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr><th>Rule</th><th>Object</th><th>Shared with</th><th>Access</th><th>Status</th><th /></tr>
              </thead>
              <tbody>
                {rules.map((rule) => (
                  <tr key={rule._id}>
                    <td>
                      <strong>{rule.name}</strong>
                      <span className={styles.apiName}>
                        {rule.ruleType === 'all' ? 'All records' : (rule.criteria || []).map((c) => `${c.field} ${c.operator} ${c.value}`).join(' AND ')}
                      </span>
                    </td>
                    <td>{rule.objectApiName}</td>
                    <td>{targetLabel(rule)}</td>
                    <td>{rule.accessLevel === 'readWrite' ? 'Read-Write' : 'Read-Only'}</td>
                    <td>
                      <button type="button" className={styles.linkBtn} onClick={() => toggleRule(rule)}>
                        {rule.isActive ? 'Active' : 'Inactive'}
                      </button>
                    </td>
                    <td>
                      <button type="button" className={styles.iconBtn} onClick={() => deleteRule(rule)} title="Delete rule">
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AdminSettingsPage>
  );
}
