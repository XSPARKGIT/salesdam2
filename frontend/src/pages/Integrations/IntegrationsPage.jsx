import React, { useState, useEffect } from 'react';
import {
  Key,
  Plus,
  Trash2,
  ShieldCheck,
  Copy,
  Check,
  AlertCircle,
  Globe,
  Lock,
  Clock,
  Activity,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  BarChart2,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import toast from 'react-hot-toast';
import api from '../../services/api';
import { useTenantContext } from '../../context/TenantContext';
import Button from '../../components/common/Button/Button';
import Modal from '../../components/common/Modal/Modal';
import Layout from '../../layout/Layout';
import styles from './IntegrationsPage.module.css';

const SCOPE_INFO = {
  read: {
    label: 'Read',
    desc: 'List and retrieve records, objects, fields',
    color: '#22c55e',
  },
  write: {
    label: 'Write',
    desc: 'Create and update records and objects',
    color: '#3b82f6',
  },
  delete: {
    label: 'Delete',
    desc: 'Delete records and objects',
    color: '#f97316',
  },
  admin: {
    label: 'Admin',
    desc: 'Full access including users and settings',
    color: '#ef4444',
  },
};

// ─── Copy button ──────────────────────────────────────────────────────────────
function CopyBtn({ text, label }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className={styles.copyBtn}
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
      title={`Copy ${label || ''}`}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </button>
  );
}

// ─── Create API Key modal ─────────────────────────────────────────────────────
function CreateKeyModal({ isOpen, onClose, onCreated }) {
  const [form, setForm] = useState({
    name: '',
    description: '',
    scopes: ['read'],
    expiresAt: '',
    ipWhitelist: '',
    allowedObjects: [],
  });
  const [saving, setSaving] = useState(false);
  const [objects, setObjects] = useState([]);

  useEffect(() => {
    if (isOpen) {
      setForm({
        name: '',
        description: '',
        scopes: ['read'],
        expiresAt: '',
        ipWhitelist: '',
        allowedObjects: [],
      });
      api
        .get('/objects')
        .then((r) => setObjects(r.data.data || []))
        .catch(() => {});
    }
  }, [isOpen]);

  const toggleScope = (s) =>
    setForm((f) => ({
      ...f,
      scopes: f.scopes.includes(s)
        ? f.scopes.filter((x) => x !== s)
        : [...f.scopes, s],
    }));
  const toggleObject = (apiName) =>
    setForm((f) => ({
      ...f,
      allowedObjects: f.allowedObjects.includes(apiName)
        ? f.allowedObjects.filter((x) => x !== apiName)
        : [...f.allowedObjects, apiName],
    }));
  const selectAllObjects = () =>
    setForm((f) => ({ ...f, allowedObjects: objects.map((o) => o.apiName) }));
  const clearAllObjects = () => setForm((f) => ({ ...f, allowedObjects: [] }));

  const handleCreate = async () => {
    if (!form.name.trim()) {
      toast.error('Name is required.');
      return;
    }
    if (!form.scopes.length) {
      toast.error('Select at least one scope.');
      return;
    }
    setSaving(true);
    try {
      const res = await api.post('/api-keys', {
        name: form.name,
        description: form.description,
        scopes: form.scopes,
        expiresAt: form.expiresAt || undefined,
        ipWhitelist: form.ipWhitelist
          ? form.ipWhitelist
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : [],
        allowedObjects: form.allowedObjects, // empty = all objects
      });
      onCreated(res.data.data);
      onClose();
    } catch (err) {
      toast.error(err.message || 'Create failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Create API Key"
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={saving} onClick={handleCreate}>
            Create Key
          </Button>
        </>
      }
    >
      <div className={styles.keyForm}>
        <div className={styles.keyField}>
          <label className={styles.keyLabel}>Name *</label>
          <input
            className={styles.keyInput}
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="e.g. Mobile App Integration"
          />
        </div>
        <div className={styles.keyField}>
          <label className={styles.keyLabel}>Description</label>
          <input
            className={styles.keyInput}
            value={form.description}
            onChange={(e) =>
              setForm((f) => ({ ...f, description: e.target.value }))
            }
            placeholder="What is this key used for?"
          />
        </div>
        <div className={styles.keyField}>
          <label className={styles.keyLabel}>Scopes *</label>
          <p className={styles.keyHint}>
            Grant only the minimum permissions required (principle of least
            privilege)
          </p>
          <div className={styles.scopeGrid}>
            {Object.entries(SCOPE_INFO).map(([scope, info]) => (
              <label
                key={scope}
                className={`${styles.scopeCard} ${form.scopes.includes(scope) ? styles.scopeOn : ''}`}
              >
                <input
                  type="checkbox"
                  checked={form.scopes.includes(scope)}
                  onChange={() => toggleScope(scope)}
                  style={{ display: 'none' }}
                />
                <span
                  className={styles.scopeDot}
                  style={{ background: info.color }}
                />
                <div>
                  <span className={styles.scopeName}>{info.label}</span>
                  <span className={styles.scopeDesc}>{info.desc}</span>
                </div>
              </label>
            ))}
          </div>
        </div>
        {/* Object access restriction */}
        <div className={styles.keyField}>
          <div className={styles.objectPickerHeader}>
            <div>
              <label className={styles.keyLabel}>Allowed Objects</label>
              <p className={styles.keyHint}>
                {form.allowedObjects.length === 0
                  ? 'All objects accessible — check specific objects to restrict access'
                  : `Restricted to ${form.allowedObjects.length} object${form.allowedObjects.length > 1 ? 's' : ''}`}
              </p>
            </div>
            <div className={styles.objectPickerActions}>
              <button
                type="button"
                className={styles.objPickerBtn}
                onClick={selectAllObjects}
              >
                All
              </button>
              <button
                type="button"
                className={styles.objPickerBtn}
                onClick={clearAllObjects}
              >
                None
              </button>
            </div>
          </div>
          <div className={styles.objectList}>
            {objects.map((obj) => {
              const checked = form.allowedObjects.includes(obj.apiName);
              return (
                <label
                  key={obj.apiName}
                  className={`${styles.objectItem} ${checked ? styles.objectOn : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleObject(obj.apiName)}
                    style={{ display: 'none' }}
                  />
                  <span
                    className={styles.objectDot}
                    style={{ background: obj.color || '#6366f1' }}
                  />
                  <span className={styles.objectLabel}>{obj.label}</span>
                  <code className={styles.objectApiName}>{obj.apiName}</code>
                </label>
              );
            })}
            {objects.length === 0 && (
              <p
                className={styles.keyHint}
                style={{ padding: '8px', fontStyle: 'italic' }}
              >
                Loading objects…
              </p>
            )}
          </div>
        </div>

        <div className={styles.keyRow}>
          <div className={styles.keyField}>
            <label className={styles.keyLabel}>Expiry Date</label>
            <input
              type="date"
              className={styles.keyInput}
              value={form.expiresAt}
              min={new Date().toISOString().split('T')[0]}
              onChange={(e) =>
                setForm((f) => ({ ...f, expiresAt: e.target.value }))
              }
            />
            <p className={styles.keyHint}>Leave blank for no expiry</p>
          </div>
          <div className={styles.keyField}>
            <label className={styles.keyLabel}>IP Whitelist</label>
            <input
              className={styles.keyInput}
              value={form.ipWhitelist}
              onChange={(e) =>
                setForm((f) => ({ ...f, ipWhitelist: e.target.value }))
              }
              placeholder="192.168.1.1, 10.0.0.0/24"
            />
            <p className={styles.keyHint}>Comma-separated. Empty = any IP</p>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ─── Show raw key once modal ──────────────────────────────────────────────────
function NewKeyModal({ keyData, onClose }) {
  const [shown, setShown] = useState(false);
  if (!keyData) return null;
  return (
    <Modal
      isOpen={!!keyData}
      onClose={onClose}
      title="API Key Created"
      size="md"
      footer={<Button onClick={onClose}>I've saved the key — close</Button>}
    >
      <div className={styles.newKeyBody}>
        <div className={styles.newKeyWarning}>
          <AlertCircle size={18} />
          <span>
            <strong>Copy this key now.</strong> It will never be shown again.
          </span>
        </div>
        <div className={styles.newKeyBlock}>
          <code className={styles.newKeyMask}>
            {shown ? keyData.rawKey : keyData.rawKey?.replace(/./g, '•')}
          </code>
          <div className={styles.newKeyBtns}>
            <button
              className={styles.copyBtn}
              onClick={() => setShown((s) => !s)}
              title={shown ? 'Hide' : 'Reveal'}
            >
              {shown ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
            <CopyBtn text={keyData.rawKey} label="API key" />
          </div>
        </div>
        <div className={styles.newKeyMeta}>
          <div>
            <strong>Name:</strong> {keyData.name}
          </div>
          <div>
            <strong>Prefix:</strong> <code>{keyData.keyPrefix}</code>
          </div>
          <div>
            <strong>Scopes:</strong> {(keyData.scopes || []).join(', ')}
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ─── Usage modal ─────────────────────────────────────────────────────────────
const METHOD_COLORS = {
  GET: '#22c55e',
  POST: '#3b82f6',
  PUT: '#f59e0b',
  PATCH: '#f59e0b',
  DELETE: '#ef4444',
};
const STATUS_COLORS = {
  '2xx': '#22c55e',
  '3xx': '#64748b',
  '4xx': '#f59e0b',
  '5xx': '#ef4444',
};

function StatBox({ label, value, sub, color }) {
  return (
    <div className={styles.statBox}>
      <span className={styles.statVal} style={color ? { color } : {}}>
        {value}
      </span>
      <span className={styles.statLabel}>{label}</span>
      {sub && <span className={styles.statSub}>{sub}</span>}
    </div>
  );
}

function UsageModal({ keyItem, isOpen, onClose }) {
  const [period, setPeriod] = useState('7d');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen || !keyItem) return;
    setLoading(true);
    api
      .get(`/api-keys/${keyItem._id}/usage`, { params: { period } })
      .then((r) => setData(r.data.data))
      .catch(() => toast.error('Failed to load usage data'))
      .finally(() => setLoading(false));
  }, [isOpen, keyItem, period]);

  if (!keyItem) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Usage — ${keyItem.name}`}
      size="xl"
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      {/* Period selector */}
      <div className={styles.usageHeader}>
        <div className={styles.usagePeriodBtns}>
          {['7d', '30d', '90d'].map((p) => (
            <button
              key={p}
              className={`${styles.periodBtn} ${period === p ? styles.periodActive : ''}`}
              onClick={() => setPeriod(p)}
            >
              Last {p === '7d' ? '7 days' : p === '30d' ? '30 days' : '90 days'}
            </button>
          ))}
        </div>
        {data && (
          <span className={styles.usageSince}>
            Since {new Date(data.since).toLocaleDateString()}
          </span>
        )}
      </div>

      {loading ? (
        <div className={styles.usageLoading}>
          <div className={styles.spinner} />
        </div>
      ) : data ? (
        <div className={styles.usageBody}>
          {/* Summary stats */}
          <div className={styles.statsRow}>
            <StatBox
              label="Total calls"
              value={data.total.toLocaleString()}
              sub={`Lifetime: ${data.lifetimeTotal?.toLocaleString()}`}
            />
            <StatBox
              label="Success rate"
              value={`${data.successRate}%`}
              color={
                data.successRate >= 95
                  ? '#22c55e'
                  : data.successRate >= 80
                    ? '#f59e0b'
                    : '#ef4444'
              }
            />
            <StatBox
              label="Errors"
              value={data.errors.toLocaleString()}
              color={data.errors > 0 ? '#ef4444' : undefined}
            />
            <StatBox
              label="Avg response"
              value={`${data.avgResponseMs} ms`}
              color={data.avgResponseMs > 500 ? '#f59e0b' : undefined}
            />
            {data.lastUsedAt && (
              <StatBox
                label="Last used"
                value={new Date(data.lastUsedAt).toLocaleDateString()}
                sub={new Date(data.lastUsedAt).toLocaleTimeString()}
              />
            )}
          </div>

          {/* Calls per day chart */}
          {data.byDay?.length > 0 && (
            <div className={styles.chartSection}>
              <div className={styles.chartTitle}>Calls per day</div>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart
                  data={data.byDay}
                  margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="var(--border-color)"
                  />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11 }}
                    tickFormatter={(d) => d.slice(5)}
                  />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip
                    formatter={(v, n) => [
                      v,
                      n === 'count' ? 'Total' : 'Errors',
                    ]}
                    labelFormatter={(d) => `Date: ${d}`}
                  />
                  <Bar
                    dataKey="count"
                    name="count"
                    fill="#3b82f6"
                    radius={[3, 3, 0, 0]}
                  />
                  <Bar
                    dataKey="errors"
                    name="errors"
                    fill="#ef4444"
                    radius={[3, 3, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className={styles.usageCols}>
            {/* By HTTP method */}
            {data.byMethod?.length > 0 && (
              <div className={styles.usageCol}>
                <div className={styles.chartTitle}>By method</div>
                {data.byMethod.map((m) => (
                  <div key={m.method} className={styles.barRow}>
                    <span
                      className={styles.barLabel}
                      style={{ color: METHOD_COLORS[m.method] || '#64748b' }}
                    >
                      {m.method}
                    </span>
                    <div className={styles.barTrack}>
                      <div
                        className={styles.barFill}
                        style={{
                          width: `${(m.count / data.total) * 100}%`,
                          background: METHOD_COLORS[m.method] || '#64748b',
                        }}
                      />
                    </div>
                    <span className={styles.barCount}>
                      {m.count.toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* By object */}
            {data.byObject?.length > 0 && (
              <div className={styles.usageCol}>
                <div className={styles.chartTitle}>Top objects</div>
                {data.byObject.map((o) => (
                  <div key={o.object} className={styles.barRow}>
                    <span className={styles.barLabel}>{o.object}</span>
                    <div className={styles.barTrack}>
                      <div
                        className={styles.barFill}
                        style={{
                          width: `${(o.count / data.byObject[0].count) * 100}%`,
                          background: '#6366f1',
                        }}
                      />
                    </div>
                    <span className={styles.barCount}>
                      {o.count.toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* By status group */}
            {data.byStatus?.length > 0 && (
              <div className={styles.usageCol}>
                <div className={styles.chartTitle}>Status codes</div>
                {data.byStatus.map((s) => (
                  <div key={s.group} className={styles.barRow}>
                    <span
                      className={styles.barLabel}
                      style={{ color: STATUS_COLORS[s.group] }}
                    >
                      {s.group}
                    </span>
                    <div className={styles.barTrack}>
                      <div
                        className={styles.barFill}
                        style={{
                          width: `${(s.count / data.total) * 100}%`,
                          background: STATUS_COLORS[s.group] || '#64748b',
                        }}
                      />
                    </div>
                    <span className={styles.barCount}>
                      {s.count.toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent requests */}
          {data.recent?.length > 0 && (
            <div className={styles.recentSection}>
              <div className={styles.chartTitle}>Recent requests</div>
              <div className={styles.recentTable}>
                <div className={styles.recentHead}>
                  <span>Time</span>
                  <span>Method</span>
                  <span>Path</span>
                  <span>Status</span>
                  <span>ms</span>
                </div>
                {data.recent.map((r, i) => (
                  <div
                    key={i}
                    className={`${styles.recentRow} ${r.statusCode >= 400 ? styles.recentError : ''}`}
                  >
                    <span className={styles.recentTime}>
                      {new Date(r.timestamp).toLocaleTimeString()}
                    </span>
                    <span
                      className={styles.recentMethod}
                      style={{ color: METHOD_COLORS[r.method] }}
                    >
                      {r.method}
                    </span>
                    <span className={styles.recentPath} title={r.path}>
                      {r.path}
                    </span>
                    <span
                      className={`${styles.recentStatus} ${r.statusCode >= 400 ? styles.statusBad : styles.statusOk}`}
                    >
                      {r.statusCode}
                    </span>
                    <span className={styles.recentMs}>{r.responseTime}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {data.total === 0 && (
            <div className={styles.noUsage}>
              <BarChart2 size={32} strokeWidth={1} />
              <p>
                No requests recorded in the last{' '}
                {period === '7d'
                  ? '7 days'
                  : period === '30d'
                    ? '30 days'
                    : '90 days'}
                .
              </p>
              <p>
                Usage is logged automatically when this key is used to make API
                calls.
              </p>
            </div>
          )}
        </div>
      ) : null}
    </Modal>
  );
}

// ─── Key card ─────────────────────────────────────────────────────────────────
function KeyCard({
  keyItem: k,
  onRevoke,
  onDelete,
  onViewUsage,
  revoked,
  allObjects = [],
}) {
  const expired = k.expiresAt && new Date(k.expiresAt) < new Date();
  return (
    <div
      className={`${styles.keyCard} ${revoked ? styles.keyRevoked : ''} ${expired ? styles.keyExpired : ''}`}
    >
      <div className={styles.keyCardLeft}>
        <span
          className={styles.keyCardDot}
          style={{
            background:
              revoked || expired ? 'var(--color-gray-300)' : '#22c55e',
          }}
        />
        <div>
          <div className={styles.keyCardName}>
            {k.name}
            {k.description && (
              <span className={styles.keyCardDesc}> — {k.description}</span>
            )}
          </div>
          <div className={styles.keyCardMeta}>
            <code className={styles.keyPrefix}>{k.keyPrefix}…</code>
            {(k.scopes || []).map((s) => (
              <span
                key={s}
                className={styles.scopeTag}
                style={{
                  color: SCOPE_INFO[s]?.color,
                  borderColor: `${SCOPE_INFO[s]?.color}40`,
                }}
              >
                {s}
              </span>
            ))}
            {k.expiresAt && (
              <span
                className={`${styles.keyMeta} ${expired ? styles.expiredText : ''}`}
              >
                <Clock size={11} /> {expired ? 'Expired' : 'Expires'}{' '}
                {new Date(k.expiresAt).toLocaleDateString()}
              </span>
            )}
            {k.ipWhitelist?.length > 0 && (
              <span className={styles.keyMeta}>
                <Lock size={11} /> {k.ipWhitelist.length} IP
                {k.ipWhitelist.length > 1 ? 's' : ''}
              </span>
            )}
            {k.allowedObjects?.length > 0 ? (
              <span className={styles.allowedObjectsRow}>
                {k.allowedObjects.slice(0, 4).map((apiName) => {
                  const obj = allObjects.find((o) => o.apiName === apiName);
                  return (
                    <span
                      key={apiName}
                      className={styles.objChip}
                      title={apiName}
                    >
                      <span
                        className={styles.objChipDot}
                        style={{ background: obj?.color || '#6366f1' }}
                      />
                      {obj?.label || apiName}
                    </span>
                  );
                })}
                {k.allowedObjects.length > 4 && (
                  <span
                    className={styles.objChipMore}
                    title={k.allowedObjects.slice(4).join(', ')}
                  >
                    +{k.allowedObjects.length - 4} more
                  </span>
                )}
              </span>
            ) : (
              <span className={styles.keyMeta} style={{ color: '#16a34a' }}>
                <Globe size={11} /> All objects
              </span>
            )}
            {k.lastUsedAt && (
              <span className={styles.keyMeta}>
                <Activity size={11} /> Last used{' '}
                {new Date(k.lastUsedAt).toLocaleDateString()} ·{' '}
                {k.usageCount?.toLocaleString()} calls
              </span>
            )}
            {revoked && k.revokedAt && (
              <span className={styles.revokedTag}>
                Revoked {new Date(k.revokedAt).toLocaleDateString()}
              </span>
            )}
          </div>
        </div>
      </div>
      <div className={styles.keyCardActions}>
        {!revoked && onViewUsage && (
          <button
            className={`${styles.keyActionBtn} ${styles.usageBtn}`}
            onClick={() => onViewUsage(k)}
            title="View usage data"
          >
            <BarChart2 size={13} /> Usage
          </button>
        )}
        {!revoked && onRevoke && (
          <button
            className={`${styles.keyActionBtn} ${styles.revokeBtn}`}
            onClick={() => onRevoke(k)}
          >
            <ShieldCheck size={13} /> Revoke
          </button>
        )}
        <button
          className={`${styles.keyActionBtn} ${styles.delBtn}`}
          onClick={() => onDelete(k)}
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function IntegrationsPage() {
  const { allObjects } = useTenantContext();
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [newKey, setNewKey] = useState(null);
  const [usageKey, setUsageKey] = useState(null);
  const [docOpen, setDocOpen] = useState(false);

  // Build base URL from environment variable with API versioning
  const baseUrl = import.meta.env.VITE_API_URL
    ? `${import.meta.env.VITE_API_URL}/api/v1`
    : `/api/v1`;

  const load = async () => {
    try {
      const r = await api.get('/api-keys');
      setKeys(r.data.data || []);
    } catch {
      toast.error('Failed to load API keys');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, []);

  const handleCreated = (k) => {
    setNewKey(k);
    load();
  };

  const handleRevoke = async (k) => {
    if (
      !window.confirm(
        `Revoke "${k.name}"? All requests using this key will immediately fail.`,
      )
    )
      return;
    try {
      await api.delete(`/api-keys/${k._id}/revoke`);
      toast.success('Key revoked.');
      load();
    } catch {
      toast.error('Revoke failed');
    }
  };

  const handleDelete = async (k) => {
    if (!window.confirm(`Permanently delete "${k.name}"?`)) return;
    try {
      await api.delete(`/api-keys/${k._id}`);
      toast.success('Deleted.');
      load();
    } catch {
      toast.error('Delete failed');
    }
  };

  const activeKeys = keys.filter((k) => k.isActive);
  const revokedKeys = keys.filter((k) => !k.isActive);

  return (
    <Layout
      title="Integrations"
      description="Connect your CRM with external services and APIs"
    >
      <div className={styles.page}>
        {/* Header */}
        <div className={styles.header}>
          <div>
            <h1 className={styles.title}>Integrations</h1>
            <p className={styles.subtitle}>
              Connect external apps using API keys — read and write CRM data
              programmatically
            </p>
          </div>
          <Button icon={<Plus size={14} />} onClick={() => setCreateOpen(true)}>
            New API Key
          </Button>
        </div>

        {/* Security banner */}
        <div className={styles.secBanner}>
          <ShieldCheck size={20} className={styles.secIcon} />
          <div>
            <strong>Secure by design</strong>
            <p>
              Keys are SHA-256 hashed and never stored in plain text. Each key
              supports scopes, IP whitelisting, and expiry dates. All API calls
              are rate-limited to <strong>300 req/min</strong> per key.
            </p>
          </div>
        </div>

        {/* Base URL + auth */}
        <div className={styles.section}>
          <div className={styles.sectionHeaderRow}>
            <span className={styles.sectionTitle}>Authentication</span>
            <button
              className={styles.docToggle}
              onClick={() => setDocOpen((o) => !o)}
            >
              {docOpen ? 'Hide reference' : 'API Reference'}{' '}
              {docOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>
          </div>
          <p className={styles.hint}>Add this header to every API request:</p>
          <div className={styles.codeRow}>
            <code className={styles.codeVal}>X-API-Key: smk_your_key_here</code>
            <CopyBtn text="X-API-Key: smk_your_key_here" label="header" />
          </div>
          <div className={styles.codeRow}>
            <code className={styles.codeVal}>{baseUrl}</code>
            <CopyBtn text={baseUrl} label="base URL" />
          </div>

          {docOpen && (
            <div className={styles.docBody}>
              <pre
                className={styles.curlPre}
              >{`curl -H "X-API-Key: smk_..." \\\n     -H "Content-Type: application/json" \\\n     ${baseUrl}/records/contact`}</pre>
              <div className={styles.epList}>
                {[
                  ['GET', '/records/:object', 'List records', 'read'],
                  ['GET', '/records/:object/:id', 'Get a record', 'read'],
                  ['POST', '/records/:object', 'Create record', 'write'],
                  ['PUT', '/records/:object/:id', 'Replace record', 'write'],
                  ['PATCH', '/records/:object/:id', 'Partial update', 'write'],
                  ['DELETE', '/records/:object/:id', 'Delete record', 'delete'],
                  ['GET', '/objects', 'List object schemas', 'read'],
                  ['GET', '/objects/:apiName', 'Object + fields', 'read'],
                  ['GET', '/users', 'List users', 'admin'],
                  ['POST', '/records/validate', 'Validate data', 'read'],
                  ['GET', '/search?q=…', 'Global search', 'read'],
                ].map(([m, path, desc, scope]) => (
                  <div key={m + path} className={styles.epRow}>
                    <span className={`${styles.httpMethod} ${styles['m' + m]}`}>
                      {m}
                    </span>
                    <code className={styles.epPath}>{path}</code>
                    <span className={styles.epDesc}>{desc}</span>
                    <span
                      className={styles.epScope}
                      style={{ color: SCOPE_INFO[scope]?.color }}
                    >
                      {scope}
                    </span>
                  </div>
                ))}
              </div>
              <div className={styles.secNotes}>
                <strong>Security checklist</strong>
                <ul>
                  <li>
                    <Lock size={11} /> Always use HTTPS in production
                  </li>
                  <li>
                    <Activity size={11} /> Rate limit: 300 req/min per key —
                    exceeding returns <code>429</code>
                  </li>
                  <li>
                    <Clock size={11} /> Rotate keys every 90 days; set an expiry
                    date
                  </li>
                  <li>
                    <ShieldCheck size={11} /> Grant only the minimum scopes
                    required
                  </li>
                  <li>
                    <Globe size={11} /> Add an IP whitelist to prevent misuse if
                    a key is leaked
                  </li>
                  <li>
                    <Key size={11} /> Never embed keys in client-side code or
                    public repositories
                  </li>
                </ul>
              </div>
            </div>
          )}
        </div>

        {/* Active keys */}
        <div className={styles.section}>
          <div className={styles.sectionHeaderRow}>
            <span className={styles.sectionTitle}>
              API Keys ({activeKeys.length})
            </span>
          </div>
          {loading ? (
            <div className={styles.keyList}>
              {[1, 2].map((i) => (
                <div key={i} className={styles.keySkel} />
              ))}
            </div>
          ) : activeKeys.length === 0 ? (
            <div className={styles.keyEmpty}>
              <Key size={40} strokeWidth={1} />
              <p>
                No active API keys. Create one to enable external integrations.
              </p>
              <Button
                variant="secondary"
                icon={<Plus size={13} />}
                onClick={() => setCreateOpen(true)}
              >
                Create your first key
              </Button>
            </div>
          ) : (
            <div className={styles.keyList}>
              {activeKeys.map((k) => (
                <KeyCard
                  key={k._id}
                  keyItem={k}
                  allObjects={allObjects}
                  onRevoke={handleRevoke}
                  onDelete={handleDelete}
                  onViewUsage={setUsageKey}
                />
              ))}
            </div>
          )}
        </div>

        {/* Revoked */}
        {revokedKeys.length > 0 && (
          <div className={styles.section}>
            <span
              className={styles.sectionTitle}
              style={{ color: 'var(--color-gray-400)' }}
            >
              Revoked / Expired ({revokedKeys.length})
            </span>
            <div className={styles.keyList} style={{ marginTop: 12 }}>
              {revokedKeys.map((k) => (
                <KeyCard
                  key={k._id}
                  keyItem={k}
                  allObjects={allObjects}
                  revoked
                  onDelete={handleDelete}
                />
              ))}
            </div>
          </div>
        )}

        <CreateKeyModal
          isOpen={createOpen}
          onClose={() => setCreateOpen(false)}
          onCreated={handleCreated}
        />
        <UsageModal
          keyItem={usageKey}
          isOpen={!!usageKey}
          onClose={() => setUsageKey(null)}
        />
        <NewKeyModal keyData={newKey} onClose={() => setNewKey(null)} />
      </div>
    </Layout>
  );
}
