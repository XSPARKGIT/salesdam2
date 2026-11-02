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
  const [testMode, setTestMode] = useState(false);
  const [selected, setSelected] = useState(null);
  const [execResult, setExecResult] = useState(null);
  const [changeNote, setChangeNote] = useState('');

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
      toast.error(e.message || 'Create failed');
    }
  };

  const addVersion = async (n) => {
    if (!code) return toast.error('Code required');
    try {
      let parsedInputs = {};
      try { parsedInputs = JSON.parse(inputs); } catch {}
      await api.post(`/custom-code/${n}/versions`, { code, inputs: parsedInputs, changeNote });
      toast.success('Version added');
      setChangeNote('');
      load();
    } catch (e) {
      toast.error(e.message || 'Add version failed');
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
      toast.error(e.message || 'Activate failed');
    }
  };

  const restore = async (n, v) => {
    try {
      await api.post(`/custom-code/${n}/restore`, { version: v });
      toast.success(`v${v} restored`);
      load();
    } catch (e) {
      toast.error(e.message || 'Restore failed');
    }
  };

  const execute = async (n) => {
    try {
      let parsedInputs = {};
      try { parsedInputs = JSON.parse(inputs); } catch {}
      const res = await api.post(`/custom-code/${n}/execute`, { inputs: parsedInputs, testMode });
      setExecResult(res.data?.data);
      toast.success('Executed');
    } catch (e) {
      toast.error(e.message || 'Execute failed');
      setExecResult(e.data || null);
    }
  };

  const remove = async (n) => {
    if (!window.confirm(`Delete ${n}?`)) return;
    try {
      await api.delete(`/custom-code/${n}`);
      toast.success('Deleted');
      load();
    } catch (e) {
      toast.error(e.message || 'Delete failed');
    }
  };

  return (
    <Layout title="Custom Code" description="Tenant-specific code snippets">
      <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 24 }}>
        <section>
          <h3>Code Editor</h3>
          <p style={{ fontSize: 13, color: '#666', marginTop: -4 }}>
            Used both to create a new snippet below and to add a new version to an existing one via the row's "Add Version" button.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8, maxWidth: 600 }}>
            <input placeholder="Name (for new snippet only)" value={name} onChange={e=>setName(e.target.value)} />
            <textarea rows={6} value={code} onChange={e=>setCode(e.target.value)} style={{ fontFamily: 'monospace' }} />
            <input placeholder='Inputs JSON (e.g. {"x":5})' value={inputs} onChange={e=>setInputs(e.target.value)} />
            <input placeholder="Change note (used by Add Version only)" value={changeNote} onChange={e=>setChangeNote(e.target.value)} />
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
              <input type="checkbox" checked={testMode} onChange={e=>setTestMode(e.target.checked)} />
              Test mode (disable writes)
            </label>
            <Button onClick={create}>Create New Snippet (v1 draft)</Button>
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
                    <Button size="sm" variant="secondary" onClick={()=>addVersion(c.name)} style={{ marginRight: 4 }}>
                      Add Version (from code box above)
                    </Button>
                    {(c.versions||[]).filter(v=>v.status!=='active').map(v=>(
                      <Button key={v.version} size="sm" onClick={()=>activate(c.name,v.version)} style={{ marginRight: 4 }}>
                        Activate v{v.version}
                      </Button>
                    ))}
                    {(c.versions||[]).map(v=>(
                      <Button key={`r${v.version}`} size="sm" variant="secondary" onClick={()=>restore(c.name,v.version)} style={{ marginRight: 4 }}>
                        Restore v{v.version}
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