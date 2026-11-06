import React, { useEffect, useState } from 'react';
import { FileCode, Plus, Play, ChevronUp, Trash2, RotateCcw, CheckCircle, X } from 'lucide-react';
import api from '../../services/api';
import Layout from '../../layout/Layout';
import Button from '../../components/common/Button/Button';
import toast from 'react-hot-toast';
import styles from './CustomCode.module.css';

const STATUS_CLASS = {
  active: styles.vActive,
  draft: styles.vDraft,
  inactive: styles.vInactive,
};

export default function CustomCodePage() {
  const [list, setList] = useState([]);
  const [name, setName] = useState('');
  const [code, setCode] = useState('// Write your snippet here.\n// Set result to return a value.\nresult = inputs.x + 1;');
  const [inputs, setInputs] = useState('{\n  "x": 5\n}');
  const [testMode, setTestMode] = useState(false);
  const [changeNote, setChangeNote] = useState('');
  const [execResult, setExecResult] = useState(null);
  const [executing, setExecuting] = useState(null);

  const load = async () => {
    try {
      const res = await api.get('/custom-code');
      setList(res.data?.data || []);
    } catch {
      toast.error('Failed to load snippets');
    }
  };

  useEffect(() => { load(); }, []);

  const parsedInputs = () => {
    try { return JSON.parse(inputs); } catch { return {}; }
  };

  const create = async () => {
    if (!name.trim()) return toast.error('Name is required');
    if (!code.trim()) return toast.error('Code is required');
    try {
      await api.post('/custom-code', { name: name.trim(), code, inputs: parsedInputs() });
      toast.success(`"${name.trim()}" created as v1 draft`);
      setName('');
      load();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Create failed');
    }
  };

  const addVersion = async (snippetName) => {
    if (!code.trim()) return toast.error('Code is required');
    try {
      await api.post(`/custom-code/${snippetName}/versions`, { code, inputs: parsedInputs(), changeNote });
      toast.success('New version added');
      setChangeNote('');
      load();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Add version failed');
    }
  };

  const activate = async (snippetName, v) => {
    try {
      await api.post(`/custom-code/${snippetName}/activate`, { version: v });
      toast.success(`v${v} is now active`);
      load();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Activate failed');
    }
  };

  const restore = async (snippetName, v) => {
    try {
      await api.post(`/custom-code/${snippetName}/restore`, { version: v });
      toast.success(`v${v} restored`);
      load();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Restore failed');
    }
  };

  const execute = async (snippetName) => {
    setExecuting(snippetName);
    try {
      const res = await api.post(`/custom-code/${snippetName}/execute`, {
        inputs: parsedInputs(),
        testMode,
      });
      setExecResult({ name: snippetName, data: res.data?.data });
      toast.success('Executed');
    } catch (e) {
      toast.error(e.response?.data?.message || 'Execute failed');
      setExecResult({ name: snippetName, data: { error: e.response?.data?.message || 'Execution failed' } });
    } finally {
      setExecuting(null);
    }
  };

  const remove = async (snippetName) => {
    if (!window.confirm(`Delete "${snippetName}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/custom-code/${snippetName}`);
      toast.success('Snippet deleted');
      if (execResult?.name === snippetName) setExecResult(null);
      load();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Delete failed');
    }
  };

  return (
    <Layout>
      <div className={styles.page}>
        {/* Page header */}
        <div className={styles.pageHeader}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 44, height: 44, borderRadius: 10, background: '#eef2ff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <FileCode size={22} color="#4f46e5" />
            </div>
            <div>
              <h1 className={styles.pageTitle}>Custom Code</h1>
              <p className={styles.pageDesc}>Tenant-specific code snippets that can be invoked from Automations.</p>
            </div>
          </div>
        </div>

        <div className={styles.layout}>
          {/* ── Editor panel ── */}
          <div className={styles.panel}>
            <div className={styles.panelHeader}>
              <Plus size={14} />
              New Snippet / Add Version
            </div>
            <div className={styles.panelBody}>
              <div className={styles.field}>
                <label className={styles.label}>Snippet name <span style={{ color: '#ef4444' }}>*</span></label>
                <p className={styles.hint}>Required when creating. Leave blank when adding a version to an existing snippet below.</p>
                <input
                  className={styles.input}
                  placeholder="e.g. calculate-risk-score"
                  value={name}
                  onChange={e => setName(e.target.value)}
                />
              </div>

              <div className={styles.field}>
                <label className={styles.label}>Code <span style={{ color: '#ef4444' }}>*</span></label>
                <p className={styles.hint}>Set <code style={{ fontFamily: 'monospace', fontSize: 11 }}>result</code> to return a value. Use <code style={{ fontFamily: 'monospace', fontSize: 11 }}>inputs.fieldName</code> to read inputs.</p>
                <textarea
                  className={styles.codeInput}
                  rows={8}
                  value={code}
                  onChange={e => setCode(e.target.value)}
                />
              </div>

              <div className={styles.field}>
                <label className={styles.label}>Test inputs (JSON)</label>
                <p className={styles.hint}>Used when you click Execute on a snippet row.</p>
                <textarea
                  className={styles.codeInput}
                  rows={3}
                  value={inputs}
                  onChange={e => setInputs(e.target.value)}
                />
              </div>

              <div className={styles.field}>
                <label className={styles.label}>Change note</label>
                <p className={styles.hint}>Optional. Used only when adding a new version to an existing snippet.</p>
                <input
                  className={styles.input}
                  placeholder="e.g. Fixed edge case for null inputs"
                  value={changeNote}
                  onChange={e => setChangeNote(e.target.value)}
                />
              </div>

              <label className={styles.checkRow}>
                <input type="checkbox" checked={testMode} onChange={e => setTestMode(e.target.checked)} />
                Test mode — disable writes when executing
              </label>

              <Button onClick={create} style={{ width: '100%' }}>
                <Plus size={14} /> Create new snippet (v1 draft)
              </Button>
            </div>
          </div>

          {/* ── Snippet list ── */}
          <div className={styles.listPanel}>
            <div className={styles.listHeader}>
              <span className={styles.listTitle}>Snippets</span>
              <span className={styles.listCount}>{list.length} total</span>
            </div>

            {list.length === 0 ? (
              <div className={styles.empty}>
                No snippets yet. Create your first one using the editor on the left.
              </div>
            ) : (
              list.map(c => (
                <div key={c._id} className={styles.card}>
                  <div className={styles.cardHeader}>
                    <div>
                      <div className={styles.cardName}>{c.name}</div>
                      <div className={styles.cardMeta}>
                        {c.activeVersion != null ? `Active: v${c.activeVersion}` : 'No active version'} · {c.versions?.length || 0} version{c.versions?.length !== 1 ? 's' : ''}
                      </div>
                    </div>
                    <div className={styles.cardRight}>
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => execute(c.name)}
                        disabled={executing === c.name}
                        title="Execute using inputs from the editor panel"
                      >
                        <Play size={12} /> {executing === c.name ? 'Running…' : 'Execute'}
                      </Button>
                      <Button size="sm" variant="danger" onClick={() => remove(c.name)} title="Delete snippet">
                        <Trash2 size={12} />
                      </Button>
                    </div>
                  </div>

                  {/* Version pills */}
                  {c.versions?.length > 0 && (
                    <div className={styles.versions}>
                      {c.versions.map(v => (
                        <span key={v.version} className={`${styles.vTag} ${STATUS_CLASS[v.status] || styles.vOther}`}>
                          v{v.version} · {v.status}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Per-version actions */}
                  <div className={styles.actions}>
                    <Button size="sm" variant="secondary" onClick={() => addVersion(c.name)} title="Add a new version using code from the editor panel">
                      <Plus size={12} /> Add version
                    </Button>
                    {c.versions?.filter(v => v.status !== 'active').map(v => (
                      <Button key={`act-${v.version}`} size="sm" onClick={() => activate(c.name, v.version)}>
                        <CheckCircle size={12} /> Activate v{v.version}
                      </Button>
                    ))}
                    {c.versions?.map(v => (
                      <Button key={`rst-${v.version}`} size="sm" variant="secondary" onClick={() => restore(c.name, v.version)}>
                        <RotateCcw size={12} /> Restore v{v.version}
                      </Button>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* ── Execution result ── */}
          {execResult && (
            <div className={styles.execPanel}>
              <div className={styles.execHeader}>
                <span>
                  <Play size={13} style={{ marginRight: 6, verticalAlign: 'middle' }} />
                  Execution result — <strong>{execResult.name}</strong>
                  {execResult.data?.success === true && <span className={styles.execSuccess}> · success</span>}
                  {execResult.data?.success === false && <span className={styles.execError}> · failed</span>}
                  {execResult.data?.durationMs != null && <span style={{ color: 'var(--color-gray-400)', fontWeight: 400 }}> · {execResult.data.durationMs}ms</span>}
                </span>
                <button onClick={() => setExecResult(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-gray-400)' }}>
                  <X size={15} />
                </button>
              </div>
              <div className={styles.execBody}>
                <pre className={styles.execPre}>{JSON.stringify(execResult.data, null, 2)}</pre>
              </div>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
