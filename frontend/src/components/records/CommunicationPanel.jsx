import { useEffect, useState } from 'react';

const base = () => import.meta.env.VITE_API_URL || 'http://localhost:5002';

const CommunicationPanel = ({ objectApiName, recordId }) => {
  const [prefs, setPrefs] = useState(null);
  const [consents, setConsents] = useState([]);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({ status: 'granted', purpose: 'marketing', source: '', eventAt: '' });

  const load = async () => {
    try {
      const r1 = await fetch(`${base()}/api/v1/communication/preferences?objectApiName=${objectApiName}&recordId=${recordId}`, { credentials: 'include' });
      const j1 = await r1.json();
      setPrefs(j1?.data || null);
      const r2 = await fetch(`${base()}/api/v1/communication/consent?objectApiName=${objectApiName}&recordId=${recordId}`, { credentials: 'include' });
      const j2 = await r2.json();
      setConsents(j2?.data || []);
    } catch (e) { setError(e.message); }
  };

  useEffect(() => { load(); }, [objectApiName, recordId]);

  const savePref = async (patch) => {
    setError(null);
    const res = await fetch(`${base()}/api/v1/communication/preferences`, {
      method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ objectApiName, recordId, ...patch }),
    });
    const json = await res.json();
    if (!res.ok) { setError(json?.message || 'Failed'); return; }
    setPrefs(json.data);
  };

  const addConsent = async (e) => {
    e.preventDefault();
    setError(null);
    const res = await fetch(`${base()}/api/v1/communication/consent`, {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ objectApiName, recordId, status: form.status, purpose: form.purpose, source: form.source, eventAt: form.eventAt || undefined }),
    });
    const json = await res.json();
    if (!res.ok) { setError(json?.message || 'Failed'); return; }
    setConsents([json.data, ...consents]);
    load();
  };

  if (!prefs) return <div>Loading preferences...</div>;

  return (
    <div style={{ marginTop: '1rem' }}>
      <h3>Communication Preferences</h3>
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}
      <div style={{ display: 'grid', gap: '0.5rem', marginBottom: '1rem' }}>
        <label>Email: <select value={prefs.email} onChange={e => savePref({ email: e.target.value })}>
          <option value="unknown">Unknown</option><option value="opted_in">Opted in</option><option value="opted_out">Opted out</option>
        </select></label>
        <label>WhatsApp: <select value={prefs.whatsapp} onChange={e => savePref({ whatsapp: e.target.value })}>
          <option value="unknown">Unknown</option><option value="opted_in">Opted in</option><option value="opted_out">Opted out</option>
        </select></label>
        <label>Telephone: <select value={prefs.telephone} onChange={e => savePref({ telephone: e.target.value })}>
          <option value="unknown">Unknown</option><option value="allowed">Allowed</option><option value="do_not_call">Do not call</option>
        </select></label>
        <label>Marketing: <select value={prefs.marketing} onChange={e => savePref({ marketing: e.target.value })}>
          <option value="unknown">Unknown</option><option value="granted">Granted</option><option value="denied">Denied</option><option value="withdrawn">Withdrawn</option>
        </select></label>
        <label>Preferred channel: <select value={prefs.preferredChannel} onChange={e => savePref({ preferredChannel: e.target.value })}>
          <option value="none">None</option><option value="email">Email</option><option value="whatsapp">WhatsApp</option><option value="telephone">Telephone</option>
        </select></label>
      </div>

      <h4>Consent Evidence</h4>
      <form onSubmit={addConsent} style={{ display: 'grid', gap: '0.5rem', marginBottom: '1rem' }}>
        <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
          <option value="granted">Granted</option><option value="denied">Denied</option><option value="withdrawn">Withdrawn</option><option value="pending">Pending</option>
        </select>
        <input placeholder="Purpose" value={form.purpose} onChange={e => setForm({ ...form, purpose: e.target.value })} required />
        <input placeholder="Source" value={form.source} onChange={e => setForm({ ...form, source: e.target.value })} required />
        <input type="datetime-local" value={form.eventAt} onChange={e => setForm({ ...form, eventAt: e.target.value })} />
        <button type="submit">Record consent</button>
      </form>
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {consents.map(c => (
          <li key={c._id} style={{ borderBottom: '1px solid #e2e8f0', padding: '0.5rem 0' }}>
            <strong>{c.status}</strong> — {c.purpose} via {c.source} at {new Date(c.eventAt).toLocaleString()}
          </li>
        ))}
      </ul>
    </div>
  );
};

export default CommunicationPanel;
