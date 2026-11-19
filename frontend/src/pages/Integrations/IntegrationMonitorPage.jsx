import React, { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import api from '../../services/api';
import Button from '../../components/common/Button/Button';
import Layout from '../../layout/Layout';

// Outgoing webhooks, the Integration Log and the authentication-failure log
// (BRD 17.4, 17.5, 17.6.3). Deliberately plain: one page, three tabs.
const th = { textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--color-gray-200, #ddd)', fontSize: 12, whiteSpace: 'nowrap' };
const td = { padding: '6px 8px', borderBottom: '1px solid var(--color-gray-100, #eee)', fontSize: 12, verticalAlign: 'top' };
const input = { padding: '6px 8px', border: '1px solid var(--color-gray-300, #ccc)', borderRadius: 6, width: '100%', boxSizing: 'border-box' };
const fmt = (t) => (t ? new Date(t).toLocaleString() : '');
const emptyForm = { name: '', url: '', events: [], customEvent: '', objectFilters: '', retryCount: 3, retryIntervalSeconds: 30, retryBackoff: 'fixed', failureNotifyThreshold: 3, payloadMapping: '' };

function WebhooksTab() {
  const [hooks, setHooks] = useState([]);
  const [events, setEvents] = useState([]);
  const [form, setForm] = useState(null);
  const [secret, setSecret] = useState(null);
  const [confirmId, setConfirmId] = useState(null);

  const load = useCallback(async () => {
    try {
      const [h, e] = await Promise.all([api.get('/webhooks'), api.get('/webhooks/events')]);
      setHooks(h.data.data || []);
      setEvents(e.data.data || []);
    } catch (err) {
      toast.error(err.message || 'Could not load webhooks');
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    let mapping;
    if (form.payloadMapping.trim()) {
      try { mapping = JSON.parse(form.payloadMapping); } catch { toast.error('Payload mapping must be JSON like {"policyNo":"policy_number"}'); return; }
    }
    const evs = [...form.events, ...(form.customEvent.trim() ? [`custom.${form.customEvent.trim()}`] : [])];
    try {
      const r = await api.post('/webhooks', {
        name: form.name, url: form.url, events: evs,
        objectFilters: form.objectFilters.split(',').map((x) => x.trim()).filter(Boolean),
        retryCount: Number(form.retryCount), retryIntervalSeconds: Number(form.retryIntervalSeconds),
        retryBackoff: form.retryBackoff, failureNotifyThreshold: Number(form.failureNotifyThreshold),
        ...(mapping ? { payloadMapping: mapping } : {}),
      });
      setSecret(r.data.data.secret);
      setForm(null);
      load();
    } catch (err) { toast.error(err.message || 'Could not save the webhook'); }
  };
  const act = async (fn, ok) => { try { await fn(); if (ok) toast.success(ok); load(); } catch (err) { toast.error(err.message || 'Failed'); } };
  const test = async (h) => { try { const r = await api.post(`/webhooks/${h._id}/test`); r.data.data.ok ? toast.success(`Test delivered (HTTP ${r.data.data.status})`) : toast.error(`Test failed: ${r.data.data.error}`); load(); } catch (err) { toast.error(err.message); } };

  return (
    <div>
      {secret && (
        <div style={{ background: '#fffbe6', border: '1px solid #f0d878', padding: 10, borderRadius: 6, marginBottom: 12 }}>
          <strong>Signing secret (shown once):</strong> <code data-testid="webhook-secret">{secret}</code>
          <div style={{ fontSize: 12 }}>Copy it now. The receiver verifies each delivery with HMAC-SHA256 of the body against the <code>X-Webhook-Signature</code> header. It cannot be shown again.</div>
          <Button size="sm" variant="secondary" onClick={() => setSecret(null)}>I have copied it</Button>
        </div>
      )}
      {!form && <Button onClick={() => setForm({ ...emptyForm })}>New Webhook</Button>}
      {form && (
        <div style={{ border: '1px solid var(--color-gray-200, #ddd)', borderRadius: 8, padding: 12, margin: '8px 0', display: 'grid', gap: 8, maxWidth: 640 }}>
          <label>Name<input style={input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label>Endpoint URL<input style={input} placeholder="https://example.com/hook" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} /></label>
          <fieldset style={{ border: '1px solid var(--color-gray-200, #ddd)' }}>
            <legend>Events</legend>
            {events.map((e) => (
              <label key={e} style={{ display: 'inline-block', width: 220 }}>
                <input type="checkbox" checked={form.events.includes(e)} onChange={() => setForm({ ...form, events: form.events.includes(e) ? form.events.filter((x) => x !== e) : [...form.events, e] })} /> {e}
              </label>
            ))}
            <label style={{ display: 'block', marginTop: 6 }}>Custom business event (raised by a flow step)<input style={input} placeholder="e.g. claim_escalated" value={form.customEvent} onChange={(e) => setForm({ ...form, customEvent: e.target.value })} /></label>
          </fieldset>
          <label>Only these objects (API names, comma separated, blank = all)<input style={input} value={form.objectFilters} onChange={(e) => setForm({ ...form, objectFilters: e.target.value })} /></label>
          <label>Payload mapping (JSON, blank = send the whole record)<textarea style={input} rows={3} placeholder='{"policyNo":"policy_number","premium":"premium"}' value={form.payloadMapping} onChange={(e) => setForm({ ...form, payloadMapping: e.target.value })} /></label>
          <div style={{ display: 'flex', gap: 8 }}>
            <label>Retries<input style={input} type="number" min="0" max="10" value={form.retryCount} onChange={(e) => setForm({ ...form, retryCount: e.target.value })} /></label>
            <label>Retry interval (s)<input style={input} type="number" min="1" value={form.retryIntervalSeconds} onChange={(e) => setForm({ ...form, retryIntervalSeconds: e.target.value })} /></label>
            <label>Backoff
              <select style={input} value={form.retryBackoff} onChange={(e) => setForm({ ...form, retryBackoff: e.target.value })}>
                <option value="fixed">Fixed</option><option value="exponential">Exponential</option>
              </select>
            </label>
            <label>Alert admins after N failures<input style={input} type="number" min="0" value={form.failureNotifyThreshold} onChange={(e) => setForm({ ...form, failureNotifyThreshold: e.target.value })} /></label>
          </div>
          <div style={{ display: 'flex', gap: 8 }}><Button onClick={save}>Create Webhook</Button><Button variant="secondary" onClick={() => setForm(null)}>Cancel</Button></div>
        </div>
      )}
      <table style={{ borderCollapse: 'collapse', width: '100%', marginTop: 12 }}>
        <thead><tr><th style={th}>Name</th><th style={th}>Endpoint</th><th style={th}>Events</th><th style={th}>Retries</th><th style={th}>Delivered / failed</th><th style={th}>Status</th><th style={th}></th></tr></thead>
        <tbody>
          {hooks.map((h) => (
            <tr key={h._id}>
              <td style={td}>{h.name}</td><td style={td}>{h.url}</td><td style={td}>{(h.events || []).join(', ')}</td>
              <td style={td}>{h.retryCount} x {h.retryIntervalSeconds}s {h.retryBackoff}</td>
              <td style={td}>{h.stats?.successCount || 0} / {h.stats?.failureCount || 0}</td>
              <td style={td}>{h.isActive ? 'Active' : 'Inactive'}</td>
              <td style={td}>
                <Button size="sm" variant="secondary" onClick={() => test(h)}>Test</Button>{' '}
                <Button size="sm" variant="secondary" onClick={() => act(() => api.put(`/webhooks/${h._id}`, { isActive: !h.isActive }), h.isActive ? 'Webhook switched off' : 'Webhook switched on')}>{h.isActive ? 'Deactivate' : 'Activate'}</Button>{' '}
                {confirmId === h._id
                  ? <Button size="sm" variant="danger" onClick={() => { setConfirmId(null); act(() => api.delete(`/webhooks/${h._id}`), 'Webhook deleted'); }}>Confirm delete</Button>
                  : <Button size="sm" variant="secondary" onClick={() => setConfirmId(h._id)}>Delete</Button>}
              </td>
            </tr>
          ))}
          {!hooks.length && <tr><td style={td} colSpan={7}>No outgoing webhooks yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function LogTab() {
  const [rows, setRows] = useState([]);
  const [filter, setFilter] = useState({ direction: '', result: '' });
  const [sum, setSum] = useState(null);
  const load = useCallback(async () => {
    try {
      const [l, u] = await Promise.all([api.get('/integration-log', { params: { ...(filter.direction ? { direction: filter.direction } : {}), ...(filter.result ? { result: filter.result } : {}) } }), api.get('/api-keys/usage-summary', { params: { days: 7 } })]);
      setRows(l.data.data || []);
      setSum(u.data.data);
    } catch (err) { toast.error(err.message || 'Could not load the log'); }
  }, [filter]);
  useEffect(() => { load(); }, [load]);
  return (
    <div>
      {sum && <p data-testid="usage-summary">API usage, last 7 days: <strong>{sum.total}</strong> calls, <strong>{sum.errors}</strong> errors, success rate <strong>{sum.successRate}%</strong>, average {sum.avgResponseMs} ms.</p>}
      <div style={{ display: 'flex', gap: 8, margin: '8px 0' }}>
        <select style={{ ...input, width: 160 }} value={filter.direction} onChange={(e) => setFilter({ ...filter, direction: e.target.value })}><option value="">All directions</option><option value="inbound">Inbound</option><option value="outbound">Outbound</option></select>
        <select style={{ ...input, width: 160 }} value={filter.result} onChange={(e) => setFilter({ ...filter, result: e.target.value })}><option value="">All results</option><option value="success">Success</option><option value="failed">Failed</option><option value="retrying">Retrying</option></select>
        <Button variant="secondary" onClick={load}>Refresh</Button>
      </div>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead><tr>{['Tenant', 'Integration', 'Direction', 'Date / time', 'Event', 'Endpoint', 'Result', 'HTTP status', 'Error details', 'Retry status'].map((c) => <th key={c} style={th}>{c}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}><td style={td}>{r.tenant}</td><td style={td}>{r.integration}</td><td style={td}>{r.direction}</td><td style={td}>{fmt(r.time)}</td><td style={td}>{r.event}</td><td style={td}>{r.endpoint}</td><td style={td}>{r.result}</td><td style={td}>{r.httpStatus ?? ''}</td><td style={td}>{r.error || ''}</td><td style={td}>{r.retry}</td></tr>
          ))}
          {!rows.length && <tr><td style={td} colSpan={10}>No integration traffic yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function FailuresTab() {
  const [rows, setRows] = useState([]);
  useEffect(() => { api.get('/api-keys/auth-failures').then((r) => setRows(r.data.data || [])).catch((e) => toast.error(e.message)); }, []);
  return (
    <table style={{ borderCollapse: 'collapse', width: '100%' }}>
      <thead><tr>{['Date / time', 'Kind', 'Credential', 'Reason', 'Source IP', 'Request'].map((c) => <th key={c} style={th}>{c}</th>)}</tr></thead>
      <tbody>
        {rows.map((r) => (<tr key={r._id}><td style={td}>{fmt(r.timestamp)}</td><td style={td}>{r.integration}</td><td style={td}>{r.identifier || ''}</td><td style={td}>{r.reason}</td><td style={td}>{r.ip}</td><td style={td}>{r.method} {r.path}</td></tr>))}
        {!rows.length && <tr><td style={td} colSpan={6}>No failed authentications recorded for this tenant.</td></tr>}
      </tbody>
    </table>
  );
}

export default function IntegrationMonitorPage() {
  const [tab, setTab] = useState('webhooks');
  const tabs = [['webhooks', 'Outgoing Webhooks'], ['log', 'Integration Log'], ['failures', 'Authentication Failures']];
  return (
    <Layout title="Webhooks & Integration Log" description="Outgoing webhooks, integration traffic and failed authentications">
      <div style={{ padding: 16 }}>
        <h1 style={{ margin: '0 0 12px' }}>Webhooks &amp; Integration Log</h1>
        <div role="tablist" style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {tabs.map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--color-gray-300, #ccc)', background: tab === k ? 'var(--color-primary-600, #244c64)' : 'transparent', color: tab === k ? '#fff' : 'inherit', cursor: 'pointer' }}>{label}</button>
          ))}
        </div>
        {tab === 'webhooks' && <WebhooksTab />}
        {tab === 'log' && <LogTab />}
        {tab === 'failures' && <FailuresTab />}
      </div>
    </Layout>
  );
}
