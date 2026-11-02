import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom';
import { ArrowLeft, ArrowDown, ArrowUp, Plus, Save, Trash2, LayoutGrid } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../services/api';
import Button from '../../components/common/Button/Button';
import Layout from '../../layout/Layout';
import styles from './LayoutAssignment.module.css';

const OPERATORS = [
  { value: 'eq', label: 'equals' },
  { value: 'neq', label: 'does not equal' },
  { value: 'is_set', label: 'is set' },
  { value: 'is_blank', label: 'is blank' },
];
const needsValue = (op) => op === 'eq' || op === 'neq';
const PICKLIST_TYPES = new Set(['picklist', 'multipicklist']);

/**
 * Layout Assignment (BRD 4.2) — for each Role (Profile), the layout it sees for
 * this object by default, plus optional "use layout X instead when <field>
 * <condition>" rules. Rules are checked top to bottom; the first match wins and
 * the Role's default applies when none match. A new record shows the default
 * until it is saved with a matching value.
 */
export default function LayoutAssignment() {
  const { apiName } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const backTo = location.state?.from || `/setup/objects/${apiName}/layout`;

  const [objectMeta, setObjectMeta] = useState(null);
  const [fields, setFields] = useState([]);
  const [layouts, setLayouts] = useState([]);
  const [roles, setRoles] = useState([]);
  // { [roleId]: { defaultLayoutId: string, rules: [{ field, operator, value, layoutId }] } }
  const [config, setConfig] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const [objRes, layoutRes, roleRes, assignRes] = await Promise.all([
          api.get(`/objects/${apiName}`),
          api.get(`/layouts/${apiName}`, { params: { t: Date.now() } }),
          api.get('/roles'),
          api.get(`/layouts/${apiName}/assignments`, { params: { t: Date.now() } }),
        ]);
        const obj = objRes.data.data;
        setObjectMeta(obj);
        setFields(
          [...(obj.fields || [])]
            .filter((f) => !['formula', 'rollup_summary', 'auto_number'].includes(f.type))
            .sort((a, b) => (a.label || a.apiName).localeCompare(b.label || b.apiName)),
        );
        setLayouts(layoutRes.data.data || []);
        setRoles(roleRes.data.data || []);

        const next = {};
        (assignRes.data.data || []).forEach((a) => {
          next[String(a.roleId)] = {
            defaultLayoutId: a.defaultLayoutId ? String(a.defaultLayoutId) : '',
            rules: (a.rules || []).map((r) => ({
              field: r.field,
              operator: r.operator || 'eq',
              value: r.value || '',
              layoutId: String(r.layoutId),
            })),
          };
        });
        setConfig(next);
      } catch (err) {
        toast.error(err.response?.data?.message || 'Failed to load layout assignment.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [apiName]);

  const objectDefault = layouts.find((l) => l.isDefault) || null;
  const fieldByName = useMemo(
    () => Object.fromEntries(fields.map((f) => [f.apiName, f])),
    [fields],
  );
  // "Type" is the usual condition field, so new rules start on it.
  const suggestedField =
    fields.find((f) => f.apiName === 'type')?.apiName ||
    fields.find((f) => PICKLIST_TYPES.has(f.type))?.apiName ||
    fields[0]?.apiName ||
    '';

  const roleConfig = (roleId) => config[roleId] || { defaultLayoutId: '', rules: [] };

  const updateRole = (roleId, patch) => {
    setConfig((prev) => ({ ...prev, [roleId]: { ...roleConfig(roleId), ...prev[roleId], ...patch } }));
    setDirty(true);
  };

  const updateRule = (roleId, idx, patch) => {
    const rules = roleConfig(roleId).rules.map((r, i) => {
      if (i !== idx) return r;
      const next = { ...r, ...patch };
      // A new field's old value rarely makes sense; start the value over.
      if (patch.field && patch.field !== r.field) next.value = '';
      return next;
    });
    updateRole(roleId, { rules });
  };

  const addRule = (roleId) => {
    const firstOther = layouts.find((l) => !l.isDefault) || layouts[0];
    updateRole(roleId, {
      rules: [
        ...roleConfig(roleId).rules,
        { field: suggestedField, operator: 'eq', value: '', layoutId: firstOther?._id || '' },
      ],
    });
  };

  const moveRule = (roleId, idx, dir) => {
    const rules = [...roleConfig(roleId).rules];
    const to = idx + dir;
    if (to < 0 || to >= rules.length) return;
    [rules[idx], rules[to]] = [rules[to], rules[idx]];
    updateRole(roleId, { rules });
  };

  const removeRule = (roleId, idx) => {
    updateRole(roleId, { rules: roleConfig(roleId).rules.filter((_, i) => i !== idx) });
  };

  const problems = useMemo(() => {
    const list = [];
    roles.forEach((role) => {
      roleConfig(String(role._id)).rules.forEach((r, i) => {
        const where = `${role.label || role.name}, rule ${i + 1}`;
        if (!r.field) list.push(`${where}: choose a field.`);
        if (!r.layoutId) list.push(`${where}: choose a layout.`);
        if (needsValue(r.operator) && !String(r.value).trim()) list.push(`${where}: enter a value.`);
      });
    });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, roles]);

  const handleSave = async () => {
    if (problems.length) {
      toast.error(problems[0]);
      return;
    }
    setSaving(true);
    try {
      const assignments = roles.map((role) => {
        const c = roleConfig(String(role._id));
        return {
          roleId: role._id,
          defaultLayoutId: c.defaultLayoutId || null,
          rules: c.rules.map((r) => ({
            field: r.field,
            operator: r.operator,
            value: needsValue(r.operator) ? String(r.value).trim() : '',
            layoutId: r.layoutId,
          })),
        };
      });
      await api.put(`/layouts/${apiName}/assignments`, { assignments });
      setDirty(false);
      toast.success('Layout assignment saved.');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  const renderValueInput = (roleId, idx, rule) => {
    if (!needsValue(rule.operator)) return <span className={styles.noValue}>—</span>;
    const field = fieldByName[rule.field];
    const options = (field?.picklistValues || []).filter((pv) => pv.isActive !== false);
    if (PICKLIST_TYPES.has(field?.type) && options.length > 0) {
      return (
        <select
          aria-label="Value"
          value={rule.value}
          onChange={(e) => updateRule(roleId, idx, { value: e.target.value })}
        >
          <option value="">Choose a value…</option>
          {options.map((pv) => (
            <option key={pv.value} value={pv.value}>{pv.label || pv.value}</option>
          ))}
          {rule.value && !options.some((pv) => pv.value === rule.value) && (
            <option value={rule.value}>{rule.value} (no longer a picklist value)</option>
          )}
        </select>
      );
    }
    if (field?.type === 'boolean') {
      return (
        <select
          aria-label="Value"
          value={rule.value}
          onChange={(e) => updateRule(roleId, idx, { value: e.target.value })}
        >
          <option value="">Choose…</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      );
    }
    return (
      <input
        aria-label="Value"
        value={rule.value}
        placeholder="Value"
        onChange={(e) => updateRule(roleId, idx, { value: e.target.value })}
      />
    );
  };

  if (loading) {
    return (
      <Layout title="Layout Assignment">
        <div className={styles.loading}>Loading…</div>
      </Layout>
    );
  }

  return (
    <Layout title="Layout Assignment" description="Choose which page layout each role sees">
      <div className={styles.page}>
        <button onClick={() => navigate(backTo)} className={styles.backLink}>
          <ArrowLeft size={16} /> Back
        </button>

        <div className={styles.headerRow}>
          <div>
            <h1 className={styles.title}>Layout Assignment — {objectMeta?.label}</h1>
            <p className={styles.subtitle}>
              Each role sees its default layout. Add rules to switch to another layout when a
              record matches a condition, typically its Type. Rules are checked top to bottom
              and the first match wins. New records show the role's default layout until they
              are saved with a matching value.
            </p>
          </div>
          <div className={styles.headerActions}>
            <Link to={`/setup/objects/${apiName}/layout`}>
              <Button variant="secondary" size="sm" icon={<LayoutGrid size={14} />}>
                Edit Layouts
              </Button>
            </Link>
            <Button size="sm" icon={<Save size={14} />} loading={saving} onClick={handleSave} disabled={!dirty}>
              Save Assignment
            </Button>
          </div>
        </div>

        {layouts.length === 0 ? (
          <div className={styles.empty} data-testid="layout-assignment-empty">
            This object has no saved layouts yet. Create one in the{' '}
            <Link to={`/setup/objects/${apiName}/layout`}>Layout Builder</Link> first.
          </div>
        ) : (
          <div className={styles.roleList}>
            {roles.map((role) => {
              const roleId = String(role._id);
              const c = roleConfig(roleId);
              return (
                <section key={roleId} className={styles.roleCard} data-testid={`role-${role.name}`}>
                  <div className={styles.roleHead}>
                    <div>
                      <h2 className={styles.roleName}>{role.label || role.name}</h2>
                      {role.description && <p className={styles.roleDesc}>{role.description}</p>}
                    </div>
                    <label className={styles.defaultPick}>
                      <span>Default layout</span>
                      <select
                        aria-label={`Default layout for ${role.label || role.name}`}
                        value={c.defaultLayoutId}
                        onChange={(e) => updateRole(roleId, { defaultLayoutId: e.target.value })}
                      >
                        <option value="">
                          Object default{objectDefault ? ` (${objectDefault.name})` : ''}
                        </option>
                        {layouts.map((l) => (
                          <option key={l._id} value={l._id}>{l.name}</option>
                        ))}
                      </select>
                    </label>
                  </div>

                  {c.rules.length > 0 && (
                    <ol className={styles.rules}>
                      {c.rules.map((rule, idx) => (
                        <li key={idx} className={styles.rule}>
                          <span className={styles.ruleNo}>{idx + 1}</span>
                          <span className={styles.ruleWord}>When</span>
                          <select
                            aria-label="Field"
                            value={rule.field}
                            onChange={(e) => updateRule(roleId, idx, { field: e.target.value })}
                          >
                            {fields.map((f) => (
                              <option key={f.apiName} value={f.apiName}>{f.label || f.apiName}</option>
                            ))}
                          </select>
                          <select
                            aria-label="Condition"
                            value={rule.operator}
                            onChange={(e) => updateRule(roleId, idx, { operator: e.target.value })}
                          >
                            {OPERATORS.map((o) => (
                              <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                          </select>
                          {renderValueInput(roleId, idx, rule)}
                          <span className={styles.ruleWord}>use</span>
                          <select
                            aria-label="Layout"
                            value={rule.layoutId}
                            onChange={(e) => updateRule(roleId, idx, { layoutId: e.target.value })}
                          >
                            <option value="">Choose a layout…</option>
                            {layouts.map((l) => (
                              <option key={l._id} value={l._id}>{l.name}</option>
                            ))}
                          </select>
                          <span className={styles.ruleTools}>
                            <button type="button" title="Move up" aria-label="Move rule up" disabled={idx === 0} onClick={() => moveRule(roleId, idx, -1)}>
                              <ArrowUp size={14} />
                            </button>
                            <button type="button" title="Move down" aria-label="Move rule down" disabled={idx === c.rules.length - 1} onClick={() => moveRule(roleId, idx, 1)}>
                              <ArrowDown size={14} />
                            </button>
                            <button type="button" title="Remove rule" aria-label="Remove rule" onClick={() => removeRule(roleId, idx)}>
                              <Trash2 size={14} />
                            </button>
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}

                  <div className={styles.roleFoot}>
                    <Button variant="ghost" size="sm" icon={<Plus size={14} />} onClick={() => addRule(roleId)} disabled={fields.length === 0}>
                      Add conditional rule
                    </Button>
                    {c.rules.length > 0 && (
                      <span className={styles.fallbackNote}>
                        Otherwise: {layouts.find((l) => l._id === c.defaultLayoutId)?.name || objectDefault?.name || 'the object default'}
                      </span>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </Layout>
  );
}
