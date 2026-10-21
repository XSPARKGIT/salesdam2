import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import api from '../services/api.js';
import Table from '../components/Table.jsx';
import Badge from '../components/Badge.jsx';
import Pagination from '../components/Pagination.jsx';
import './Page.css';

const STATUSES = ['', 'active', 'inactive', 'suspended', 'pending'];
const ROLES = ['', 'superuser', 'admin', 'user'];

export default function Users() {
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [pagination, setPagination] = useState({ total: 0, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: 20 };
      if (search) params.search = search;
      if (statusFilter) params.status = statusFilter;
      if (roleFilter) params.systemRole = roleFilter;
      const res = await api.get('/superadmin/users', { params });
      setUsers(res.data.data || []);
      setPagination({ total: res.data.pagination?.total || 0, totalPages: res.data.pagination?.totalPages || 1 });
    } catch {
      toast.error('Failed to load users');
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter, roleFilter]);

  useEffect(() => { load(); }, [load]);

  const columns = [
    {
      key: 'name',
      label: 'User',
      render: (u) => (
        <div>
          <div style={{ fontWeight: 600 }}>{u.firstName} {u.lastName}</div>
          <div style={{ fontSize: 11, color: 'var(--text3)' }}>{u.email}</div>
        </div>
      ),
    },
    {
      key: 'tenant',
      label: 'Tenant',
      render: (u) => u.tenantId ? (
        <div>
          <div style={{ fontSize: 13 }}>{u.tenantId.name}</div>
          <div style={{ fontSize: 11, color: 'var(--text3)' }}>{u.tenantId.plan}</div>
        </div>
      ) : <span style={{ color: 'var(--text3)', fontSize: 12 }}>—</span>,
    },
    {
      key: 'systemRole',
      label: 'Role',
      width: 100,
      render: (u) => <Badge value={u.systemRole} />,
    },
    {
      key: 'status',
      label: 'Status',
      width: 100,
      render: (u) => <Badge value={u.status} />,
    },
    {
      key: 'loginCount',
      label: 'Logins',
      width: 80,
      render: (u) => <span style={{ fontSize: 13, color: 'var(--text2)' }}>{u.loginCount ?? 0}</span>,
    },
    {
      key: 'lastLogin',
      label: 'Last Login',
      width: 120,
      render: (u) => u.lastLogin
        ? <span style={{ fontSize: 12, color: 'var(--text3)' }}>{format(new Date(u.lastLogin), 'dd MMM yyyy')}</span>
        : <span style={{ fontSize: 12, color: 'var(--text3)' }}>Never</span>,
    },
    {
      key: 'createdAt',
      label: 'Joined',
      width: 120,
      render: (u) => (
        <span style={{ fontSize: 12, color: 'var(--text3)' }}>
          {format(new Date(u.createdAt), 'dd MMM yyyy')}
        </span>
      ),
    },
  ];

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">All Users</h1>
          <p className="page-sub">{pagination.total} total across all tenants</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary btn-sm btn-icon" onClick={load} title="Refresh">
            <RefreshCw size={15} />
          </button>
        </div>
      </div>

      <div className="filters-bar">
        <div className="search-wrap">
          <Search size={15} className="search-icon" />
          <input
            type="text"
            className="form-input search-input"
            placeholder="Search by name or email…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <select
          className="form-select filter-select"
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s || 'All statuses'}</option>
          ))}
        </select>
        <select
          className="form-select filter-select"
          value={roleFilter}
          onChange={(e) => { setRoleFilter(e.target.value); setPage(1); }}
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>{r || 'All roles'}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="list-loading"><span className="spinner" /></div>
      ) : (
        <>
          <Table
            columns={columns}
            rows={users}
            onRowClick={(u) => navigate(`/tenants/${u.tenantId?._id}`)}
          />
          <Pagination
            page={page}
            totalPages={pagination.totalPages}
            total={pagination.total}
            limit={20}
            onChange={setPage}
          />
        </>
      )}
    </div>
  );
}
