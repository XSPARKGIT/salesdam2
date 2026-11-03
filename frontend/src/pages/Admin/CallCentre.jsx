import React, { useState, useEffect } from 'react';
import { Phone, User, Clock, CheckCircle, AlertCircle } from 'lucide-react';
import telephony from '../../services/api/telephony';
import AdminSettingsPage from '../Admin/AdminSettingsPage';
import toast from 'react-hot-toast';
import styles from '../Admin/AdminSettingsPage.module.css';

const STATUSES = ['available', 'busy', 'away', 'wrap_up', 'offline'];

export default function CallCentre() {
  const [status, setStatus] = useState('offline');
  const [statuses, setStatuses] = useState([]);
  const [dispositions, setDispositions] = useState([]);
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const load = async () => {
      try {
        const [s, d, p] = await Promise.all([
          telephony.getMyStatus().catch(() => ({ data: { data: { status: 'offline' } } })),
          telephony.getDispositions().catch(() => ({ data: { data: [] } })),
          telephony.getProviders().catch(() => ({ data: { data: [] } })),
        ]);
        setStatus(s?.data?.data?.status || 'offline');
        setDispositions(d?.data?.data || []);
        setProviders(p?.data?.data || []);
      } catch (e) {
        setError(e?.response?.data?.message || 'Failed to load call centre data');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const changeStatus = async (newStatus) => {
    try {
      await telephony.setMyStatus(newStatus);
      setStatus(newStatus);
      toast.success(`Status set to ${newStatus}`);
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Failed to update status');
    }
  };

  return (
    <AdminSettingsPage
      title="Call Centre"
      description="Agent status, dispositions, and telephony provider information"
      icon={Phone}
      iconColor="#0ea5e9"
    >
      {loading && <p>Loading…</p>}
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}

      <div className={styles.panel}>
        <h2 className={styles.heading}>My Availability</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => changeStatus(s)}
              style={{
                padding: '6px 12px',
                borderRadius: 6,
                border: status === s ? '2px solid #0ea5e9' : '1px solid #e2e8f0',
                background: status === s ? '#e0f2fe' : '#fff',
                cursor: 'pointer',
                fontWeight: status === s ? 600 : 400,
              }}
            >
              {s}
            </button>
          ))}
        </div>
        <p style={{ marginTop: 8, fontSize: 13, color: '#64748b' }}>
          Current status: <strong>{status}</strong>
        </p>
      </div>

      <div className={styles.panel}>
        <h2 className={styles.heading}>Call Dispositions</h2>
        <p className={styles.hint}>Tenant-configurable call outcomes (from TenantConfiguration).</p>
        {dispositions.length === 0 ? (
          <p className={styles.hint}>No dispositions configured.</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {dispositions.map((d) => (
              <li key={d} style={{ fontSize: 13 }}>{d}</li>
            ))}
          </ul>
        )}
      </div>

      <div className={styles.panel}>
        <h2 className={styles.heading}>Telephony Providers</h2>
        {providers.length === 0 ? (
          <p className={styles.hint}>No providers available.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr><th>Provider</th><th>Label</th><th>Call Control</th><th>Note</th></tr>
            </thead>
            <tbody>
              {providers.map((p) => (
                <tr key={p.provider}>
                  <td>{p.provider}</td>
                  <td>{p.label}</td>
                  <td>{p.callControlImplemented ? 'Yes' : 'No'}</td>
                  <td style={{ fontSize: 12, color: '#64748b' }}>{p.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className={styles.hint} style={{ marginTop: 8 }}>
          Outbound call control requires a live Euphoria API contract. Until configured, dial operations return 501.
        </p>
      </div>
    </AdminSettingsPage>
  );
}