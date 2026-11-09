import React, { useEffect, useState } from 'react';
import {
  MessageSquare, Plus, Mail, Phone, Globe, Radio,
  Check, X, Trash2, Copy, AlertCircle, ShieldCheck, Wifi,
  Zap, CheckCircle2, AlertTriangle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  getChannelAccounts, getProviders, createChannelAccount,
  updateChannelAccount, deleteChannelAccount, validateChannelAccount,
  testChannelWebhook,
} from '../../services/api/channels';
import Button from '../../components/common/Button/Button';
import Layout from '../../layout/Layout';
import styles from './ChannelAccounts.module.css';

const CHANNELS = ['whatsapp', 'facebook', 'instagram', 'email', 'sms', 'telephony', 'webchat', 'other'];

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

const EMPTY_FORM = { channel: 'whatsapp', name: '', provider: '', webhookSecret: '', credentials: '{}', defaultOwnerId: '' };

export default function ChannelAccountsPage() {
  const [accounts, setAccounts] = useState([]);
  const [providers, setProviders] = useState([]);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [validation, setValidation] = useState({});
  const [creating, setCreating] = useState(false);
  const [testPanel, setTestPanel] = useState({});   // { [accId]: { open, kind, from, sending, result } }

  const load = async () => {
    try {
      const [acc, prov] = await Promise.all([getChannelAccounts(), getProviders()]);
      setAccounts(acc);
      setProviders(prov);
    } catch (e) {
      toast.error(e.message || 'Failed to load channel accounts');
    }
  };

  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!form.name) return toast.error('Name is required');
    let credentials = {};
    try { credentials = JSON.parse(form.credentials); } catch { return toast.error('Credentials must be valid JSON'); }
    setCreating(true);
    try {
      await createChannelAccount({
        channel: form.channel,
        name: form.name,
        provider: form.provider || undefined,
        webhookSecret: form.webhookSecret || undefined,
        credentials,
        defaultOwnerId: form.defaultOwnerId || undefined,
      });
      toast.success('Channel account created');
      setForm({ ...EMPTY_FORM });
      load();
    } catch (e) {
      toast.error(e.message || 'Create failed');
    } finally {
      setCreating(false);
    }
  };

  const toggleActive = async (acc) => {
    try {
      await updateChannelAccount(acc._id, { isActive: !acc.isActive });
      toast.success(acc.isActive ? 'Deactivated' : 'Activated');
      load();
    } catch (e) {
      toast.error(e.message || 'Update failed');
    }
  };

  const remove = async (acc) => {
    if (!window.confirm(`Delete channel account "${acc.name}"?`)) return;
    try {
      await deleteChannelAccount(acc._id);
      toast.success('Deleted');
      load();
    } catch (e) {
      toast.error(e.message || 'Delete failed');
    }
  };

  const validate = async (acc) => {
    try {
      const result = await validateChannelAccount(acc._id);
      setValidation((v) => ({ ...v, [acc._id]: result }));
    } catch (e) {
      toast.error(e.message || 'Validation failed');
    }
  };

  const webhookUrlFor = (acc) => {
    const apiBase = import.meta.env.VITE_API_URL || window.location.origin.replace(/:\d+$/, ':5002');
    return `${apiBase}/api/v1/channels/webhook/${acc.channel}/${acc._id}`;
  };

  const copyWebhook = (acc) => {
    navigator.clipboard.writeText(webhookUrlFor(acc)).then(() => toast.success('Webhook URL copied'));
  };

  const openTestPanel = (acc) => setTestPanel((prev) => ({
    ...prev,
    [acc._id]: { open: true, kind: 'message', from: '+27820000000', sending: false, result: null },
  }));
  const closeTestPanel = (id) => setTestPanel((prev) => ({ ...prev, [id]: { ...prev[id], open: false } }));
  const updateTest = (id, patch) => setTestPanel((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  const sendTest = async (acc) => {
    const t = testPanel[acc._id];
    if (!t) return;
    updateTest(acc._id, { sending: true, result: null });
    try {
      const res = await testChannelWebhook(acc._id, { kind: t.kind, from: t.from });
      updateTest(acc._id, {
        sending: false,
        result: {
          ok: true,
          duplicate: res.data?.duplicate,
          conversationId: res.data?.conversation?._id,
          message: res.message,
        },
      });
      toast.success(res.data?.duplicate ? 'Duplicate detected — no new record' : 'Test event sent!');
    } catch (e) {
      updateTest(acc._id, { sending: false, result: { ok: false, message: e.message || 'Test failed' } });
      toast.error(e.message || 'Test failed');
    }
  };

  const channelProviders = providers.filter((p) => p.channel === form.channel);
  const selectedProvider = providers.find((p) => p.provider === form.provider);

  return (
    <Layout title="Channel Accounts" description="Connect WhatsApp, Messenger, Instagram, email and other messaging channels">
      <div className={styles.page}>
        <div className={styles.pageHeader}>
          <div>
            <h1 className={styles.pageTitle}>Channel Accounts</h1>
            <p className={styles.pageDesc}>Connect and manage your messaging channel integrations.</p>
          </div>
        </div>

        <div className={styles.layout}>
          {/* ── Create form ── */}
          <div className={styles.panel}>
            <div className={styles.panelHeader}>
              <Plus size={14} />
              Connect a Channel
            </div>
            <div className={styles.panelBody}>
              <div className={styles.field}>
                <label className={styles.label}>Channel type</label>
                <select
                  className={styles.select}
                  value={form.channel}
                  onChange={(e) => setForm({ ...form, channel: e.target.value, provider: '' })}
                >
                  {CHANNELS.map((c) => (
                    <option key={c} value={c}>{CHANNEL_META[c]?.label || c}</option>
                  ))}
                </select>
              </div>

              <div className={styles.field}>
                <label className={styles.label}>Account name</label>
                <input
                  className={styles.input}
                  placeholder="e.g. Support WhatsApp"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>

              <div className={styles.field}>
                <label className={styles.label}>Provider</label>
                <select
                  className={styles.select}
                  value={form.provider}
                  onChange={(e) => setForm({ ...form, provider: e.target.value })}
                >
                  <option value="">— select provider —</option>
                  {channelProviders.map((p) => (
                    <option key={p.provider} value={p.provider}>{p.label}</option>
                  ))}
                </select>
                {selectedProvider?.requiredCredentials?.length > 0 && (
                  <p className={styles.hint}>
                    Required credential keys: <strong>{selectedProvider.requiredCredentials.join(', ')}</strong>
                  </p>
                )}
              </div>

              <div className={styles.field}>
                <label className={styles.label}>Webhook signing secret</label>
                <input
                  className={styles.input}
                  placeholder="Optional — for validating inbound webhooks"
                  value={form.webhookSecret}
                  onChange={(e) => setForm({ ...form, webhookSecret: e.target.value })}
                />
              </div>

              <div className={styles.field}>
                <label className={styles.label}>Credentials JSON</label>
                <textarea
                  className={styles.codeInput}
                  rows={3}
                  placeholder={'{"accessToken":"...","phoneNumberId":"..."}'}
                  value={form.credentials}
                  onChange={(e) => setForm({ ...form, credentials: e.target.value })}
                />
              </div>

              <div className={styles.field}>
                <label className={styles.label}>Default owner user ID <span style={{ fontWeight: 400, color: 'var(--color-gray-400)', fontSize: 11 }}>(optional)</span></label>
                <input
                  className={styles.input}
                  placeholder="For automatic conversation assignment"
                  value={form.defaultOwnerId}
                  onChange={(e) => setForm({ ...form, defaultOwnerId: e.target.value })}
                />
              </div>

              <Button icon={<Plus size={14} />} loading={creating} onClick={create}>
                Create Channel Account
              </Button>
            </div>
          </div>

          {/* ── Accounts list ── */}
          <div className={styles.listPanel}>
            <div className={styles.listHeader}>
              <span className={styles.listTitle}>Connected Channels</span>
              <span className={styles.listCount}>{accounts.length} account{accounts.length !== 1 ? 's' : ''}</span>
            </div>

            {accounts.length === 0 ? (
              <div className={styles.empty}>
                <Wifi size={36} className={styles.emptyIcon} />
                <p className={styles.emptyTitle}>No channels connected yet</p>
                <p>Use the form to connect your first messaging channel.</p>
              </div>
            ) : (
              accounts.map((acc) => {
                const meta = CHANNEL_META[acc.channel] || CHANNEL_META.other;
                const Icon = meta.icon;
                const v = validation[acc._id];
                return (
                  <div key={acc._id} className={styles.card}>
                    <div className={styles.cardHeader}>
                      <div className={styles.channelIcon} style={{ background: meta.bg, color: meta.color }}>
                        <Icon size={16} />
                      </div>
                      <div className={styles.cardInfo}>
                        <div className={styles.cardName}>{acc.name}</div>
                        <div className={styles.cardMeta}>
                          {meta.label}{acc.provider ? ` · ${acc.provider}` : ''}
                        </div>
                      </div>
                      <div className={styles.cardRight}>
                        <span className={`${styles.pill} ${acc.isActive ? styles.pillActive : styles.pillInactive}`}>
                          {acc.isActive ? <><Check size={10} /> Active</> : <><X size={10} /> Inactive</>}
                        </span>
                      </div>
                    </div>

                    <div className={styles.cardBody}>
                      <div className={styles.webhookRow}>
                        <span className={styles.webhookUrl}>{webhookUrlFor(acc)}</span>
                        <button className={styles.copyBtn} title="Copy webhook URL" onClick={() => copyWebhook(acc)}>
                          <Copy size={11} />
                        </button>
                      </div>
                      {v && (
                        <div className={v.valid ? styles.validResult : styles.invalidResult}>
                          {v.valid
                            ? <><ShieldCheck size={12} /> Provider config complete</>
                            : <><AlertCircle size={12} /> Missing: {v.missing.join(', ')}</>
                          }
                        </div>
                      )}
                    </div>

                    <div className={styles.actions}>
                      <Button size="sm" variant="secondary" onClick={() => validate(acc)}>
                        Check Config
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => toggleActive(acc)}>
                        {acc.isActive ? 'Deactivate' : 'Activate'}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={<Zap size={12} />}
                        onClick={() => openTestPanel(acc)}
                      >
                        Send Test
                      </Button>
                      <Button size="sm" variant="danger" icon={<Trash2 size={12} />} onClick={() => remove(acc)}>
                        Delete
                      </Button>
                    </div>

                    {testPanel[acc._id]?.open && (
                      <div className={styles.testPanel}>
                        <div className={styles.testPanelHeader}>
                          <Zap size={12} /> Send a Test Event
                          <button className={styles.testPanelClose} onClick={() => closeTestPanel(acc._id)}>
                            <X size={12} />
                          </button>
                        </div>
                        <div className={styles.testPanelBody}>
                          <div className={styles.testKindRow}>
                            <button
                              className={`${styles.testKindBtn} ${testPanel[acc._id]?.kind === 'message' ? styles.testKindActive : ''}`}
                              onClick={() => updateTest(acc._id, { kind: 'message' })}
                            >
                              Message
                            </button>
                            <button
                              className={`${styles.testKindBtn} ${testPanel[acc._id]?.kind === 'call' ? styles.testKindActive : ''}`}
                              onClick={() => updateTest(acc._id, { kind: 'call' })}
                            >
                              Call
                            </button>
                          </div>
                          <div className={styles.testFromRow}>
                            <label className={styles.testFromLabel}>From number</label>
                            <input
                              className={styles.testFromInput}
                              placeholder="+27820000000"
                              value={testPanel[acc._id]?.from ?? '+27820000000'}
                              onChange={(e) => updateTest(acc._id, { from: e.target.value })}
                            />
                          </div>
                          <Button
                            icon={<Zap size={12} />}
                            loading={testPanel[acc._id]?.sending}
                            onClick={() => sendTest(acc)}
                          >
                            Send Test {testPanel[acc._id]?.kind === 'call' ? 'Call' : 'Message'}
                          </Button>
                        </div>
                        {testPanel[acc._id]?.result && (
                          <div className={
                            testPanel[acc._id].result.duplicate
                              ? styles.testResultDup
                              : testPanel[acc._id].result.ok
                                ? styles.testResultOk
                                : styles.testResultErr
                          }>
                            {testPanel[acc._id].result.duplicate ? (
                              <><AlertTriangle size={12} /> Duplicate — conversation already exists, no new record created</>
                            ) : testPanel[acc._id].result.ok ? (
                              <><CheckCircle2 size={12} /> Event sent — check Inbox for the new conversation</>
                            ) : (
                              <><X size={12} /> {testPanel[acc._id].result.message}</>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
