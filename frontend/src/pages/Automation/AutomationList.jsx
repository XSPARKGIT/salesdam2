import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Plus,
  Zap,
  Edit2,
  Trash2,
  ToggleLeft,
  ToggleRight,
  Clock,
  Database,
  Globe,
  ChevronRight,
  AlertCircle,
  CheckCircle,
  Monitor,
  Play,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../services/api';
import Button from '../../components/common/Button/Button';
import Layout from '../../layout/Layout';
import styles from './AutomationList.module.css';

const TYPE_META = {
  record_triggered: {
    label: 'Record Triggered',
    icon: <Database size={14} />,
    color: '#6366f1',
  },
  scheduled: {
    label: 'Scheduled',
    icon: <Clock size={14} />,
    color: '#f59e0b',
  },
  screen_flow: {
    label: 'Screen Flow',
    icon: <Monitor size={14} />,
    color: '#ec4899',
  },
  autolaunched: {
    label: 'Autolaunched',
    icon: <Zap size={14} />,
    color: '#3b82f6',
  },
};

const EVENT_LABELS = {
  create: 'Created',
  update: 'Updated',
  delete: 'Deleted',
  all: 'Any change',
};

function StatusDot({ isActive }) {
  return (
    <span
      className={`${styles.dot} ${isActive ? styles.dotActive : styles.dotInactive}`}
      title={isActive ? 'Active' : 'Inactive'}
    />
  );
}

function StatPill({ label, value, variant }) {
  return (
    <span className={`${styles.stat} ${variant ? styles[variant] : ''}`}>
      {label && <span className={styles.statLabel}>{label}</span>}
      <span>{value}</span>
    </span>
  );
}

export default function AutomationList() {
  const [automations, setAutomations] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get('/automations');
      setAutomations(res.data.data || []);
    } catch {
      toast.error('Failed to load automations.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleToggle = async (auto) => {
    if (!auto.isActive && !auto.isValid) {
      toast.error('Automation must be saved and valid before activating.');
      return;
    }
    try {
      const res = await api.patch(`/automations/${auto._id}/toggle`);
      setAutomations((prev) =>
        prev.map((a) =>
          a._id === auto._id ? { ...a, isActive: res.data.data.isActive } : a,
        ),
      );
      toast.success(res.data.data.isActive ? 'Activated' : 'Deactivated');
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this automation?')) return;
    try {
      await api.delete(`/automations/${id}`);
      toast.success('Deleted.');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const groups = {
    record_triggered: automations.filter((a) => a.type === 'record_triggered'),
    scheduled: automations.filter((a) => a.type === 'scheduled'),
    screen_flow: automations.filter((a) => a.type === 'screen_flow'),
    other: automations.filter(
      (a) => !['record_triggered', 'scheduled', 'screen_flow'].includes(a.type),
    ),
  };

  return (
    <Layout
      title="Automation"
      description="Create and manage automated workflows and flows"
    >
      <div className={styles.page}>
        {/* Header */}
        <div className={styles.header}>
          <div>
            <h1 className={styles.title}>Automation</h1>
            <p className={styles.subtitle}>
              Build record-triggered and scheduled workflows
            </p>
          </div>
          <div className={styles.headerActions}>
            <Link to="/automation/errors">
              <Button variant="secondary" icon={<AlertCircle size={14} />}>Error Log</Button>
            </Link>
            <Link to="/automation/new">
              <Button icon={<Plus size={14} />}>New Automation</Button>
            </Link>
          </div>
        </div>

        {loading ? (
          <div className={styles.skeletons}>
            {[1, 2, 3].map((i) => (
              <div key={i} className={styles.skeleton} />
            ))}
          </div>
        ) : automations.length === 0 ? (
          <div className={styles.empty}>
            <Zap size={48} strokeWidth={1} className={styles.emptyIcon} />
            <h3>No automations yet</h3>
            <p>Create your first automation to start automating your CRM.</p>
            <Link to="/automation/new">
              <Button>Create Automation</Button>
            </Link>
          </div>
        ) : (
          <div className={styles.content}>
            {[
              { key: 'record_triggered', label: 'Record-Triggered' },
              { key: 'scheduled', label: 'Scheduled' },
              { key: 'screen_flow', label: 'Screen Flows' },
              { key: 'other', label: 'Other' },
            ].map(({ key, label }) => {
              const items = groups[key];
              if (!items.length) return null;
              const meta = TYPE_META[key] || TYPE_META.autolaunched;
              return (
                <div key={key} className={styles.group}>
                  <div className={styles.groupHeader}>
                    <span
                      className={styles.groupIcon}
                      style={{ color: meta.color }}
                    >
                      {meta.icon}
                    </span>
                    <span className={styles.groupLabel}>{label}</span>
                    <span className={styles.groupCount}>{items.length}</span>
                  </div>
                  <div className={styles.list}>
                    {items.map((auto) => {
                      const tm = TYPE_META[auto.type] || TYPE_META.autolaunched;
                      const events = (auto.trigger?.events || [])
                        .map((e) => EVENT_LABELS[e] || e)
                        .join(', ');
                      const lastStatus = auto.stats?.lastRunStatus;
                      return (
                        <div
                          key={auto._id}
                          className={`${styles.card} ${auto.isActive ? styles.cardActive : ''}`}
                        >
                          <div className={styles.cardLeft}>
                            <StatusDot isActive={auto.isActive} />
                            <div className={styles.cardBody}>
                              <div className={styles.cardTop}>
                                <span className={styles.autoName}>
                                  {auto.name}
                                </span>
                                {!auto.isValid && (
                                  <span className={styles.invalidBadge}>
                                    <AlertCircle size={11} /> Draft
                                  </span>
                                )}
                              </div>
                              <div className={styles.autoMeta}>
                                <span
                                  className={styles.typeTag}
                                  style={{
                                    borderColor: tm.color,
                                    color: tm.color,
                                  }}
                                >
                                  {tm.icon} {tm.label}
                                </span>
                                {auto.trigger?.objectApiName && (
                                  <span className={styles.metaItem}>
                                    <Database size={11} />{' '}
                                    {auto.trigger.objectApiName}
                                  </span>
                                )}
                                {events && (
                                  <span className={styles.metaItem}>
                                    <ChevronRight size={11} /> {events}
                                  </span>
                                )}
                                {auto.trigger?.schedule?.cron && (
                                  <span className={styles.metaItem}>
                                    <Clock size={11} />{' '}
                                    {auto.trigger.schedule.cron}
                                  </span>
                                )}
                              </div>
                              {auto.description && (
                                <p className={styles.autoDesc}>
                                  {auto.description}
                                </p>
                              )}
                            </div>
                          </div>
                          <div className={styles.cardRight}>
                            <div className={styles.statsRow}>
                              <StatPill
                                label="Runs"
                                value={auto.stats?.totalRuns || 0}
                              />
                              {auto.stats?.successRuns > 0 && (
                                <StatPill
                                  value={auto.stats.successRuns}
                                  variant="success"
                                />
                              )}
                              {auto.stats?.failedRuns > 0 && (
                                <StatPill
                                  value={auto.stats.failedRuns}
                                  variant="danger"
                                />
                              )}
                              {lastStatus && (
                                <span
                                  className={`${styles.lastStatus} ${styles[lastStatus]}`}
                                >
                                  {lastStatus === 'success' ? (
                                    <CheckCircle size={11} />
                                  ) : (
                                    <AlertCircle size={11} />
                                  )}
                                  {lastStatus}
                                </span>
                              )}
                            </div>
                            <div className={styles.actions}>
                              <button
                                className={`${styles.toggleBtn} ${auto.isActive ? styles.toggleOn : ''}`}
                                onClick={() => handleToggle(auto)}
                                title={
                                  auto.isActive ? 'Deactivate' : 'Activate'
                                }
                              >
                                {auto.isActive ? (
                                  <ToggleRight size={22} />
                                ) : (
                                  <ToggleLeft size={22} />
                                )}
                              </button>
                              <button
                                className={styles.actionBtn}
                                onClick={() =>
                                  navigate(`/automation/${auto._id}`)
                                }
                                title="Edit"
                              >
                                <Edit2 size={14} />
                              </button>
                              <button
                                className={`${styles.actionBtn} ${styles.dangerBtn}`}
                                onClick={() => handleDelete(auto._id)}
                                title="Delete"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Layout>
  );
}
