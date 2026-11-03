import { useEffect, useState } from 'react';
import Layout from '../../layout/Layout';
import AdminSettingsPage from './AdminSettingsPage';

const base = () => import.meta.env.VITE_API_URL || 'http://localhost:5002';

const BackupRecovery = () => {
  const [backups, setBackups] = useState([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${base()}/api/v1/admin/backups`, { credentials: 'include' });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message || 'Failed to load');
      setBackups(Array.isArray(json?.data) ? json.data : (json?.data?.items || []));
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const create = async () => {
    setCreating(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`${base()}/api/v1/admin/backups`, { method: 'POST', credentials: 'include' });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message || 'Backup failed');
      setMessage(`Backup created: ${json?.data?.id}`);
      await load();
    } catch (e) { setError(e.message); }
    finally { setCreating(false); }
  };

  const verify = async (id) => {
    try {
      const res = await fetch(`${base()}/api/v1/admin/backups/${id}/verify`, { credentials: 'include' });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message || 'Verify failed');
      setMessage(`Backup ${id} is valid.`);
    } catch (e) { setError(e.message); }
  };

  const remove = async (id) => {
    if (!window.confirm('Delete this backup?')) return;
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`${base()}/api/v1/admin/backups/${id}`, { method: 'DELETE', credentials: 'include' });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message || 'Delete failed');
      setMessage(`Deleted ${id}`);
      await load();
    } catch (e) { setError(e.message); }
  };

  const restore = async (id) => {
    if (!window.confirm('Restore this backup? This will replace current tenant data.')) return;
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`${base()}/api/v1/admin/backups/${id}/restore`, { method: 'POST', credentials: 'include' });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message || 'Restore failed');
      setMessage(`Restored: ${JSON.stringify(json?.data?.restored || {})}`);
      await load();
    } catch (e) { setError(e.message); }
  };

  return (
    <AdminSettingsPage title="Backup & Recovery" description="Create and verify tenant backups" icon={null}>
      <div style={{ padding: '1rem' }}>
        <button onClick={create} disabled={creating}>{creating ? 'Creating...' : 'Create Backup'}</button>
        {message && <p style={{ color: '#16a34a' }}>{message}</p>}
        {error && <p style={{ color: '#dc2626' }}>{error}</p>}
        {loading && <p>Loading...</p>}
        {!loading && backups.length === 0 && <p>No backups.</p>}
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {backups.map((b) => (
            <li key={b.id} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem' }}>
              <span>{b.id}</span>
              <span style={{ fontSize: '0.75rem', color: '#64748b' }}>{b.createdAt}</span>
              <button onClick={() => verify(b.id)}>Verify</button>
              <button onClick={() => restore(b.id)}>Restore</button>
              <button onClick={() => remove(b.id)} style={{ color: '#dc2626' }}>Delete</button>
            </li>
          ))}
        </ul>
      </div>
    </AdminSettingsPage>
  );
};

export default BackupRecovery;
