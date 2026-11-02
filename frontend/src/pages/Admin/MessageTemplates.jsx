import React, { useEffect, useState } from 'react';
import Layout from '../../layout/Layout';
import Button from '../../components/common/Button/Button';
import toast from 'react-hot-toast';
import {
  getMessageTemplates, createMessageTemplate, updateMessageTemplate,
  deleteMessageTemplate, previewMessageTemplate,
} from '../../services/api/messageTemplates';

const CHANNELS = ['whatsapp', 'facebook', 'instagram', 'email', 'sms', 'telephony', 'webchat', 'other'];
const PROVIDER_STATUSES = ['', 'local_only', 'pending', 'approved', 'rejected'];

export default function MessageTemplatesPage() {
  const [templates, setTemplates] = useState([]);
  const [form, setForm] = useState({ name: '', channel: 'whatsapp', subject: '', body: '', language: 'en' });
  const [previewValues, setPreviewValues] = useState('{}');
  const [previewResult, setPreviewResult] = useState(null);
  const [previewingId, setPreviewingId] = useState(null);

  const load = async () => {
    try { setTemplates(await getMessageTemplates()); }
    catch (e) { toast.error(e.message || 'Failed to load templates'); }
  };

  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!form.name || !form.body) return toast.error('Name and body are required');
    try {
      await createMessageTemplate(form);
      toast.success('Template created');
      setForm({ ...form, name: '', subject: '', body: '' });
      load();
    } catch (e) {
      toast.error(e.message || 'Create failed');
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

  const preview = async (tpl) => {
    let values = {};
    try { values = JSON.parse(previewValues); } catch { return toast.error('Preview values must be valid JSON'); }
    try {
      setPreviewingId(tpl._id);
      setPreviewResult(await previewMessageTemplate(tpl._id, values));
    } catch (e) {
      toast.error(e.message || 'Preview failed');
    }
  };

  return (
    <Layout title="Message Templates" description="Reusable WhatsApp, email and messaging templates with merge fields">
      <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 24 }}>
        <section>
          <h3>Create Template</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8, maxWidth: 600 }}>
            <input placeholder="Template name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <label style={{ fontSize: 13 }}>Channel</label>
            <select value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })}>
              {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            {form.channel === 'email' && (
              <input placeholder="Subject" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
            )}
            <textarea rows={5} placeholder="Body — use {{field_name}} for merge fields" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
            <input placeholder="Language (e.g. en)" value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })} />
            <Button onClick={create}>Create Template</Button>
          </div>
        </section>

        <section>
          <h3>Templates</h3>
          <p style={{ fontSize: 13, color: '#666' }}>
            A WhatsApp template can only be sent from the Inbox once its Provider Status is set to <strong>approved</strong>.
          </p>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <input placeholder='Preview values JSON, e.g. {"first_name":"Jane"}' value={previewValues} onChange={(e) => setPreviewValues(e.target.value)} style={{ flex: 1, fontFamily: 'monospace' }} />
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th>Name</th><th>Channel</th><th>Status</th><th>Provider Status</th><th>Actions</th></tr></thead>
            <tbody>
              {templates.map((tpl) => (
                <tr key={tpl._id}>
                  <td>{tpl.name}</td>
                  <td>{tpl.channel}</td>
                  <td>{tpl.isActive ? 'Active' : 'Inactive'}</td>
                  <td>
                    <select value={tpl.providerStatus || ''} onChange={(e) => setProviderStatus(tpl, e.target.value)}>
                      {PROVIDER_STATUSES.map((s) => <option key={s} value={s}>{s || '(none)'}</option>)}
                    </select>
                  </td>
                  <td>
                    <Button size="sm" variant="secondary" onClick={() => preview(tpl)} style={{ marginRight: 4 }}>Preview</Button>
                    <Button size="sm" variant="secondary" onClick={() => toggleActive(tpl)} style={{ marginRight: 4 }}>
                      {tpl.isActive ? 'Deactivate' : 'Activate'}
                    </Button>
                    <Button size="sm" onClick={() => remove(tpl)}>Delete</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {previewResult && (
          <section>
            <h3>Preview Result</h3>
            <pre style={{ background: '#f5f5f5', padding: 12, borderRadius: 6 }}>{JSON.stringify(previewResult, null, 2)}</pre>
          </section>
        )}
      </div>
    </Layout>
  );
}
