import React, { useEffect, useState } from 'react';
import { Package, Copy, Upload, Play, CheckCircle, XCircle, RotateCcw, Plus, Trash2 } from 'lucide-react';
import api from '../../services/api';
import AdminSettingsPage from './AdminSettingsPage';
import Button from '../../components/common/Button/Button';
import toast from 'react-hot-toast';
import styles from './AdminSettingsPage.module.css';

const COMPONENT_TYPES = ['object', 'field', 'layout', 'layout_assignment', 'validation_rule', 'flow', 'approver_group', 'approval_process', 'tenant_config', 'duplicate_rule'];
// The component key each type expects, shown as the input's hint.
const KEY_HINTS = {
  object: 'object api name (e.g. widget)',
  field: 'object.field (e.g. widget.serial_number)',
  layout: 'object:layout name (e.g. policy:Group Policy)',
  layout_assignment: 'object:role name (e.g. policy:standard_user)',
  flow: 'flow api name',
  approver_group: 'group name (e.g. claims_panel)',
  approval_process: 'object:process name',
  duplicate_rule: 'object:rule name',
  tenant_config: 'configuration key',
};

export default function Deployments() {
  const [changeSets, setChangeSets] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [name, setName] = useState('');
  const [sourceTenantId, setSourceTenantId] = useState('');
  const [targetTenantId, setTargetTenantId] = useState('');
  const [validation, setValidation] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selectedCs, setSelectedCs] = useState(null);

  // Component builder state
  const [compType, setCompType] = useState('field');
  const [compKey, setCompKey] = useState('');
  const [components, setComponents] = useState([]);

  const load = async () => {
    try {
      const [csRes, tRes] = await Promise.all([
        api.get('/change-sets'),
        api.get('/admin/tenants').catch(() => ({ data: { data: [] } })),
      ]);
      setChangeSets(csRes.data?.data || []);
      const t = tRes.data?.data || [];
      setTenants(Array.isArray(t) ? t : []);
    } catch (e) {
      toast.error('Failed to load data');
    }
  };

  useEffect(() => { load(); }, []);

  const addComponent = () => {
    if (!compKey.trim()) return toast.error('Enter a component key');
    setComponents((prev) => [...prev, { componentType: compType, componentKey: compKey.trim() }]);
    setCompKey('');
  };

  const removeComponent = (idx) => {
    setComponents((prev) => prev.filter((_, i) => i !== idx));
  };

  const cloneSandbox = async () => {
    if (!sourceTenantId) return toast.error('Select a source tenant');
    setLoading(true);
    const toastId = toast.loading('Cloning tenant configuration... (this may take a minute)');
    try {
      const res = await api.post('/change-sets/sandbox', { sourceTenantId, name: name || 'Sandbox' }, { timeout: 300000 });
      toast.dismiss(toastId);
      toast.success(`Sandbox created (${res.data?.data?.componentCount} components)`);
      load();
    } catch (e) {
      toast.dismiss(toastId);
      toast.error(e.response?.data?.message || 'Clone failed');
    } finally { setLoading(false); }
  };

  const createCs = async () => {
    if (!name) return toast.error('Name required');
    if (components.length === 0) return toast.error('Add at least one component');
    setLoading(true);
    try {
      await api.post('/change-sets', { name, components });
      toast.success('Change set created');
      setName('');
      setComponents([]);
      load();
    } catch (e) {
      const msg = e.response?.data?.message || 'Create failed';
      if (e.response?.status === 409) {
        toast.error('A change set with this name already exists. Choose a different name.');
      } else {
        toast.error(msg);
      }
    } finally { setLoading(false); }
  };

  const validate = async (id) => {
    if (!targetTenantId) return toast.error('Select target tenant');
    try {
      const res = await api.post(`/change-sets/${id}/validate`, { targetTenantId });
      setValidation(res.data?.data);
      toast.success(res.data?.message || 'Validated');
      load();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Validation failed');
    }
  };

  const deploy = async (id) => {
    if (!targetTenantId) return toast.error('Select target tenant');
    try {
      await api.post(`/change-sets/${id}/deploy`, { targetTenantId });
      toast.success('Deployed');
      load();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Deploy failed');
    }
  };

  const rollback = async (csId) => {
    try {
      const logsRes = await api.get('/change-sets/deployment-log', { params: { targetTenantId } });
      const logs = logsRes.data?.data || [];
      const log = logs.find((l) => String(l.changeSetId) === String(csId) && l.status === 'deployed');
      if (!log) return toast.error('No deployed log found for this change set.');
      await api.post(`/change-sets/deployment-log/${log._id}/rollback`);
      toast.success('Rolled back');
      load();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Rollback failed');
    }
  };

  return (
    <AdminSettingsPage
      title="Deployments"
      description="Sandbox cloning and change set deployment"
      icon={Package}
      iconColor="#8b5cf6"
    >
      <div className={styles.panel}>
        {/* Clone Sandbox */}
        <div className={styles.field}>
          <label className={styles.label}>Clone Sandbox Tenant</label>
          <p className={styles.hint}>
            Clone a tenant's configuration (objects, fields, layouts, rules) into an isolated test tenant without copying production data.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            <select className={styles.input} value={sourceTenantId} onChange={(e) => setSourceTenantId(e.target.value)} style={{ flex: 1, minWidth: 200 }}>
              <option value="">Source tenant...</option>
              {tenants.map((t) => <option key={t._id} value={t._id}>{t.name}</option>)}
            </select>
            <input className={styles.input} placeholder="Sandbox name" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
            <Button onClick={cloneSandbox} disabled={loading} icon={loading ? <span style={{ width: 14, height: 14, border: '2px solid #fff', borderTopColor: 'transparent', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.6s linear infinite' }} /> : <Copy size={14} />}>
              {loading ? 'Cloning...' : 'Clone'}
            </Button>
          </div>
        </div>

        {/* Create Change Set */}
        <div className={styles.field}>
          <label className={styles.label}>Create Change Set</label>
          <p className={styles.hint}>
            Package metadata components (fields, flows, validation rules) for deployment to another tenant.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
            <input className={styles.input} placeholder="Change set name" value={name} onChange={(e) => setName(e.target.value)} />
            <div style={{ display: 'flex', gap: 8 }}>
              <select className={styles.input} value={compType} onChange={(e) => setCompType(e.target.value)} style={{ flex: 1 }}>
                {COMPONENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <input className={styles.input} placeholder={`Component key — ${KEY_HINTS[compType] || 'e.g. widget:serial_number'}`} value={compKey} onChange={(e) => setCompKey(e.target.value)} style={{ flex: 2 }} />
              <Button onClick={addComponent} icon={<Plus size={14} />}>Add</Button>
            </div>
            {components.length > 0 && (
              <div style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--border-radius)', padding: 8 }}>
                {components.map((c, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: i < components.length - 1 ? '1px solid var(--border-color)' : 'none' }}>
                    <span style={{ fontSize: 13, fontFamily: 'monospace' }}>{c.componentType}: {c.componentKey}</span>
                    <button type="button" onClick={() => removeComponent(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-danger)' }}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div>
              <Button onClick={createCs} disabled={loading} icon={<Upload size={14} />}>
                Create Change Set
              </Button>
            </div>
          </div>
        </div>

        {/* Target Tenant */}
        <div className={styles.field}>
          <label className={styles.label}>Target Tenant (for validate / deploy)</label>
          <p className={styles.hint}>
            Select the tenant to validate against and deploy to.
          </p>
          <select className={styles.input} value={targetTenantId} onChange={(e) => setTargetTenantId(e.target.value)}>
            <option value="">Target tenant...</option>
            {tenants.map((t) => <option key={t._id} value={t._id}>{t.name}</option>)}
          </select>
        </div>

        {/* Change Sets Table */}
        <div className={styles.field}>
          <label className={styles.label}>Change Sets</label>
          {changeSets.length === 0 ? (
            <p className={styles.hint}>No change sets yet. Create one above.</p>
          ) : (
            <div style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--border-radius-md)', overflow: 'hidden', marginTop: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--font-size-sm)' }}>
                <thead>
                  <tr style={{ background: 'var(--color-gray-50)', borderBottom: '1px solid var(--border-color)' }}>
                    <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 'var(--font-weight-semibold)' }}>Name</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 'var(--font-weight-semibold)' }}>Status</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 'var(--font-weight-semibold)' }}>Components</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 'var(--font-weight-semibold)' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {changeSets.map((cs) => (
                    <tr key={cs._id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <td style={{ padding: '8px 12px' }}>{cs.name}</td>
                      <td style={{ padding: '8px 12px' }}>
                        <span style={{
                          padding: '2px 8px',
                          borderRadius: 'var(--border-radius)',
                          fontSize: 'var(--font-size-xs)',
                          background: cs.status === 'deployed' ? 'var(--color-success-light, #dcfce7)' : cs.status === 'validated' ? 'var(--color-primary-light)' : 'var(--color-gray-100)',
                          color: cs.status === 'deployed' ? 'var(--color-success, #16a34a)' : 'var(--color-gray-700)',
                        }}>
                          {cs.status}
                        </span>
                      </td>
                      <td style={{ padding: '8px 12px', fontSize: 12 }}>{(cs.components || []).length}</td>
                      <td style={{ padding: '8px 12px' }}>
                        <Button size="sm" variant="secondary" onClick={() => validate(cs._id)} disabled={!targetTenantId}>
                          <CheckCircle size={13} /> Validate
                        </Button>
                        <Button size="sm" onClick={() => deploy(cs._id)} disabled={!targetTenantId || cs.status !== 'validated'} style={{ marginLeft: 8 }}>
                          <Play size={13} /> Deploy
                        </Button>
                        {cs.status === 'deployed' && (
                          <Button size="sm" variant="secondary" onClick={() => rollback(cs._id)} style={{ marginLeft: 8 }}>
                            <RotateCcw size={13} /> Rollback
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {validation && (
            <div style={{ marginTop: 12, padding: 12, background: 'var(--color-gray-50)', borderRadius: 'var(--border-radius)', border: '1px solid var(--border-color)' }}>
              <strong>Validation Result:</strong>
              <pre style={{ marginTop: 8, fontSize: 'var(--font-size-xs)', overflow: 'auto' }}>
                {JSON.stringify(validation, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </AdminSettingsPage>
  );
}