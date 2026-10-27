import React, { useEffect, useState } from 'react';
import api from '../../services/api';
import Layout from '../../layout/Layout';
import Button from '../../components/common/Button/Button';
import toast from 'react-hot-toast';

export default function CustomCodePage() {
  const [list, setList] = useState([]);
  const [name, setName] = useState('');
  const [code, setCode] = useState('result = inputs.x + 1;');
  const [inputs, setInputs] = useState('{}');
  const [execResult, setExecResult] = useState(null);
  const [selected, setSelected] = useState(null);

  const load = async () => {
    try {
      const res = await api.get('/custom-code');
      setList(res.data?.data || []);
    } catch (e) {
      toast.error('Failed to load custom code');
    }
  };

  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!name || !code) return toast.error('Name and code required');
    try {
      let parsedInputs = {};
      try { parsedInputs = JSON.parse(inputs); } catch {}
      await api.post('/custom-code', { name, code, inputs: parsedInputs });
      toast.success('Created (v1 draft)');
      setName('');
      load();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Create failed');
    }
  };

  const activate = async (n, v) => {
    try {
      await api.post(`/custom-code/${n}/activate`, { version: v });
      toast.success(`v${v} activated`);
      load();
      if (selected === n) {
        const r = await api.get(`/custom-code/${n}`);
        setSelected(n);
      }
    } catch (e) {
      toast.error(e.response?.data?.message || 'Activate failed');
    }
  };

  const execute = async (n) => {
    try {
      let parsedInputs = {};
      try { parsedInputs = JSON.parse(inputs); } catch {}
      const res = await api.post(`/custom-code/${n}/execute`, { inputs: parsedInputs });
      setExecResult(res.data?.data);
      toast.success('Executed');
    } catch (e) {
      toast.error(e.response?.data?.message || 'Execute failed');
      setExecResult(e.response?.data || null);
    }
  };

  const remove = async (n) => {
    if (!window.confirm(`Delete ${n}?`)) return;
    try {
      await api.delete(`/custom-code/${n}`);
      toast.success('Deleted');
      load();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Delete failed');
    }
  };

  return (
    <Layout title="Custom Code" description="Tenant-specific code snippets">
      <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 24 }}>
        <section>
          <h3>Create Custom Code</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8, maxWidth: 600 }}>
            <input placeholder="Name" value={name} onChange={e=>setName(e.target.value)} />
            <textarea rows={6} value={code} onChange={e=>setCode(e.target.value)} style={{ fontFamily: 'monospace' }} />
            <input placeholder='Inputs JSON (e.g. {"x":5})' value={inputs} onChange={e=>setInputs(e.target.value)} />
            <Button onClick={create}>Create (v1 draft)</Button>
          </div>
        </section>

        <section>
          <h3>Custom Code List</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th>Name</th><th>Active Version</th><th>Versions</th><th>Actions</th></tr></thead>
            <tbody>
              {list.map(c => (
                <tr key={c._id}>
                  <td>{c.name}</td>
                  <td>{c.activeVersion ?? 'none'}</td>
                  <td>{(c.versions||[]).map(v=>`v${v.version}(${v.status})`).join(', ')}</td>
                  <td>
                    {(c.versions||[]).filter(v=>v.status!=='active').map(v=>(
                      <Button key={v.version} size="sm" onClick={()=>activate(c.name,v.version)} style={{ marginRight: 4 }}>
                        Activate v{v.version}
                      </Button>
                    ))}
                    <Button size="sm" onClick={()=>execute(c.name)} style={{ marginLeft: 4 }}>Execute</Button>
                    <Button size="sm" onClick={()=>remove(c.name)} style={{ marginLeft: 4 }}>Delete</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {execResult && (
          <section>
            <h3>Execution Result</h3>
            <pre style={{ background: '#f5f5f5', padding: 12, borderRadius: 6 }}>
              {JSON.stringify(execResult, null, 2)}
            </pre>
          </section>
        )}
      </div>
    </Layout>
  );
}