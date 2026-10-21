import React, { useState, useEffect, useCallback } from 'react';
import { Search, RefreshCw, Clock } from 'lucide-react';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import api from '../services/api.js';
import Table from '../components/Table.jsx';
import Pagination from '../components/Pagination.jsx';
import Badge from '../components/Badge.jsx';
import './Page.css';
import './AuditLogs.css';

const ACTIONS = [
  '', 'login', 'logout', 'login_failed',
  'create', 'read', 'update', 'delete',
  'tenant_create', 'tenant_suspend', 'tenant_delete',
  'user_invite', 'add_user', 'remove_user', 'user_activate', 'user_deactivate',
  'export', 'import',
  'api_key_create', 'api_key_revoke',
  'password_change', 'password_verify', 'password_reset_requested',
  'password_reset_completed', 'profile_update', 'settings_change',
  'permission_change', 'role_assign', 'role_remove', 'add_member', 'remove_member',
  'merge', 'generate', 'session_revoke',
  'automation_run', 'automation_error', 'webhook_fire', 'webhook_fail',
  'incident_create', 'incident_update', 'incident_comment_create',
];

const STATUS_COLOR = {
  success: 'var(--green)',
  failure: 'var(--red)',
};

const ACTION_COLOR = {
  login: 'var(--green)',
  logout: 'var(--text3)',
  login_failed: 'var(--red)',
  create: 'var(--accent)',
  update: 'var(--blue)',
  delete: 'var(--red)',
  tenant_create: 'var(--accent)',
  tenant_suspend: 'var(--yellow)',
  tenant_delete: 'var(--red)',
  export: 'var(--yellow)',
  import: 'var(--blue)',
};

export default function AuditLogs() {
  const [logs, setLogs] = useState([]);
  const [pagination, setPagination] = useState({ total: 0, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: 50 };
      if (actionFilter) params.action = actionFilter;
      const res = await api.get('/superadmin/audit-logs', { params });
      setLogs(res.data.data || []);
      setPagination({ total: res.data.pagination?.total || 0, totalPages: res.data.pagination?.totalPages || 1 });
    } catch {
      toast.error('Failed to load audit logs');
    } finally {
      setLoading(false);
    }
  }, [page, actionFilter]);

  useEffect(() => { load(); }, [load]);

  const columns = [
    {
      key: 'timestamp',
      label: 'Time',
      width: 140,
      render: (row) => (
        <div style={{ fontSize: 12, color: 'var(--text3)' }}>
          <div>{format(new Date(row.createdAt), 'dd MMM yyyy')}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 2 }}>
            <Clock size={10} />
            {format(new Date(row.createdAt), 'HH:mm:ss')}
          </div>
        </div>
      ),
    },
    {
      key: 'action',
      label: 'Action',
      width: 150,
      render: (row) => (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '2px 8px',
            borderRadius: 99,
            fontSize: 11,
            fontWeight: 600,
            background: 'var(--bg3)',
            color: ACTION_COLOR[row.action] || 'var(--text2)',
            whiteSpace: 'nowrap',
          }}
        >
          {row.action}
        </span>
      ),
    },
    {
      key: 'user',
      label: 'User',
      render: (row) => row.userId ? (
        <div>
          <div style={{ fontSize: 13, fontWeight: 500 }}>
            {row.userId.firstName} {row.userId.lastName}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text3)' }}>{row.userId.email}</div>
        </div>
      ) : (
        <span style={{ color: 'var(--text3)', fontSize: 12 }}>System</span>
      ),
    },
    {
      key: 'tenant',
      label: 'Tenant',
      render: (row) => row.tenantId
        ? <span style={{ fontSize: 13 }}>{row.tenantId.name}</span>
        : <span style={{ color: 'var(--text3)', fontSize: 12 }}>—</span>,
    },
    {
      key: 'resource',
      label: 'Resource',
      width: 130,
      render: (row) => (
        <div>
          <div style={{ fontSize: 13 }}>{row.resource || '—'}</div>
          {row.objectApiName && (
            <div style={{ fontSize: 11, color: 'var(--text3)' }}>{row.objectApiName}</div>
          )}
        </div>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      width: 80,
      render: (row) => (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '2px 8px',
            borderRadius: 99,
            fontSize: 11,
            fontWeight: 600,
            background: row.status === 'failure' ? 'var(--red-soft)' : 'var(--green-soft)',
            color: STATUS_COLOR[row.status] || 'var(--text2)',
          }}
        >
          {row.status || 'success'}
        </span>
      ),
    },
    {
      key: 'ip',
      label: 'IP',
      width: 110,
      render: (row) => (
        <span style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'monospace' }}>
          {row.ipAddress || '—'}
        </span>
      ),
    },
  ];

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Audit Logs</h1>
          <p className="page-sub">{pagination.total} total entries</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary btn-sm btn-icon" onClick={load} title="Refresh">
            <RefreshCw size={15} />
          </button>
        </div>
      </div>

      <div className="filters-bar">
        <select
          className="form-select filter-select"
          value={actionFilter}
          onChange={(e) => { setActionFilter(e.target.value); setPage(1); }}
        >
          {ACTIONS.map((a) => (
            <option key={a} value={a}>{a || 'All actions'}</option>
          ))}
        </select>
        <span style={{ fontSize: 12, color: 'var(--text3)', marginLeft: 4 }}>
          Showing latest 50 per page · auto-deleted after 90 days
        </span>
      </div>

      {loading ? (
        <div className="list-loading"><span className="spinner" /></div>
      ) : (
        <>
          <Table columns={columns} rows={logs} emptyMsg="No audit logs found" />
          <Pagination
            page={page}
            totalPages={pagination.totalPages}
            total={pagination.total}
            limit={50}
            onChange={setPage}
          />
        </>
      )}
    </div>
  );
}
