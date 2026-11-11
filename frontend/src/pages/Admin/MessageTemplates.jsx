import React, { useEffect, useState } from 'react';
import {
  MessageSquare, Plus, Mail, Phone, Globe, Radio,
  Check, X, Trash2, Eye, FileText, Info, Pencil, Save,
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  getMessageTemplates, createMessageTemplate, updateMessageTemplate,
  deleteMessageTemplate, previewMessageTemplate,
} from '../../services/api/messageTemplates';
import Button from '../../components/common/Button/Button';
import Layout from '../../layout/Layout';
import styles from './MessageTemplates.module.css';

const CHANNELS = ['whatsapp', 'facebook', 'instagram', 'email', 'sms', 'telephony', 'webchat', 'other'];
const PROVIDER_STATUSES = ['', 'local_only', 'pending', 'approved', 'rejected'];

const CHANNEL_META = {
  whatsapp:  { label: 'WhatsApp',  icon: MessageSquare, bg: '#dcfce7', color: '#16a34a' },
  facebook:  { label: 'Facebook',  icon: MessageSquare, bg: '#dbeafe', color: '#1d4ed8' },
  instagram: { label: 'Instagram', icon: MessageSquare, bg: '#fce7f3', color: '#be185d' },
  email:     { label: 'Email',     icon: Mail,          bg: '#ede9fe', color: '#7c3aed' },
  sms:       { label: 'SMS',       icon: MessageSquare, bg: '#ccfbf1', color: '#0d9488' },
  telephony: { label: 'Telephony', icon: Phone,         bg: '#f1f5f9', color: '#475569' },
  webchat:   { label: 'Web Chat',  icon: Globe,         bg: '#fef3c7', color: '#b45309' },
  other:     { label: 'Other',     icon: Radio,         bg: '#f1f5f9', color: '#6b7280' },
};

const PROVIDER_STATUS_PILL = {
  approved:   styles.pillApproved,
  pending:    styles.pillPending,
  rejected:   styles.pillRejected,
  local_only: styles.pillNeutral,
  '':         styles.pillNeutral,
};

const EMPTY_FORM = { name: '', channel: 'whatsapp', subject: '', body: '', language: 'en', providerTemplateId: '' };

export default function MessageTemplatesPage() {
  const [templates, setTemplates] = useState([]);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [creating, setCreating] = useState(false);
  const [previewValues, setPreviewValues] = useState('{}');
  const [previewResult, setPreviewResult] = useState(null);
  const [previewingId, setPreviewingId] = useState(null);
  const [editTpl, setEditTpl] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try { setTemplates(await getMessageTemplates()); }
    catch (e) { toast.error(e.message || 'Failed to load templates'); }
  };

  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!form.name || !form.body) return toast.error('Name and body are required');
    setCreating(true);
    try {
      await createMessageTemplate(form);
      toast.success('Template created');
      setForm({ ...EMPTY_FORM });
      load();
    } catch (e) {
      toast.error(e.message || 'Create failed');
    } finally {
      setCreating(false);
    }
  };

  const toggleActive = async (tpl) => {
    try {
      await updateMessageTemplate(tpl._id, { isActive: !tpl.isActive });
      toast.success(tpl.isActive ? 'Deactivated' : 'Activated');
      load();
    } catch (e) {
      toast.error(e.message || 'Update failed');
    }
  };

  const setProviderStatus = async (tpl, status) => {
    try {
      await updateMessageTemplate(tpl._id, { providerStatus: status });
      toast.success('Provider status updated');
      load();
    } catch (e) {
      toast.error(e.message || 'Update failed');
    }
  };

  const remove = async (tpl) => {
    if (!window.confirm(`Delete template "${tpl.name}"?`)) return;
    try {
      await deleteMessageTemplate(tpl._id);
      toast.success('Deleted');
      load();
    } catch (e) {
      toast.error(e.message || 'Delete failed');
    }
  };

  const startEdit = (tpl) => {
    setEditTpl(tpl);
    setEditForm({ name: tpl.name, channel: tpl.channel, subject: tpl.subject || '', body: tpl.body, language: tpl.language || 'en', providerTemplateId: tpl.providerTemplateId || '' });
  };

  const cancelEdit = () => { setEditTpl(null); setEditForm({}); };

  const saveEdit = async () => {
    if (!editForm.body) return toast.error('Body is required');
    setSaving(true);
    try {
      await updateMessageTemplate(editTpl._id, editForm);
      toast.success('Template updated');
      cancelEdit();
      load();
    } catch (e) {
      toast.error(e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const preview = async (tpl) => {
    let values = {};
    try { values = JSON.parse(previewValues); } catch { return toast.error('Preview values must be valid JSON'); }
    setPreviewingId(tpl._id);
    try {
      setPreviewResult(await previewMessageTemplate(tpl._id, values));
    } catch (e) {
      toast.error(e.message || 'Preview failed');
      setPreviewingId(null);
    }
  };

  return (
    <Layout title="Message Templates" description="Reusable WhatsApp, email and messaging templates with merge fields">
      <div className={styles.page}>
        <div className={styles.pageHeader}>
          <div>
            <h1 className={styles.pageTitle}>Message Templates</h1>
            <p className={styles.pageDesc}>
              Create reusable templates with <code style={{ fontSize: 12, background: 'var(--color-gray-100)', padding: '1px 4px', borderRadius: 3 }}>{'{{field_name}}'}</code> merge fields for any channel.
            </p>
          </div>
        </div>

        <div className={styles.layout}>
          {/* ── Create / Edit form ── */}
          <div className={styles.panel}>
            <div className={styles.panelHeader}>
              {editTpl ? <><Pencil size={14} /> Edit Template</> : <><Plus size={14} /> Create Template</>}
            </div>
            <div className={styles.panelBody}>
              {!editTpl && (
                <div className={styles.field}>
                  <label className={styles.label}>Template name</label>
                  <input
                    className={styles.input}
                    placeholder="e.g. Order Confirmation"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </div>
              )}
              {editTpl && (
                <div className={styles.field}>
                  <label className={styles.label}>Template name</label>
                  <input
                    className={styles.input}
                    value={editForm.name}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  />
                </div>
              )}

              <div className={styles.field}>
                <label className={styles.label}>Channel</label>
                <select
                  className={styles.select}
                  value={editTpl ? editForm.channel : form.channel}
                  onChange={(e) => editTpl
                    ? setEditForm({ ...editForm, channel: e.target.value, subject: '' })
                    : setForm({ ...form, channel: e.target.value, subject: '' })}
                >
                  {CHANNELS.map((c) => (
                    <option key={c} value={c}>{CHANNEL_META[c]?.label || c}</option>
                  ))}
                </select>
              </div>

              {(editTpl ? editForm.channel : form.channel) === 'email' && (
                <div className={styles.field}>
                  <label className={styles.label}>Subject line</label>
                  <input
                    className={styles.input}
                    placeholder="e.g. Your order #{{order_id}} is confirmed"
                    value={editTpl ? editForm.subject : form.subject}
                    onChange={(e) => editTpl
                      ? setEditForm({ ...editForm, subject: e.target.value })
                      : setForm({ ...form, subject: e.target.value })}
                  />
                </div>
              )}

              <div className={styles.field}>
                <label className={styles.label}>Body</label>
                <textarea
                  className={styles.bodyInput}
                  rows={5}
                  placeholder={'Hi {{first_name}},\n\nYour order has been placed.\n\nThanks,\nThe Team'}
                  value={editTpl ? editForm.body : form.body}
                  onChange={(e) => editTpl
                    ? setEditForm({ ...editForm, body: e.target.value })
                    : setForm({ ...form, body: e.target.value })}
                />
                <p className={styles.hint}>Use {'{{field_name}}'} for merge fields.</p>
              </div>

              <div className={styles.field}>
                <label className={styles.label}>Language</label>
                <input
                  className={styles.input}
                  placeholder="en"
                  value={editTpl ? editForm.language : form.language}
                  onChange={(e) => editTpl
                    ? setEditForm({ ...editForm, language: e.target.value })
                    : setForm({ ...form, language: e.target.value })}
                />
              </div>

              {(editTpl ? editForm.channel : form.channel) === 'whatsapp' && (
                <div className={styles.field}>
                  <label className={styles.label}>
                    Meta template name{' '}
                    <span style={{ fontWeight: 400, color: 'var(--color-gray-400)', fontSize: 11 }}>(providerTemplateId)</span>
                  </label>
                  <input
                    className={styles.input}
                    placeholder="e.g. order_confirmation"
                    value={editTpl ? editForm.providerTemplateId : form.providerTemplateId}
                    onChange={(e) => editTpl
                      ? setEditForm({ ...editForm, providerTemplateId: e.target.value })
                      : setForm({ ...form, providerTemplateId: e.target.value })}
                  />
                  <p className={styles.hint}>The exact template name registered in WhatsApp Business Manager. Required to send via the Meta API.</p>
                </div>
              )}

              {editTpl ? (
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button icon={<Save size={14} />} loading={saving} onClick={saveEdit}>
                    Save Changes
                  </Button>
                  <Button variant="secondary" onClick={cancelEdit}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button icon={<Plus size={14} />} loading={creating} onClick={create}>
                  Create Template
                </Button>
              )}
            </div>
          </div>

          {/* ── Templates list ── */}
          <div className={styles.listPanel}>
            <div className={styles.listHeader}>
              <span className={styles.listTitle}>Templates</span>
              <span className={styles.listCount}>{templates.length} template{templates.length !== 1 ? 's' : ''}</span>
            </div>

            <div className={styles.notice}>
              <Info size={13} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>A WhatsApp template can only be sent from the Inbox once its provider status is set to <strong>approved</strong>.</span>
            </div>

            <div className={styles.previewBar}>
              <div className={styles.previewBarHeader}>
                <Eye size={12} /> Preview values
              </div>
              <div className={styles.previewBarBody}>
                <input
                  className={styles.previewInput}
                  placeholder='{"first_name":"Jane","order_id":"1234"}'
                  value={previewValues}
                  onChange={(e) => setPreviewValues(e.target.value)}
                />
              </div>
            </div>

            {templates.length === 0 ? (
              <div className={styles.empty}>
                <FileText size={36} className={styles.emptyIcon} />
                <p className={styles.emptyTitle}>No templates yet</p>
                <p>Create your first template using the form.</p>
              </div>
            ) : (
              templates.map((tpl) => {
                const meta = CHANNEL_META[tpl.channel] || CHANNEL_META.other;
                const Icon = meta.icon;
                const ps = tpl.providerStatus || '';
                return (
                  <div key={tpl._id} className={styles.card}>
                    <div className={styles.cardHeader}>
                      <div className={styles.channelIcon} style={{ background: meta.bg, color: meta.color }}>
                        <Icon size={15} />
                      </div>
                      <div className={styles.cardInfo}>
                        <div className={styles.cardName}>{tpl.name}</div>
                        <div className={styles.cardMeta}>
                          {meta.label}{tpl.language ? ` · ${tpl.language}` : ''}
                          {tpl.channel === 'email' && tpl.subject ? ` · "${tpl.subject}"` : ''}
                        </div>
                      </div>
                      <div className={styles.cardRight}>
                        <span className={`${styles.pill} ${tpl.isActive ? styles.pillActive : styles.pillInactive}`}>
                          {tpl.isActive ? <><Check size={10} /> Active</> : <><X size={10} /> Inactive</>}
                        </span>
                      </div>
                    </div>

                    <div className={styles.cardBody}>
                      <span className={styles.bodyPreview}>{tpl.body}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                        <span style={{ fontSize: 11, color: 'var(--color-gray-400)' }}>Provider:</span>
                        <select
                          className={styles.providerSelect}
                          value={ps}
                          onChange={(e) => setProviderStatus(tpl, e.target.value)}
                        >
                          {PROVIDER_STATUSES.map((s) => (
                            <option key={s} value={s}>{s || '(none)'}</option>
                          ))}
                        </select>
                        {ps && (
                          <span className={`${styles.pill} ${PROVIDER_STATUS_PILL[ps] || styles.pillNeutral}`} style={{ padding: '1px 6px' }}>
                            {ps}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className={styles.actions}>
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={<Eye size={12} />}
                        loading={previewingId === tpl._id}
                        onClick={() => preview(tpl)}
                      >
                        Preview
                      </Button>
                      <Button size="sm" variant="secondary" icon={<Pencil size={12} />} onClick={() => startEdit(tpl)}>
                        Edit
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => toggleActive(tpl)}>
                        {tpl.isActive ? 'Deactivate' : 'Activate'}
                      </Button>
                      <Button size="sm" variant="danger" icon={<Trash2 size={12} />} onClick={() => remove(tpl)}>
                        Delete
                      </Button>
                    </div>
                  </div>
                );
              })
            )}

            {previewResult && (
              <div className={styles.previewResult}>
                <div className={styles.previewResultHeader}>
                  Preview Result
                  <button
                    onClick={() => { setPreviewResult(null); setPreviewingId(null); }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-gray-400)', display: 'flex', alignItems: 'center' }}
                  >
                    <X size={14} />
                  </button>
                </div>
                <pre className={styles.previewPre}>{JSON.stringify(previewResult, null, 2)}</pre>
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
