import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, RefreshCw, Trash2, ChevronRight } from 'lucide-react';
import api from '../../services/api';
import Layout from '../../layout/Layout';
import Button from '../../components/common/Button/Button';
import styles from './FlowErrors.module.css';

function timeAgo(date) {
  const s = Math.floor((Date.now() - new Date(date)) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function FlowErrors() {
  const [errors, setErrors] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/automations/errors', { params: { limit: 100 } });
      const data = res.data.data;
      setErrors(data.items || data || []);
      setTotal(data.total ?? (data.items?.length ?? 0));
    } catch {
      setErrors([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const dismiss = async (id) => {
    try {
      await api.delete(`/automations/errors/${id}`);
      setErrors((prev) => prev.filter((e) => e._id !== id));
    } catch {
      // silently ignore
    }
  };

  return (
    <Layout>
      <div className={styles.page}>
        <div className={styles.header}>
          <div>
            <h1 className={styles.title}>Flow Error Log</h1>
            <p className={styles.subtitle}>
              Step failures from record-triggered and autolaunched flows — last 90 days
            </p>
          </div>
          <Button variant="secondary" onClick={load} disabled={loading}>
            <RefreshCw size={14} style={{ marginRight: 6 }} />
            Refresh
          </Button>
        </div>

        {loading ? (
          <div className={styles.empty}>Loading…</div>
        ) : errors.length === 0 ? (
          <div className={styles.empty}>
            <AlertTriangle size={32} className={styles.emptyIcon} />
            <p>No flow errors recorded.</p>
          </div>
        ) : (
          <>
            <p className={styles.count}>{total} error{total !== 1 ? 's' : ''} recorded</p>
            <div className={styles.table}>
              <div className={styles.thead}>
                <span>Time</span>
                <span>Automation</span>
                <span>Object</span>
                <span>Step</span>
                <span>Error</span>
                <span></span>
              </div>

              {errors.map((e) => (
                <div key={e._id} className={styles.group}>
                  <div
                    className={`${styles.row} ${expanded === e._id ? styles.rowExpanded : ''}`}
                    onClick={() => setExpanded((x) => (x === e._id ? null : e._id))}
                  >
                    <span className={styles.cell} title={new Date(e.createdAt).toLocaleString()}>
                      {timeAgo(e.createdAt)}
                    </span>
                    <span className={styles.cell}>
                      {e.automationId ? (
                        <Link
                          to={`/automation/${e.automationId}`}
                          className={styles.link}
                          onClick={(ev) => ev.stopPropagation()}
                        >
                          {e.automationName || e.automationId}
                        </Link>
                      ) : (
                        <span className={styles.muted}>—</span>
                      )}
                    </span>
                    <span className={styles.cell}>{e.objectApiName || <span className={styles.muted}>—</span>}</span>
                    <span className={styles.cell}>
                      <span className={styles.stepType}>{e.stepType}</span>
                      {e.stepLabel && e.stepLabel !== e.stepType && (
                        <span className={styles.stepLabel}>{e.stepLabel}</span>
                      )}
                    </span>
                    <span className={`${styles.cell} ${styles.errorMsg}`}>{e.errorMessage}</span>
                    <span className={styles.cellActions} onClick={(ev) => ev.stopPropagation()}>
                      <ChevronRight
                        size={14}
                        className={`${styles.chevron} ${expanded === e._id ? styles.chevronOpen : ''}`}
                      />
                      <button
                        className={styles.dismissBtn}
                        title="Dismiss"
                        onClick={() => dismiss(e._id)}
                      >
                        <Trash2 size={13} />
                      </button>
                    </span>
                  </div>

                  {expanded === e._id && (
                    <div className={styles.detail}>
                      <div className={styles.detailMeta}>
                        <span><strong>Record ID:</strong> {e.recordId || '—'}</span>
                        <span><strong>Step ID:</strong> {e.stepId || '—'}</span>
                        <span><strong>Time:</strong> {new Date(e.createdAt).toLocaleString()}</span>
                      </div>
                      {e.errorStack && (
                        <pre className={styles.stack}>{e.errorStack}</pre>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
