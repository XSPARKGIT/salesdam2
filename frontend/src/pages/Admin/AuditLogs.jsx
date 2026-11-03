import { useEffect, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import Layout from '../../layout/Layout';
import api from '../../services/api';

const AuditLogs = () => {
  const { user, isAdmin } = useAuth();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({
    action: '',
    objectApiName: '',
    resourceId: '',
    from: '',
    to: '',
    userId: '',
  });

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('page', page);
      params.set('limit', '20');
      if (filters.action) params.set('action', filters.action);
      if (filters.objectApiName) params.set('objectApiName', filters.objectApiName);
      if (filters.resourceId) params.set('resourceId', filters.resourceId);
      if (filters.from) params.set('from', filters.from);
      if (filters.to) params.set('to', filters.to);
      if (isAdmin && filters.userId) params.set('userId', filters.userId);

      const res = await api.get(`/admin/logs?${params.toString()}`);
      const json = res.data;
      const items = Array.isArray(json?.data) ? json.data : (json?.data?.items || []);
      setLogs(items);
    } catch (e) {
      setError(e?.response?.data?.message || e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [page]);

  const applyFilters = () => { setPage(1); load(); };
  const clearFilters = () => {
    setFilters({ action: '', objectApiName: '', resourceId: '', from: '', to: '', userId: '' });
    setPage(1);
  };

  return (
    <Layout title="Audit Logs" description="Administrator audit trail">
      <div style={{ padding: '1rem' }}>
        <h1>Audit Logs</h1>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem', alignItems: 'flex-end' }}>
          <input placeholder="Action" value={filters.action} onChange={(e) => setFilters((f) => ({ ...f, action: e.target.value }))} style={{ padding: '4px 8px' }} />
          <input placeholder="Object API name" value={filters.objectApiName} onChange={(e) => setFilters((f) => ({ ...f, objectApiName: e.target.value }))} style={{ padding: '4px 8px' }} />
          <input placeholder="Resource ID" value={filters.resourceId} onChange={(e) => setFilters((f) => ({ ...f, resourceId: e.target.value }))} style={{ padding: '4px 8px' }} />
          {isAdmin && <input placeholder="User ID" value={filters.userId} onChange={(e) => setFilters((f) => ({ ...f, userId: e.target.value }))} style={{ padding: '4px 8px' }} />}
          <input type="date" value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} style={{ padding: '4px 8px' }} />
          <input type="date" value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} style={{ padding: '4px 8px' }} />
          <button onClick={applyFilters}>Apply</button>
          <button onClick={clearFilters}>Clear</button>
        </div>

        {loading && <p>Loading...</p>}
        {error && <p style={{ color: '#dc2626' }}>{error}</p>}
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
                <td>{l.resource} {l.resourceId ? `#${l.resourceId}` : ''} {l.objectApiName ? `(${l.objectApiName})` : ''}</td>
                <td>{l.userEmail || l.userId?.email || l.userId?._id || ''}</td>
                <td>{l.ipAddress}</td>
                <td>{l.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</button>
          <span>Page {page}</span>
          <button disabled={logs.length < 20} onClick={() => setPage((p) => p + 1)}>Next</button>
        </div>
      </div>
    </Layout>
  );
};

export default AuditLogs;