import React, { useState, useEffect } from 'react';
import { Database, HardDrive, RotateCcw, Save } from 'lucide-react';
import api from '../../../services/api';
import AdminSettingsPage from '../AdminSettingsPage';
import Button from '../../../components/common/Button/Button';
import toast from 'react-hot-toast';
import styles from '../AdminSettingsPage.module.css';

export default function DataGovernance() {
  const [rules, setRules] = useState([]);
  const [backups, setBackups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newCategory, setNewCategory] = useState('business_records');
  const [newDays, setNewDays] = useState(90);
  const [creating, setCreating] = useState(false);
  const [backingUp, setBackingUp] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [r, b] = await Promise.all([
        api.get('/data-governance/retention-rules'),
        api.get('/data-governance/backups'),
      ]);
      setRules(r.data?.data || []);
      setBackups(b.data?.data || []);
    } catch (e) {
      toast.error('Failed to load data governance settings.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const createRule = async () => {
    setCreating(true);
    try {
      await api.put(`/data-governance/retention-rules/${newCategory}`, { retentionDays: newDays });
      toast.success('Retention rule saved.');
      load();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to save rule.');
    } finally {
      setCreating(false);
    }
  };

  const enforceRetention = async (category) => {
    try {
      const res = await api.post('/data-governance/retention/enforce', { category });
      toast.success(`Retention enforced: ${res.data?.data?.affected ?? 0} records affected.`);
      load();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Enforcement failed.');
    }
  };

  const createBackup = async () => {
    setBackingUp(true);
    try {
      const res = await api.post('/data-governance/backups', { type: 'full' });
      toast.success(`Backup created (${res.data?.data?.componentCount} components).`);
      load();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Backup failed.');
    } finally {
      setBackingUp(false);
    }
  };

  const restoreBackup = async (id) => {
    if (!window.confirm('Restore this backup? This will overwrite current data.')) return;
    try {
      await api.post(`/data-governance/backups/${id}/restore`);
      toast.success('Backup restored.');
      load();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Restore failed.');
    }
  };

  return (
    <AdminSettingsPage
      title="Data Governance & Backup"
      description="Retention rules, backups, and recovery"
      icon={Database}
      iconColor="#0ea5e9"
    >
      <div className={styles.panel}>
        <h2 className={styles.heading}>Retention Rules</h2>
        <p className={styles.hint}>Configure how long data is retained before purging.</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          <select className={styles.input} value={newCategory} onChange={(e) => setNewCategory(e.target.value)} style={{ flex: 1, minWidth: 200 }}>
            {['business_records', 'communication_history', 'call_recordings', 'audit_logs', 'generated_documents', 'uploaded_files', 'integration_logs'].map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <input className={styles.input} type="number" min={1} value={newDays} onChange={(e) => setNewDays(parseInt(e.target.value) || 90)} style={{ width: 100 }} />
          <Button onClick={createRule} disabled={creating} icon={<Save size={14} />}>
            {creating ? 'Saving…' : 'Save Rule'}
          </Button>
        </div>
        {loading ? <p className={styles.hint}>Loading…</p> : (
          <table className={styles.table} style={{ marginTop: 12 }}>
            <thead>
              <tr><th>Category</th><th>Retention (days)</th><th>Enabled</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r._id}>
                  <td>{r.category}</td>
                  <td>{r.retentionDays}</td>
                  <td>{r.enabled ? 'Yes' : 'No'}</td>
                  <td>
                    <Button size="sm" variant="secondary" onClick={() => enforceRetention(r.category)}>
                      Enforce
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className={styles.panel}>
        <h2 className={styles.heading}>Backups</h2>
        <p className={styles.hint}>Create and restore tenant backups.</p>
        <Button onClick={createBackup} disabled={backingUp} icon={<HardDrive size={14} />} style={{ marginBottom: 12 }}>
          {backingUp ? 'Creating…' : 'Create Backup'}
        </Button>
        {backups.length === 0 ? (
          <p className={styles.hint}>No backups yet.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr><th>Status</th><th>Type</th><th>Components</th><th>Size</th><th>Created</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {backups.map((b) => (
                <tr key={b._id}>
                  <td>{b.status}</td>
                  <td>{b.type}</td>
                  <td>{b.componentCount}</td>
                  <td>{Math.round((b.artifactSizeBytes || 0) / 1024)} KB</td>
                  <td style={{ fontSize: 12 }}>{new Date(b.createdAt).toLocaleString()}</td>
                  <td>
                    {b.status === 'completed' && (
                      <Button size="sm" variant="secondary" onClick={() => restoreBackup(b._id)} icon={<RotateCcw size={13} />}>
                        Restore
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </AdminSettingsPage>
  );
}