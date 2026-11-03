import React, { useState, useEffect } from 'react';
import { Phone, User, Clock, CheckCircle, AlertCircle, History, Headphones } from 'lucide-react';
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

  // Call history state
  const [historyObject, setHistoryObject] = useState('contact');
  const [historyRecordId, setHistoryRecordId] = useState('');
  const [callHistory, setCallHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState(null);

  // Wrap-up state
  const [wrapActivityId, setWrapActivityId] = useState('');
  const [wrapDisposition, setWrapDisposition] = useState('');
  const [wrapNotes, setWrapNotes] = useState('');
  const [wrapLoading, setWrapLoading] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const [s, d, p, all] = await Promise.all([
          telephony.getMyStatus().catch(() => ({ data: { data: { status: 'offline' } } })),
          telephony.getDispositions().catch(() => ({ data: { data: [] } })),
          telephony.getProviders().catch(() => ({ data: { data: [] } })),
          telephony.listStatuses().catch(() => ({ data: { data: [] } })),
        ]);
        setStatus(s?.data?.data?.status || 'offline');
        setDispositions(d?.data?.data || []);
        setProviders(p?.data?.data || []);
        setStatuses(all?.data?.data || []);
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

  const loadHistory = async () => {
    if (!historyObject || !historyRecordId) {
      toast.error('Enter object API name and record ID');
      return;
    }
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const res = await telephony.callHistory({ objectApiName: historyObject, recordId: historyRecordId });
      setCallHistory(res?.data?.data || []);
    } catch (e) {
      setHistoryError(e?.response?.data?.message || 'Failed to load call history');
      setCallHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  const submitWrapUp = async () => {
    if (!wrapActivityId) {
      toast.error('Enter activity ID');
      return;
    }
    setWrapLoading(true);
    try {
      await telephony.wrapUp(wrapActivityId, { disposition: wrapDisposition, notes: wrapNotes });
      toast.success('Wrap-up saved');
      setWrapActivityId('');
      setWrapDisposition('');
      setWrapNotes('');
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Wrap-up failed');
    } finally {
      setWrapLoading(false);
    }
  };

  return (
    <AdminSettingsPage
      title="Call Centre"
      description="Agent status, dispositions, call history, and telephony provider information"
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
        <h2 className={styles.heading}>Call History</h2>
        <p className={styles.hint}>Load call history for a specific record.</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          <input
            className={styles.input}
            placeholder="Object API name (e.g. contact)"
            value={historyObject}
            onChange={(e) => setHistoryObject(e.target.value)}
            style={{ flex: 1, minWidth: 150 }}
          />
          <input
            className={styles.input}
            placeholder="Record ID"
            value={historyRecordId}
            onChange={(e) => setHistoryRecordId(e.target.value)}
            style={{ flex: 2, minWidth: 200 }}
          />
          <button type="button" className={styles.primaryBtn} onClick={loadHistory} disabled={historyLoading}>
            {historyLoading ? 'Loading…' : 'Load History'}
          </button>
        </div>
        {historyError && <p style={{ color: '#dc2626', marginTop: 8 }}>{historyError}</p>}
        {callHistory.length > 0 && (
          <div style={{ marginTop: 12, overflowX: 'auto' }}>
            <table className={styles.table}>
              <thead>
                <tr><th>Subject</th><th>Direction</th><th>Status</th><th>Occurred</th><th>Metadata</th></tr>
              </thead>
              <tbody>
                {callHistory.map((c) => (
                  <tr key={c._id}>
                    <td>{c.subject}</td>
                    <td>{c.direction}</td>
                    <td>{c.status}</td>
                    <td style={{ fontSize: 12 }}>{c.occurredAt ? new Date(c.occurredAt).toLocaleString() : '—'}</td>
                    <td style={{ fontSize: 11, color: '#64748b' }}>
                      {c.metadata?.disposition && <span>Disposition: {c.metadata.disposition}<br /></span>}
                      {c.metadata?.durationSeconds != null && <span>Duration: {c.metadata.durationSeconds}s<br /></span>}
                      {c.metadata?.recordingUrl && <span>Recording: {c.metadata.recordingUrl}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {callHistory.length === 0 && !historyLoading && !historyError && (
          <p className={styles.hint} style={{ marginTop: 8 }}>No call history loaded. Enter object and record ID above.</p>
        )}
      </div>

      <div className={styles.panel}>
        <h2 className={styles.heading}>Call Wrap-Up</h2>
        <p className={styles.hint}>Save disposition and notes to a call Activity.</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
          <input
            className={styles.input}
            placeholder="Activity ID"
            value={wrapActivityId}
            onChange={(e) => setWrapActivityId(e.target.value)}
          />
          <select
            className={styles.input}
            value={wrapDisposition}
            onChange={(e) => setWrapDisposition(e.target.value)}
          >
            <option value="">— Select disposition —</option>
            {dispositions.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
          <textarea
            className={styles.input}
            placeholder="Call notes"
            value={wrapNotes}
            onChange={(e) => setWrapNotes(e.target.value)}
            rows={3}
          />
          <button type="button" className={styles.primaryBtn} onClick={submitWrapUp} disabled={wrapLoading}>
            {wrapLoading ? 'Saving…' : 'Save Wrap-Up'}
          </button>
        </div>
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

      <div className={styles.panel}>
        <h2 className={styles.heading}>Agent Statuses (Supervisor View)</h2>
        {statuses.length === 0 ? (
          <p className={styles.hint}>No agents or no permission.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr><th>Agent</th><th>Status</th><th>Since</th></tr>
            </thead>
            <tbody>
              {statuses.map((s) => (
                <tr key={s._id || s.userId}>
                  <td>{s.userId?.firstName || s.userId?.email || s.userId}</td>
                  <td>{s.status}</td>
                  <td style={{ fontSize: 12 }}>{s.since ? new Date(s.since).toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </AdminSettingsPage>
  );
}