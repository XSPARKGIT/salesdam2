import React, { useEffect, useState } from 'react';
import api from '../../services/api';
import Layout from '../../layout/Layout';
import Button from '../../components/common/Button/Button';
import toast from 'react-hot-toast';

export default function Deployments() {
  const [changeSets, setChangeSets] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [name, setName] = useState('');
  const [sourceTenantId, setSourceTenantId] = useState('');
  const [targetTenantId, setTargetTenantId] = useState('');
  const [selectedCs, setSelectedCs] = useState(null);
  const [validation, setValidation] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    try {
      const [csRes, tRes] = await Promise.all([
        api.get('/change-sets'),
        api.get('/tenants').catch(() => ({ data: { data: [] } })),
      ]);
      setChangeSets(csRes.data?.data || []);
      setTenants(tRes.data?.data || tRes.data?.data?.tenants || []);
    } catch (e) {
      toast.error('Failed to load data');
    }
  };

  useEffect(() => { load(); }, []);

  const cloneSandbox = async () => {
    if (!sourceTenantId) return toast.error('Select a source tenant');
    setLoading(true);
    try {
      const res = await api.post('/change-sets/clone-sandbox', { sourceTenantId, name: name || 'Sandbox' });
      toast.success(`Sandbox created (${res.data?.data?.componentCount} components)`);
      load();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Clone failed');
    } finally { setLoading(false); }
  };

  const createCs = async () => {
    if (!name) return toast.error('Name required');
    setLoading(true);
    try {
      await api.post('/change-sets', { name, components: [] });
      toast.success('Change set created');
      setName('');
      load();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Create failed');
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

  return (
    <Layout title="Deployments" description="Sandbox cloning and change sets">
      <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 24 }}>
        <section>
          <h3>Clone Sandbox Tenant</h3>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            <select value={sourceTenantId} onChange={e=>setSourceTenantId(e.target.value)}>
              <option value="">Source tenant...</option>
              {tenants.map(t => <option key={t._id} value={t._id}>{t.name}</option>)}
            </select>
            <input placeholder="Sandbox name" value={name} onChange={e=>setName(e.target.value)} />
            <Button onClick={cloneSandbox} disabled={loading}>Clone</Button>
          </div>
        </section>

        <section>
          <h3>Create Change Set</h3>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <input placeholder="Change set name" value={name} onChange={e=>setName(e.target.value)} />
            <Button onClick={createCs} disabled={loading}>Create</Button>
          </div>
        </section>

        <section>
          <h3>Target Tenant (for validate/deploy)</h3>
          <select value={targetTenantId} onChange={e=>setTargetTenantId(e.target.value)}>
            <option value="">Target tenant...</option>
            {tenants.map(t => <option key={t._id} value={t._id}>{t.name}</option>)}
          </select>
        </section>

        <section>
          <h3>Change Sets</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th>Name</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {changeSets.map(cs => (
                <tr key={cs._id}>
                  <td>{cs.name}</td>
                  <td>{cs.status}</td>
                  <td>
                    <Button size="sm" onClick={()=>validate(cs._id)}>Validate</Button>
                    <Button size="sm" onClick={()=>deploy(cs._id)} style={{ marginLeft: 8 }}>Deploy</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {validation && (
            <pre style={{ marginTop: 12, background: '#f5f5f5', padding: 12, borderRadius: 6 }}>
              {JSON.stringify(validation, null, 2)}
            </pre>
          )}
        </section>
      </div>
    </Layout>
  );
}