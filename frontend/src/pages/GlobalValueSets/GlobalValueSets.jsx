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
          <Button onClick={openNew}>
            <Plus size={16} /> New Value Set
          </Button>
        </div>

        {isLoading ? (
          <p style={{ color: 'var(--color-gray-500)', padding: '24px 0' }}>Loading…</p>
        ) : sets.length === 0 ? (
          <div className={styles.empty}>
            <List size={32} style={{ opacity: 0.3 }} />
            <p>No global value sets yet. Create one to share picklist values across fields.</p>
          </div>
        ) : (
          <div className={styles.ruleList}>
            {sets.map((gvs) => (
              <div key={gvs._id} className={styles.ruleCard}>
                <div className={styles.ruleCardMain}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 600, fontSize: 14 }}>{gvs.label}</span>
                      <code style={{ fontSize: 11, color: 'var(--color-gray-400)', background: 'var(--color-gray-100)', padding: '1px 6px', borderRadius: 4 }}>{gvs.name}</code>
                    </div>
                    {gvs.description && (
                      <p style={{ fontSize: 13, color: 'var(--color-gray-500)', margin: '2px 0 0' }}>{gvs.description}</p>
                    )}
                    <p style={{ fontSize: 12, color: 'var(--color-gray-400)', margin: '2px 0 0' }}>
                      {(gvs.values || []).length} value{(gvs.values || []).length !== 1 ? 's' : ''} ·{' '}
                      {(gvs.values || []).filter((v) => v.isActive).length} active
                    </p>
                  </div>
                  <div className={styles.ruleActions}>
                    <button className={styles.iconBtn} onClick={() => openEdit(gvs)} title="Edit">
                      <Pencil size={15} />
                    </button>
                    <button
                      className={`${styles.iconBtn} ${styles.danger}`}
                      onClick={() => setConfirmDel({ id: gvs._id, label: gvs.label })}
                      title="Delete"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>

                {(gvs.values || []).length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                    {gvs.values.map((v, i) => (
                      <span
                        key={i}
                        style={{
                          fontSize: 12,
                          padding: '2px 10px',
                          borderRadius: 999,
                          background: v.isActive ? 'var(--color-primary-50, #eff6ff)' : 'var(--color-gray-100)',
                          color: v.isActive ? 'var(--color-primary-700, #1d4ed8)' : 'var(--color-gray-400)',
                          border: `1px solid ${v.isActive ? 'var(--color-primary-200, #bfdbfe)' : 'var(--color-gray-200)'}`,
                          textDecoration: v.isActive ? 'none' : 'line-through',
                        }}
                      >
                        {v.label}{v.isDefault ? ' ★' : ''}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={{ fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 4 }}>Label *</label>
                <input
                  className={styles.input}
                  value={editing.label}
                  onChange={(e) => setField('label', e.target.value)}
                  placeholder="e.g. SA Provinces"
                />
              </div>
              <div>
                <label style={{ fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 4 }}>API Name *</label>
                <input
                  className={styles.input}
                  value={editing.name}
                  onChange={(e) => setField('name', e.target.value)}
                  disabled={!!editing._id}
                  style={editing._id ? { background: 'var(--color-gray-50)', color: 'var(--color-gray-400)', cursor: 'default' } : {}}
                  placeholder="auto-generated"
                />
              </div>
            </div>

            <div>
              <label style={{ fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 4 }}>Description</label>
              <input
                className={styles.input}
                value={editing.description || ''}
                onChange={(e) => setField('description', e.target.value)}
                placeholder="Optional note for other admins"
              />
            </div>

            <div>
              <label style={{ fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 8 }}>Values</label>

              {/* Add new value */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <input
                  className={styles.input}
                  value={newVal}
                  onChange={(e) => setNewVal(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addValue())}
                  placeholder="New value label…"
                  style={{ flex: 1 }}
                />
                <Button size="sm" onClick={addValue}>Add</Button>
              </div>

              {/* Value list */}
              {(editing.values || []).length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--color-gray-400)', textAlign: 'center', padding: '12px 0' }}>
                  No values yet. Add one above.
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 280, overflowY: 'auto' }}>
                  {editing.values.map((v, i) => (
                    <div
                      key={i}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '6px 10px',
                        borderRadius: 6,
                        border: '1px solid var(--color-gray-200)',
                        background: v.isActive ? 'var(--color-gray-50)' : 'transparent',
                        opacity: v.isActive ? 1 : 0.5,
                      }}
                    >
                      <span style={{ flex: 1, fontSize: 14 }}>{v.label}</span>
                      <code style={{ fontSize: 11, color: 'var(--color-gray-400)' }}>{v.value}</code>

                      {/* Default star */}
                      <button
                        title={v.isDefault ? 'Remove default' : 'Set as default'}
                        onClick={() => toggleDefault(i)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: v.isDefault ? '#f59e0b' : 'var(--color-gray-300)', padding: '0 2px' }}
                      >★</button>

                      {/* Active toggle */}
                      <button
                        title={v.isActive ? 'Deactivate' : 'Activate'}
                        onClick={() => toggleActive(i)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', color: v.isActive ? 'var(--color-primary-600, #2563eb)' : 'var(--color-gray-300)' }}
                      >
                        {v.isActive ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                      </button>

                      <button
                        onClick={() => removeValue(i)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', color: 'var(--color-gray-400)', padding: '0 2px' }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <p style={{ fontSize: 12, color: 'var(--color-gray-400)', marginTop: 6 }}>
                ★ = default · Toggle to deactivate (hides from new records, keeps on existing)
              </p>
            </div>
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
