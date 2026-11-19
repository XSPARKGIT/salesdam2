import React, { useEffect, useState } from 'react';
import { Package, Copy, Upload, Play, CheckCircle, XCircle, RotateCcw, Plus, Trash2, Download } from 'lucide-react';
import api from '../../services/api';
import AdminSettingsPage from './AdminSettingsPage';
import Button from '../../components/common/Button/Button';
import toast from 'react-hot-toast';
import styles from './AdminSettingsPage.module.css';

const COMPONENT_TYPES = ['object', 'field', 'layout', 'layout_assignment', 'validation_rule', 'custom_code', 'pdf_template', 'flow', 'approver_group', 'approval_process', 'tenant_config', 'duplicate_rule'];
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
  validation_rule: 'object:rule name (e.g. policy:Premium above zero)',
  custom_code: 'snippet name (only its active version travels)',
  pdf_template: 'template api name',
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
  const [logs, setLogs] = useState([]);
  const [delTenantId, setDelTenantId] = useState('');
  const [delOpen, setDelOpen] = useState(false);
  const [delName, setDelName] = useState('');
  const sandboxes = tenants.filter((t) => t.isSandbox && t.clonedFromTenantId);
  const currentTenantId = (() => { try { return localStorage.getItem('tenantId'); } catch { return null; } })();
  const delTenant = sandboxes.find((t) => t._id === delTenantId);

  const exportCs = async (cs) => {
    try {
      const res = await api.get(`/change-sets/${cs._id}/export`);
      const pkg = res.data?.data;
      const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${String(cs.name).replace(/[^a-z0-9-_]+/gi, '-')}.salesdam-package.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success('Package file exported');
    } catch (e) {
      toast.error(e.message || 'Export failed');
    }
  };

  const importPackageFile = async (file) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return toast.error('Package refused: the file is larger than 5 MB.');
    try {
      const pkg = JSON.parse(await file.text());
      await api.post('/change-sets/import', { package: pkg });
      toast.success('Package imported as a change set');
      load();
    } catch (e) {
      toast.error(e instanceof SyntaxError ? 'Package refused: the file is not valid JSON.' : (e.message || 'Import failed'));
    }
  };

  const deleteSandbox = async () => {
    try {
      await api.delete(`/change-sets/sandbox/${delTenantId}`, { data: { confirmName: delName } });
      toast.success('Sandbox deleted');
      setDelOpen(false); setDelName(''); setDelTenantId('');
      load();
    } catch (e) {
      toast.error(e.message || 'Delete failed');
    }
  };

  const loadLogs = async (tid) => {
    if (!tid) return setLogs([]);
    try {
      const res = await api.get('/change-sets/deployment-log', { params: { targetTenantId: tid } });
      setLogs(res.data?.data || []);
    } catch (e) {
      setLogs([]);
    }
  };
  useEffect(() => { loadLogs(targetTenantId); }, [targetTenantId]);

  const rollbackLog = async (logId) => {
    try {
      await api.post(`/change-sets/deployment-log/${logId}/rollback`);
      toast.success('Rolled back');
      load();
      loadLogs(targetTenantId);
    } catch (e) {
      toast.error(e.message || 'Rollback failed');
    }
  };

  const load = async () => {
    try {
      const [csRes, tRes] = await Promise.all([
        api.get('/change-sets'),
        api.get('/admin/tenants', { params: { limit: 500 } }).catch(() => ({ data: { data: [] } })),
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
      toast.error(e.message || 'Clone failed');
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
      if (e.status === 409) {
        toast.error('A change set with this name already exists. Choose a different name.');
      } else {
        toast.error(e.message || 'Create failed');
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
      toast.error(e.message || 'Validation failed');
    }
  };

  const deploy = async (id) => {
    if (!targetTenantId) return toast.error('Select target tenant');
    try {
      await api.post(`/change-sets/${id}/deploy`, { targetTenantId });
      toast.success('Deployed');
      load();
      loadLogs(targetTenantId);
    } catch (e) {
      toast.error(e.message || 'Deploy failed');
      load();
      loadLogs(targetTenantId);
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
      loadLogs(targetTenantId);
    } catch (e) {
      toast.error(e.message || 'Rollback failed');
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
            Package metadata components (fields, flows, validation rules, custom code, document templates) for deployment to another tenant.
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

        {/* Import package file */}
        <div className={styles.field}>
          <label className={styles.label}>Import Package File</label>
          <p className={styles.hint}>
            Import a package file exported from another tenant. It becomes a draft change set in the tenant you are working in, then goes through Validate, Deploy and Rollback like any other. The file is checked for size, version, content and integrity before anything is created.
          </p>
          <input
            id="import-package-file"
            type="file"
            accept=".json,application/json"
            onChange={(e) => { importPackageFile(e.target.files?.[0]); e.target.value = ''; }}
            style={{ marginTop: 8 }}
          />
        </div>

        {/* Delete sandbox */}
        <div className={styles.field}>
          <label className={styles.label}>Delete Sandbox Tenant</label>
          <p className={styles.hint}>
            Only tenants created by Clone Sandbox are listed. A tenant you are working in cannot be deleted. Deleting removes the sandbox's configuration, users, change sets and logs for good.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            <select className={styles.input} value={delTenantId} onChange={(e) => { setDelTenantId(e.target.value); setDelOpen(false); setDelName(''); }} style={{ flex: 1, minWidth: 200 }}>
              <option value="">Sandbox to delete...</option>
              {sandboxes.map((t) => <option key={t._id} value={t._id}>{t.name}</option>)}
            </select>
            <Button variant="secondary" disabled={!delTenantId || delTenantId === currentTenantId} onClick={() => setDelOpen(true)}>
              <Trash2 size={13} /> Delete sandbox…
            </Button>
          </div>
          {delTenantId && delTenantId === currentTenantId && (
            <p className={styles.hint}>You are working in this sandbox. Switch to another tenant in the top bar first.</p>
          )}
          {delOpen && delTenant && (
            <div role="dialog" aria-label="Confirm sandbox deletion" style={{ marginTop: 12, padding: 12, border: '1px solid var(--color-danger, #dc2626)', borderRadius: 'var(--border-radius)' }}>
              <p style={{ margin: 0, fontSize: 'var(--font-size-sm)' }}>This permanently deletes <strong>{delTenant.name}</strong> and everything in it. Type its name to confirm.</p>
              <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                <input className={styles.input} placeholder="Type the sandbox name" value={delName} onChange={(e) => setDelName(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
                <Button disabled={delName !== delTenant.name} onClick={deleteSandbox}>Delete permanently</Button>
                <Button variant="secondary" onClick={() => { setDelOpen(false); setDelName(''); }}>Cancel</Button>
              </div>
            </div>
          )}
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
                        <Button size="sm" variant="secondary" onClick={() => exportCs(cs)} style={{ marginLeft: 8 }}>
                          <Download size={13} /> Export
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
              <strong>Validation Result:</strong>{' '}
              <span data-testid="validation-summary">{validation.valid ? 'All dependencies are present - ready to deploy.' : `Blocked - ${validation.missing?.length || 0} required dependenc${validation.missing?.length === 1 ? 'y is' : 'ies are'} missing in the target tenant.`}</span>
              {!validation.valid && (
                <ul style={{ marginTop: 8, fontSize: 'var(--font-size-sm)', paddingLeft: 18 }}>
                  {(validation.missing || []).map((m, i) => (
                    <li key={i}>Missing {String(m.dependency).replace(/_/g, ' ')}: <code>{m.key}</code>{m.via ? <> (needed by <code>{m.via}</code>)</> : null}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* Deployment Log */}
        <div className={styles.field}>
          <label className={styles.label}>Deployment Log (selected target tenant)</label>
          {!targetTenantId ? (
            <p className={styles.hint}>Select a target tenant to see what has been deployed to it.</p>
          ) : logs.length === 0 ? (
            <p className={styles.hint}>Nothing has been deployed to this tenant yet.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--font-size-sm)', marginTop: 8 }}>
              <thead>
                <tr style={{ background: 'var(--color-gray-50)', borderBottom: '1px solid var(--border-color)' }}>
                  {['When', 'Change set', 'From', 'By', 'Status', 'Components', ''].map((h) => (
                    <th key={h} style={{ padding: '8px 12px', textAlign: 'left' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l._id} style={{ borderBottom: '1px solid var(--border-color)' }} title={(l.missing || []).map((m) => `${m.dependency}: ${m.key}`).join('; ')}>
                    <td style={{ padding: '8px 12px' }}>{new Date(l.at).toLocaleString()}</td>
                    <td style={{ padding: '8px 12px' }}>{l.changeSetName}</td>
                    <td style={{ padding: '8px 12px' }}>{l.sourceTenantId?.name || '-'}</td>
                    <td style={{ padding: '8px 12px' }}>{l.by ? `${l.by.firstName || ''} ${l.by.lastName || ''}`.trim() || l.by.email : '-'}</td>
                    <td style={{ padding: '8px 12px' }}>{l.status === 'rolled_back' ? 'rolled back' : l.status}</td>
                    <td style={{ padding: '8px 12px' }}>{l.status === 'blocked' ? `${(l.missing || []).length} missing` : l.componentCount}</td>
                    <td style={{ padding: '8px 12px' }}>
                      {l.status === 'deployed' && (
                        <Button size="sm" variant="secondary" onClick={() => rollbackLog(l._id)}><RotateCcw size={13} /> Rollback</Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </AdminSettingsPage>
  );
}