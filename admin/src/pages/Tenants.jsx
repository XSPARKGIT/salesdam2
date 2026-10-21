import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { formatDistanceToNow } from 'date-fns';
import api from '../services/api.js';
import Table from '../components/Table.jsx';
import Badge from '../components/Badge.jsx';
import Pagination from '../components/Pagination.jsx';
import Modal from '../components/Modal.jsx';
import './Page.css';

const PLANS = ['', 'free', 'starter', 'basic', 'standard', 'enterprise'];
const STATUSES = ['', 'active', 'suspended', 'deleted'];

const PLAN_LIMITS = {
  free:       { maxUsers: 1,  maxRecords: 1000,   maxObjects: 5,   maxAutomations: 2   },
  starter:    { maxUsers: 1,  maxRecords: 5000,   maxObjects: 10,  maxAutomations: 5   },
  basic:      { maxUsers: 3,  maxRecords: 10000,  maxObjects: 15,  maxAutomations: 10  },
  standard:   { maxUsers: 10, maxRecords: 50000,  maxObjects: 30,  maxAutomations: 25  },
  enterprise: { maxUsers: 20, maxRecords: 200000, maxObjects: 100, maxAutomations: 100 },
};

export default function Tenants() {
  const navigate = useNavigate();
  const [tenants, setTenants] = useState([]);
  const [pagination, setPagination] = useState({ total: 0, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [planFilter, setPlanFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', slug: '', plan: 'free' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: 20 };
      if (search) params.search = search;
      if (statusFilter) params.status = statusFilter;
      if (planFilter) params.plan = planFilter;
      const res = await api.get('/superadmin/tenants', { params });
      setTenants(res.data.data || []);
      setPagination({ total: res.data.pagination?.total || 0, totalPages: res.data.pagination?.totalPages || 1 });
    } catch {
      toast.error('Failed to load tenants');
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter, planFilter]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (e) => {
    e.preventDefault();
    setCreating(true);
    try {
      await api.post('/superadmin/tenants', form);
      toast.success('Tenant created');
      setShowCreate(false);
      setForm({ name: '', slug: '', plan: 'free' });
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to create tenant');
    } finally {
      setCreating(false);
    }
  };

  const columns = [
    {
      key: 'name',
      label: 'Tenant',
      render: (row) => (
        <div>
          <div style={{ fontWeight: 600 }}>{row.name}</div>
          <div style={{ fontSize: 11, color: 'var(--text3)' }}>{row.slug}</div>
        </div>
      ),
    },
    {
      key: 'plan',
      label: 'Plan',
      width: 100,
      render: (row) => <Badge value={row.plan} />,
    },
    {
      key: 'status',
      label: 'Status',
      width: 100,
      render: (row) => <Badge value={row.status} />,
    },
    {
      key: 'users',
      label: 'Users',
      width: 120,
      render: (row) => (
        <span style={{ fontSize: 13 }}>
          {row.userStats?.active ?? 0} / {row.limits?.maxUsers ?? '?'}
          <span style={{ color: 'var(--text3)', marginLeft: 4, fontSize: 11 }}>active</span>
        </span>
      ),
    },
    {
      key: 'records',
      label: 'Records',
      width: 130,
      render: (row) => (
        <span style={{ fontSize: 13 }}>
          {(row.usage?.records ?? 0).toLocaleString()}
          <span style={{ color: 'var(--text3)', fontSize: 11 }}> / {(row.limits?.maxRecords ?? 0).toLocaleString()}</span>
        </span>
      ),
    },
    {
      key: 'createdAt',
      label: 'Created',
      width: 130,
      render: (row) => (
        <span style={{ fontSize: 12, color: 'var(--text3)' }}>
          {formatDistanceToNow(new Date(row.createdAt), { addSuffix: true })}
        </span>
      ),
    },
  ];

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Tenants</h1>
          <p className="page-sub">{pagination.total} total</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary btn-sm btn-icon" onClick={load} title="Refresh">
            <RefreshCw size={15} />
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)}>
            <Plus size={15} /> New Tenant
          </button>
        </div>
      </div>

      <div className="filters-bar">
        <div className="search-wrap">
          <Search size={15} className="search-icon" />
          <input
            type="text"
            className="form-input search-input"
            placeholder="Search by name…"
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
          value={planFilter}
          onChange={(e) => { setPlanFilter(e.target.value); setPage(1); }}
        >
          {PLANS.map((p) => (
            <option key={p} value={p}>{p || 'All plans'}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="list-loading"><span className="spinner" /></div>
      ) : (
        <>
          <Table
            columns={columns}
            rows={tenants}
            onRowClick={(row) => navigate(`/tenants/${row._id}`)}
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

      {showCreate && (
        <Modal title="New Tenant" onClose={() => setShowCreate(false)}>
          <form onSubmit={handleCreate}>
            <div className="form-group">
              <label className="form-label">Name *</label>
              <input
                className="form-input"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Acme Corp"
                required
                autoFocus
              />
            </div>
            <div className="form-group">
              <label className="form-label">Slug (auto-generated if empty)</label>
              <input
                className="form-input"
                value={form.slug}
                onChange={(e) => setForm({ ...form, slug: e.target.value })}
                placeholder="acme-corp"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Plan</label>
              <select
                className="form-select"
                value={form.plan}
                onChange={(e) => setForm({ ...form, plan: e.target.value })}
              >
                {PLANS.slice(1).map((p) => (
                  <option key={p} value={p}>
                    {p} — up to {PLAN_LIMITS[p]?.maxUsers} users / {PLAN_LIMITS[p]?.maxRecords?.toLocaleString()} records
                  </option>
                ))}
              </select>
            </div>
            <div className="form-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowCreate(false)}
              >
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={creating}>
                {creating ? 'Creating…' : 'Create Tenant'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
