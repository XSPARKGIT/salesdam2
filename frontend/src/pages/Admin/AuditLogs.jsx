import { useEffect, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import Layout from '../../layout/Layout';

const base = () => import.meta.env.VITE_API_URL || 'http://localhost:5002';

const AuditLogs = () => {
  const { user } = useAuth();
  const [mineOnly, setMineOnly] = useState(false);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const uid = mineOnly && user?._id ? `&userId=${user._id}` : '';
      const res = await fetch(`${base()}/api/v1/admin/logs?page=${page}&limit=20${uid}`, { credentials: 'include' });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message || 'Failed to load');
      const items = Array.isArray(json?.data) ? json.data : (json?.data?.items || []);
      setLogs(items);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [page, mineOnly]);

  return (
    <Layout title="Audit Logs" description="Administrator audit trail">
      <div style={{ padding: '1rem' }}>
        <h1>Audit Logs</h1>
        {loading && <p>Loading...</p>}
        {error && <p style={{ color: '#dc2626' }}>{error}</p>}
        <label style={{ display: 'block', marginBottom: '0.5rem' }}><input type="checkbox" checked={mineOnly} onChange={e => setMineOnly(e.target.checked)} /> Only my actions</label>
        {!loading && logs.length === 0 && <p>No audit logs.</p>}
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr><th>Timestamp</th><th>Action</th><th>Resource</th><th>User</th><th>IP</th><th>Status</th></tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l._id}>
                <td>{new Date(l.createdAt).toLocaleString()}</td>
                <td>{l.action}</td>
                <td>{l.resource} {l.resourceId ? `#${l.resourceId}` : ''}</td>
                <td>{l.userEmail || l.userId?.email || l.userId?._id || ''}</td>
                <td>{l.ipAddress}</td>
                <td>{l.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
          <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Prev</button>
          <span>Page {page}</span>
          <button disabled={logs.length < 20} onClick={() => setPage(p => p + 1)}>Next</button>
        </div>
      </div>
    </Layout>
  );
};

export default AuditLogs;
