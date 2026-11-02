import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { List, Plus, Pencil, Trash2, ToggleLeft, ToggleRight } from 'lucide-react';
import Layout from '../../layout/Layout';
import Button from '../../components/common/Button/Button';
import Modal from '../../components/common/Modal/Modal';
import {
  listGlobalValueSets,
  createGlobalValueSet,
  updateGlobalValueSet,
  deleteGlobalValueSet,
} from '../../services/api/globalValueSets';
import styles from '../Approvals/Approvals.module.css';
import local from './GlobalValueSets.module.css';

const BLANK_GVS = { label: '', name: '', description: '', values: [] };
const BLANK_VAL = { label: '', value: '', isDefault: false, isActive: true };

const toApiName = (str) =>
  str.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

export default function GlobalValueSets() {
  const qc = useQueryClient();
  const [editing, setEditing]   = useState(null); // null = closed, BLANK_GVS = new, obj = edit
  const [newVal, setNewVal]     = useState('');
  const [confirmDel, setConfirmDel] = useState(null);

  const { data: sets = [], isLoading } = useQuery({
    queryKey: ['global-value-sets'],
    queryFn: listGlobalValueSets,
  });

  const saveMutation = useMutation({
    mutationFn: (form) =>
      form._id
        ? updateGlobalValueSet(form._id, form)
        : createGlobalValueSet(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['global-value-sets'] });
      toast.success('Saved');
      setEditing(null);
    },
    onError: (e) => toast.error(e.response?.data?.message || e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: ({ id, force }) => deleteGlobalValueSet(id, force),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['global-value-sets'] });
      toast.success('Deleted');
      setConfirmDel(null);
    },
    onError: (e) => {
      const msg = e.response?.data?.message || e.message;
      if (msg.includes('field(s) reference')) {
        setConfirmDel((p) => ({ ...p, linkedError: msg }));
      } else {
        toast.error(msg);
        setConfirmDel(null);
      }
    },
  });

  // ── editor helpers ────────────────────────────────────────────
  const openNew  = () => setEditing({ ...BLANK_GVS });
  const openEdit = (gvs) => setEditing({ ...gvs });

  const setField = (key, val) =>
    setEditing((p) => {
      const next = { ...p, [key]: val };
      if (key === 'label' && !p._id) next.name = toApiName(val);
      return next;
    });

  const addValue = () => {
    const label = newVal.trim();
    if (!label) return;
    const value = toApiName(label) || label;
    setEditing((p) => ({
      ...p,
      values: [...(p.values || []), { ...BLANK_VAL, label, value }],
    }));
    setNewVal('');
  };

  const removeValue = (i) =>
    setEditing((p) => ({ ...p, values: p.values.filter((_, idx) => idx !== i) }));

  const toggleDefault = (i) =>
    setEditing((p) => ({
      ...p,
      values: p.values.map((v, idx) =>
        idx === i ? { ...v, isDefault: !v.isDefault } : { ...v, isDefault: false },
      ),
    }));

  const toggleActive = (i) =>
    setEditing((p) => ({
      ...p,
      values: p.values.map((v, idx) =>
        idx === i ? { ...v, isActive: !v.isActive } : v,
      ),
    }));

  const handleSave = () => {
    if (!editing.label) { toast.error('Label is required'); return; }
    if (!editing.name)  { toast.error('API Name is required'); return; }
    saveMutation.mutate(editing);
  };

  return (
    <Layout title="Global Value Sets" description="Reusable picklist value sets shared across fields and objects">
      <div className={styles.page}>
        <div className={styles.header}>
          <div>
            <h1 className={styles.title}>Global Value Sets</h1>
            <p className={styles.subtitle}>
              Shared picklist catalogues — editing a set updates every linked field automatically.
            </p>
          </div>
          <Button icon={<Plus size={15} />} onClick={openNew}>
            New Value Set
          </Button>
        </div>

        {isLoading ? (
          <div className={styles.loading}>Loading value sets…</div>
        ) : sets.length === 0 ? (
          <div className={styles.empty}>
            <List size={28} />
            <h3>No global value sets yet</h3>
            <p>Create one to share the same picklist values across fields and objects.</p>
            <Button icon={<Plus size={15} />} onClick={openNew}>
              New Value Set
            </Button>
          </div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Values</th>
                  <th>Status</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {sets.map((gvs) => {
                  const values = gvs.values || [];
                  const activeCount = values.filter((v) => v.isActive).length;
                  return (
                    <tr key={gvs._id}>
                      <td>
                        <div className={styles.nameCell}>
                          <button
                            type="button"
                            className={styles.nameLink}
                            style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', cursor: 'pointer', textAlign: 'left' }}
                            onClick={() => openEdit(gvs)}
                          >
                            {gvs.label}
                          </button>
                          <code className={local.code}>{gvs.name}</code>
                          {gvs.description && <span className={styles.muted}>{gvs.description}</span>}
                        </div>
                      </td>
                      <td>
                        {values.length === 0 ? (
                          <span className={styles.muted}>No values</span>
                        ) : (
                          <div className={local.chips}>
                            {values.map((v, i) => (
                              <span
                                key={i}
                                className={`${styles.badge} ${v.isActive ? '' : local.chipInactive}`}
                                title={v.isDefault ? 'Default value' : undefined}
                              >
                                {v.label}{v.isDefault ? ' ★' : ''}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td>
                        <span className={`${styles.badge} ${activeCount > 0 ? styles.badgeActive : ''}`}>
                          {activeCount} of {values.length} active
                        </span>
                      </td>
                      <td>
                        <div className={styles.rowActions}>
                          <button
                            type="button"
                            className={styles.iconBtn}
                            onClick={() => openEdit(gvs)}
                            title="Edit"
                            aria-label={`Edit ${gvs.label}`}
                          >
                            <Pencil size={15} />
                          </button>
                          <button
                            type="button"
                            className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                            onClick={() => setConfirmDel({ id: gvs._id, label: gvs.label })}
                            title="Delete"
                            aria-label={`Delete ${gvs.label}`}
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Create / Edit modal ─────────────────────────────────── */}
      {editing && (
        <Modal
          isOpen
          onClose={() => setEditing(null)}
          title={editing._id ? `Edit: ${editing.label}` : 'New Global Value Set'}
          size="lg"
          footer={
            <>
              <Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
              <Button onClick={handleSave} disabled={saveMutation.isPending}>
                {saveMutation.isPending ? 'Saving…' : 'Save'}
              </Button>
            </>
          }
        >
          <div className={styles.rows} style={{ gap: 'var(--spacing-4)' }}>
            <section className={styles.card}>
              <div>
                <h3 className={styles.cardTitle}>Details</h3>
                <p className={styles.cardHint}>How this value set is named and identified.</p>
              </div>
              <div className={`${styles.grid2} ${local.stack}`}>
                <label className={styles.field}>
                  <span className={styles.label}>Label *</span>
                  <input
                    className={styles.input}
                    value={editing.label}
                    onChange={(e) => setField('label', e.target.value)}
                    placeholder="e.g. SA Provinces"
                  />
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>API Name *</span>
                  <input
                    className={styles.input}
                    value={editing.name}
                    onChange={(e) => setField('name', e.target.value)}
                    disabled={!!editing._id}
                    placeholder="auto-generated"
                  />
                  {editing._id && <span className={styles.help}>The API name can't be changed after creation.</span>}
                </label>
              </div>
              <label className={styles.field}>
                <span className={styles.label}>Description</span>
                <input
                  className={styles.input}
                  value={editing.description || ''}
                  onChange={(e) => setField('description', e.target.value)}
                  placeholder="Optional note for other admins"
                />
              </label>
            </section>

            <section className={styles.card}>
              <div>
                <h3 className={styles.cardTitle}>Values</h3>
                <p className={styles.cardHint}>
                  ★ marks the default. Deactivating a value hides it from new records but keeps it on existing ones.
                </p>
              </div>

              <div className={local.addRow}>
                <input
                  className={`${styles.input} ${local.grow}`}
                  value={newVal}
                  onChange={(e) => setNewVal(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addValue())}
                  placeholder="New value label…"
                  aria-label="New value label"
                />
                <Button size="sm" icon={<Plus size={14} />} onClick={addValue}>Add</Button>
              </div>

              {(editing.values || []).length === 0 ? (
                <div className={styles.empty} style={{ padding: 'var(--spacing-6)' }}>
                  <p>No values yet. Add one above.</p>
                </div>
              ) : (
                <div className={`${styles.tableWrap} ${local.valuesWrap}`}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Label</th>
                        <th>API Value</th>
                        <th className={local.center}>Default</th>
                        <th className={local.center}>Active</th>
                        <th aria-label="Remove" />
                      </tr>
                    </thead>
                    <tbody>
                      {editing.values.map((v, i) => (
                        <tr key={i} className={v.isActive ? '' : local.inactiveRow}>
                          <td>{v.label}</td>
                          <td><code className={local.code}>{v.value}</code></td>
                          <td className={local.center}>
                            <button
                              type="button"
                              className={styles.iconBtn}
                              title={v.isDefault ? 'Remove default' : 'Set as default'}
                              aria-label={v.isDefault ? `Remove default from ${v.label}` : `Set ${v.label} as default`}
                              onClick={() => toggleDefault(i)}
                            >
                              <span className={`${local.star} ${v.isDefault ? local.starOn : ''}`}>★</span>
                            </button>
                          </td>
                          <td className={local.center}>
                            <button
                              type="button"
                              className={`${styles.iconBtn} ${v.isActive ? local.toggleOn : ''}`}
                              title={v.isActive ? 'Deactivate' : 'Activate'}
                              aria-label={v.isActive ? `Deactivate ${v.label}` : `Activate ${v.label}`}
                              onClick={() => toggleActive(i)}
                            >
                              {v.isActive ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                            </button>
                          </td>
                          <td>
                            <div className={styles.rowActions}>
                              <button
                                type="button"
                                className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                                title="Remove value"
                                aria-label={`Remove ${v.label}`}
                                onClick={() => removeValue(i)}
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        </Modal>
      )}

      {/* ── Delete confirm ──────────────────────────────────────── */}
      {confirmDel && (
        <Modal
          isOpen
          onClose={() => setConfirmDel(null)}
          title="Delete Value Set"
          size="sm"
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirmDel(null)}>Cancel</Button>
              {confirmDel.linkedError ? (
                <Button
                  variant="danger"
                  onClick={() => deleteMutation.mutate({ id: confirmDel.id, force: true })}
                  disabled={deleteMutation.isPending}
                >
                  Force Delete &amp; Unlink Fields
                </Button>
              ) : (
                <Button
                  variant="danger"
                  onClick={() => deleteMutation.mutate({ id: confirmDel.id, force: false })}
                  disabled={deleteMutation.isPending}
                >
                  Delete
                </Button>
              )}
            </>
          }
        >
          {confirmDel.linkedError ? (
            <p style={{ fontSize: 14 }}>
              {confirmDel.linkedError} Force-deleting will detach those fields (their copied values are kept).
            </p>
          ) : (
            <p style={{ fontSize: 14 }}>
              Delete <strong>{confirmDel.label}</strong>? This cannot be undone.
            </p>
          )}
        </Modal>
      )}
    </Layout>
  );
}
