import React, { useEffect, useState } from 'react';
import Layout from '../../layout/Layout';
import Button from '../../components/common/Button/Button';
import toast from 'react-hot-toast';
import {
  getChannelAccounts, getProviders, createChannelAccount,
  updateChannelAccount, deleteChannelAccount, validateChannelAccount,
} from '../../services/api/channels';

const CHANNELS = ['whatsapp', 'facebook', 'instagram', 'email', 'sms', 'telephony', 'webchat', 'other'];

export default function ChannelAccountsPage() {
  const [accounts, setAccounts] = useState([]);
  const [providers, setProviders] = useState([]);
  const [form, setForm] = useState({ channel: 'whatsapp', name: '', provider: '', webhookSecret: '', credentials: '{}', defaultOwnerId: '' });
  const [validation, setValidation] = useState({});

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
    try {
      await createChannelAccount({
        channel: form.channel, name: form.name, provider: form.provider || undefined,
        webhookSecret: form.webhookSecret || undefined, credentials,
        defaultOwnerId: form.defaultOwnerId || undefined,
      });
      toast.success('Channel account created');
      setForm({ ...form, name: '', webhookSecret: '', credentials: '{}' });
      load();
    } catch (e) {
      toast.error(e.message || 'Create failed');
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

  const webhookUrlFor = (acc) => `${window.location.origin.replace(/:\d+$/, ':5002')}/api/v1/channels/webhook/${acc.channel}/${acc._id}`;

  return (
    <Layout title="Channel Accounts" description="Connect WhatsApp, Messenger, Instagram, email and other messaging channels">
      <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 24 }}>
        <section>
          <h3>Connect a Channel</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8, maxWidth: 600 }}>
            <label style={{ fontSize: 13 }}>Channel</label>
            <select value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })}>
              {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <input placeholder="Account name (e.g. Support WhatsApp)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <label style={{ fontSize: 13 }}>Provider</label>
            <select value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })}>
              <option value="">— select —</option>
              {providers.filter((p) => p.channel === form.channel).map((p) => (
                <option key={p.provider} value={p.provider}>{p.label}</option>
              ))}
            </select>
            {providers.find((p) => p.provider === form.provider)?.requiredCredentials?.length > 0 && (
              <p style={{ fontSize: 12, color: '#666' }}>
                Required credential keys: {providers.find((p) => p.provider === form.provider).requiredCredentials.join(', ')}
              </p>
            )}
            <input placeholder="Webhook signing secret" value={form.webhookSecret} onChange={(e) => setForm({ ...form, webhookSecret: e.target.value })} />
            <textarea rows={3} placeholder='Credentials JSON (e.g. {"accessToken":"...","phoneNumberId":"..."})' value={form.credentials} onChange={(e) => setForm({ ...form, credentials: e.target.value })} style={{ fontFamily: 'monospace' }} />
            <input placeholder="Default owner user id (optional, for auto-assignment)" value={form.defaultOwnerId} onChange={(e) => setForm({ ...form, defaultOwnerId: e.target.value })} />
            <Button onClick={create}>Create Channel Account</Button>
          </div>
        </section>

        <section>
          <h3>Connected Channels</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th>Channel</th><th>Name</th><th>Provider</th><th>Status</th><th>Webhook URL</th><th>Actions</th></tr></thead>
            <tbody>
              {accounts.map((acc) => {
                const v = validation[acc._id];
                return (
                  <tr key={acc._id}>
                    <td>{acc.channel}</td>
                    <td>{acc.name}</td>
                    <td>{acc.provider}</td>
                    <td>
                      {acc.isActive ? 'Active' : 'Inactive'}
                      {v && (
                        <div style={{ fontSize: 12, color: v.valid ? '#16a34a' : '#dc2626' }}>
                          {v.valid ? 'Provider config complete' : `Missing: ${v.missing.join(', ')}`}
                        </div>
                      )}
                    </td>
                    <td style={{ fontSize: 11, fontFamily: 'monospace', maxWidth: 260, overflowWrap: 'break-word' }}>{webhookUrlFor(acc)}</td>
                    <td>
                      <Button size="sm" variant="secondary" onClick={() => validate(acc)} style={{ marginRight: 4 }}>Check Config</Button>
                      <Button size="sm" variant="secondary" onClick={() => toggleActive(acc)} style={{ marginRight: 4 }}>
                        {acc.isActive ? 'Deactivate' : 'Activate'}
                      </Button>
                      <Button size="sm" onClick={() => remove(acc)}>Delete</Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      </div>
    </Layout>
  );
}
