import React, { useEffect, useState, useRef } from 'react';
import {
  FileCode, Plus, Play, Trash2, RotateCcw, CheckCircle, X,
  Edit2, ChevronDown, ChevronUp, Clock, AlertCircle,
} from 'lucide-react';
import api from '../../services/api';
import Layout from '../../layout/Layout';
import Button from '../../components/common/Button/Button';
import toast from 'react-hot-toast';
import styles from './CustomCode.module.css';

const STATUS_CLASS = {
  active: styles.vActive,
  draft: styles.vDraft,
  inactive: styles.vInactive,
  archived: styles.vOther,
};

function formatRelativeTime(dateStr) {
  if (!dateStr) return null;
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (mins > 0) return `${mins}m ago`;
  return 'just now';
}

export default function CustomCodePage() {
  const [list, setList] = useState([]);

  // mode: 'create' | 'edit'
  const [mode, setMode] = useState('create');
  const [selectedSnippet, setSelectedSnippet] = useState(null);
  const [editingVersion, setEditingVersion] = useState(null);
  const selectedNameRef = useRef(null);

  // form fields
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [code, setCode] = useState('// Set result to return a value.\nresult = inputs.x + 1;');
  const [inputs, setInputs] = useState('{\n  "x": 5\n}');
  const [changeNote, setChangeNote] = useState('');
  const [inputsError, setInputsError] = useState('');
  const [testMode, setTestMode] = useState(false);

  // async state
  const [executing, setExecuting] = useState(null);
  const [execResult, setExecResult] = useState(null);
  const [saving, setSaving] = useState(false);
  const [expandedCards, setExpandedCards] = useState({});

  // Keep ref in sync for use inside load()
  useEffect(() => { selectedNameRef.current = selectedSnippet?.name ?? null; }, [selectedSnippet]);

  const loadList = async () => {
    const res = await api.get('/custom-code');
    return res.data?.data || [];
  };

  const refreshList = async () => {
    try {
      const data = await loadList();
      setList(data);
      if (selectedNameRef.current) {
        const updated = data.find(s => s.name === selectedNameRef.current);
        if (updated) setSelectedSnippet(updated);
        else {
          // snippet was deleted while editing
          setMode('create');
          setSelectedSnippet(null);
        }
      }
    } catch {
      toast.error('Failed to load snippets');
    }
  };

  useEffect(() => { refreshList(); }, []);

  const parsedInputs = () => {
    try { return JSON.parse(inputs); } catch { return null; }
  };

  const handleInputsChange = (val) => {
    setInputs(val);
    if (!val.trim()) { setInputsError(''); return; }
    try { JSON.parse(val); setInputsError(''); }
    catch (e) { setInputsError(e.message); }
  };

  const loadVersionIntoEditor = (v) => {
    setEditingVersion(v.version);
    setCode(v.code || '');
    const inp = v.inputs;
    const inpStr = inp && typeof inp === 'object' ? JSON.stringify(inp, null, 2) : (typeof inp === 'string' ? inp : '{}');
    setInputs(inpStr);
    setChangeNote(v.changeNote || '');
    setInputsError('');
  };

  const loadForEdit = (snippet) => {
    setSelectedSnippet(snippet);
    selectedNameRef.current = snippet.name;
    setMode('edit');
    setDescription(snippet.description || '');

    // Prefer latest draft, fall back to highest version number
    const versions = snippet.versions?.slice().sort((a, b) => b.version - a.version) || [];
    const draft = versions.find(v => v.status === 'draft');
    const toLoad = draft || versions[0];
    if (toLoad) loadVersionIntoEditor(toLoad);
  };

  const cancelEdit = () => {
    setMode('create');
    setSelectedSnippet(null);
    selectedNameRef.current = null;
    setEditingVersion(null);
    setDescription('');
    setCode('// Set result to return a value.\nresult = inputs.x + 1;');
    setInputs('{\n  "x": 5\n}');
    setChangeNote('');
    setInputsError('');
  };

  // Create new snippet
  const create = async () => {
    if (!name.trim()) return toast.error('Name is required');
    if (!code.trim()) return toast.error('Code is required');
    if (inputsError) return toast.error('Fix the JSON in Test inputs before creating');
    setSaving(true);
    try {
      await api.post('/custom-code', {
        name: name.trim(), description: description.trim(), code, inputs: parsedInputs(),
      });
      toast.success(`"${name.trim()}" created as v1 draft`);
      setName('');
      setDescription('');
      await refreshList();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Create failed');
    } finally { setSaving(false); }
  };

  // Save changes to a draft version (and description)
  const saveVersion = async () => {
    if (!selectedSnippet || !editingVersion) return;
    if (!code.trim()) return toast.error('Code is required');
    if (inputsError) return toast.error('Fix the JSON in Test inputs before saving');
    setSaving(true);
    try {
      await api.patch(`/custom-code/${selectedSnippet.name}`, { description: description.trim() });
      await api.patch(`/custom-code/${selectedSnippet.name}/versions/${editingVersion}`, {
        code, inputs: parsedInputs(), changeNote,
      });
      toast.success('Changes saved');
      await refreshList();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Save failed');
    } finally { setSaving(false); }
  };

  // Save only description (when editing a non-draft version)
  const saveDescription = async () => {
    if (!selectedSnippet) return;
    setSaving(true);
    try {
      await api.patch(`/custom-code/${selectedSnippet.name}`, { description: description.trim() });
      toast.success('Description updated');
      await refreshList();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Update failed');
    } finally { setSaving(false); }
  };

  const addVersion = async (snippetName) => {
    if (!code.trim()) return toast.error('Code is required');
    if (inputsError) return toast.error('Fix the JSON in Test inputs before adding a version');
    setSaving(true);
    try {
      await api.post(`/custom-code/${snippetName}/versions`, {
        code, inputs: parsedInputs(), changeNote,
      });
      toast.success('New version added');
      setChangeNote('');
      await refreshList();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Add version failed');
    } finally { setSaving(false); }
  };

  const activate = async (snippetName, v) => {
    try {
      await api.post(`/custom-code/${snippetName}/activate`, { version: v });
      toast.success(`v${v} is now active`);
      await refreshList();
    } catch (e) { toast.error(e.response?.data?.message || 'Activate failed'); }
  };

  const restore = async (snippetName, v) => {
    try {
      await api.post(`/custom-code/${snippetName}/restore`, { version: v });
      toast.success(`v${v} restored`);
      await refreshList();
    } catch (e) { toast.error(e.response?.data?.message || 'Restore failed'); }
  };

  const execute = async (snippetName) => {
    if (inputsError) return toast.error('Fix the JSON in Test inputs before executing');
    setExecuting(snippetName);
    try {
      const res = await api.post(`/custom-code/${snippetName}/execute`, {
        inputs: parsedInputs() ?? {}, testMode,
      });
      setExecResult({ name: snippetName, data: res.data?.data });
      toast.success('Executed');
    } catch (e) {
      toast.error(e.response?.data?.message || 'Execute failed');
      setExecResult({ name: snippetName, data: { error: e.response?.data?.message || 'Execution failed' } });
    } finally { setExecuting(null); }
  };

  const remove = async (snippetName) => {
    if (!window.confirm(`Delete "${snippetName}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/custom-code/${snippetName}`);
      toast.success('Snippet deleted');
      if (execResult?.name === snippetName) setExecResult(null);
      if (selectedSnippet?.name === snippetName) cancelEdit();
      await refreshList();
    } catch (e) { toast.error(e.response?.data?.message || 'Delete failed'); }
  };

  const toggleCard = (snippetName) => {
    setExpandedCards(prev => ({ ...prev, [snippetName]: !prev[snippetName] }));
  };

  const editingVersionObj = selectedSnippet?.versions?.find(v => v.version === editingVersion);
  const isEditingDraft = editingVersionObj?.status === 'draft';

  return (
    <Layout>
      <div className={styles.page}>
        <div className={styles.pageHeader}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{
              width: 44, height: 44, borderRadius: 10, background: '#eef2ff',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
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
            {mode === 'create' ? (
              <>
                <div className={styles.panelHeader}>
                  <Plus size={14} /> New Snippet
                </div>
                <div className={styles.panelBody}>
                  <div className={styles.field}>
                    <label className={styles.label}>Snippet name <span style={{ color: '#ef4444' }}>*</span></label>
                    <input
                      className={styles.input}
                      placeholder="e.g. calculate-risk-score"
                      value={name}
                      onChange={e => setName(e.target.value)}
                    />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label}>Description</label>
                    <input
                      className={styles.input}
                      placeholder="What does this snippet do?"
                      value={description}
                      onChange={e => setDescription(e.target.value)}
                    />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label}>Code <span style={{ color: '#ef4444' }}>*</span></label>
                    <p className={styles.hint}>Set <code style={{ fontFamily: 'monospace', fontSize: 11 }}>result</code> to return a value. Use <code style={{ fontFamily: 'monospace', fontSize: 11 }}>inputs.fieldName</code> to access inputs.</p>
                    <textarea className={styles.codeInput} rows={8} value={code} onChange={e => setCode(e.target.value)} />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label}>Test inputs (JSON)</label>
                    <p className={styles.hint}>Used when you click Execute on a snippet.</p>
                    <textarea
                      className={styles.codeInput}
                      rows={3}
                      value={inputs}
                      onChange={e => handleInputsChange(e.target.value)}
                      style={inputsError ? { borderColor: '#ef4444', boxShadow: '0 0 0 3px rgba(239,68,68,0.15)' } : undefined}
                    />
                    {inputsError && (
                      <p style={{ margin: '4px 0 0', fontSize: 11, color: '#ef4444', fontFamily: 'monospace' }}>
                        Invalid JSON: {inputsError}
                      </p>
                    )}
                  </div>
                  <Button onClick={create} style={{ width: '100%' }} disabled={saving}>
                    <Plus size={14} /> {saving ? 'Creating…' : 'Create snippet (v1 draft)'}
                  </Button>
                </div>
              </>
            ) : (
              /* ── Edit mode ── */
              <>
                <div className={styles.panelHeader} style={{ justifyContent: 'space-between' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Edit2 size={14} />
                    Editing: <strong style={{ color: 'var(--color-primary)', marginLeft: 2 }}>{selectedSnippet?.name}</strong>
                  </span>
                  <button
                    onClick={cancelEdit}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-gray-400)', display: 'flex', padding: 2 }}
                    title="Cancel editing"
                  >
                    <X size={15} />
                  </button>
                </div>
                <div className={styles.panelBody}>
                  <div className={styles.field}>
                    <label className={styles.label}>Description</label>
                    <input
                      className={styles.input}
                      placeholder="What does this snippet do?"
                      value={description}
                      onChange={e => setDescription(e.target.value)}
                    />
                  </div>

                  {/* Version selector */}
                  {(selectedSnippet?.versions?.length ?? 0) > 1 && (
                    <div className={styles.field}>
                      <label className={styles.label}>Viewing version</label>
                      <select
                        className={styles.input}
                        value={editingVersion ?? ''}
                        onChange={e => {
                          const vNum = Number(e.target.value);
                          const v = selectedSnippet.versions.find(x => x.version === vNum);
                          if (v) loadVersionIntoEditor(v);
                        }}
                      >
                        {selectedSnippet.versions
                          .slice()
                          .sort((a, b) => b.version - a.version)
                          .map(v => (
                            <option key={v.version} value={v.version}>
                              v{v.version} · {v.status}{v.changeNote ? ` — ${v.changeNote.slice(0, 30)}` : ''}
                            </option>
                          ))}
                      </select>
                    </div>
                  )}

                  {!isEditingDraft && editingVersion && (
                    <div className={styles.notice}>
                      <AlertCircle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
                      <span>
                        v{editingVersion} is <strong>{editingVersionObj?.status}</strong> — code is read-only.
                        Use <strong>Add version</strong> to save a new draft based on this code.
                      </span>
                    </div>
                  )}

                  <div className={styles.field}>
                    <label className={styles.label}>
                      Code {isEditingDraft && <span style={{ color: '#ef4444' }}>*</span>}
                    </label>
                    <textarea
                      className={styles.codeInput}
                      rows={9}
                      value={code}
                      onChange={e => setCode(e.target.value)}
                      readOnly={!isEditingDraft}
                      style={!isEditingDraft ? { opacity: 0.65, cursor: 'default' } : undefined}
                    />
                  </div>

                  <div className={styles.field}>
                    <label className={styles.label}>Test inputs (JSON)</label>
                    <textarea
                      className={styles.codeInput}
                      rows={3}
                      value={inputs}
                      onChange={e => handleInputsChange(e.target.value)}
                      style={inputsError ? { borderColor: '#ef4444', boxShadow: '0 0 0 3px rgba(239,68,68,0.15)' } : undefined}
                    />
                    {inputsError && (
                      <p style={{ margin: '4px 0 0', fontSize: 11, color: '#ef4444', fontFamily: 'monospace' }}>
                        Invalid JSON: {inputsError}
                      </p>
                    )}
                  </div>

                  <div className={styles.field}>
                    <label className={styles.label}>Change note</label>
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

                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {isEditingDraft ? (
                      <Button onClick={saveVersion} disabled={saving} style={{ flex: 1 }}>
                        {saving ? 'Saving…' : 'Save changes'}
                      </Button>
                    ) : (
                      <Button onClick={saveDescription} disabled={saving} variant="secondary" style={{ flex: 1 }}>
                        {saving ? 'Saving…' : 'Save description'}
                      </Button>
                    )}
                    <Button
                      onClick={() => addVersion(selectedSnippet.name)}
                      disabled={saving}
                      variant="secondary"
                      style={{ flex: 1 }}
                    >
                      <Plus size={12} /> Add version
                    </Button>
                  </div>

                  <Button
                    onClick={() => execute(selectedSnippet.name)}
                    disabled={executing === selectedSnippet?.name}
                    variant="secondary"
                    style={{ width: '100%' }}
                  >
                    <Play size={12} />
                    {executing === selectedSnippet?.name ? 'Running…' : 'Execute'}
                  </Button>
                </div>
              </>
            )}
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
              list.map(c => {
                const execs = c.executions || [];
                const lastExec = execs[execs.length - 1];
                const avgDuration = execs.length > 0
                  ? Math.round(execs.reduce((s, e) => s + (e.durationMs || 0), 0) / execs.length)
                  : null;
                const isSelected = selectedSnippet?.name === c.name;
                const isExpanded = !!expandedCards[c.name];
                const hasVersionActions = c.versions?.some(v => v.status !== 'active');

                // Determine code preview: active version first, then latest
                const previewVersion = c.versions?.find(v => v.status === 'active')
                  || c.versions?.slice().sort((a, b) => b.version - a.version)[0];
                const codePreviewLines = (previewVersion?.code || '')
                  .split('\n')
                  .filter(l => l.trim())
                  .slice(0, 4);
                const isCodeExpanded = !!expandedCards[`code_${c.name}`];

                return (
                  <div key={c._id} className={`${styles.card} ${isSelected ? styles.cardSelected : ''}`}>
                    <div className={styles.cardHeader}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className={styles.cardName}>{c.name}</div>
                        {c.description && <div className={styles.cardDesc}>{c.description}</div>}
                        <div className={styles.cardMeta}>
                          {c.activeVersion != null ? `Active: v${c.activeVersion}` : 'No active version'}
                          {' · '}{c.versions?.length || 0} version{c.versions?.length !== 1 ? 's' : ''}
                          {execs.length > 0 && <> · {execs.length} run{execs.length !== 1 ? 's' : ''}</>}
                        </div>
                      </div>
                      <div className={styles.cardRight}>
                        <Button
                          size="sm"
                          variant={isSelected ? 'primary' : 'secondary'}
                          onClick={() => loadForEdit(c)}
                          title="Edit this snippet"
                        >
                          <Edit2 size={12} /> Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => execute(c.name)}
                          disabled={executing === c.name}
                          title="Execute using test inputs from the editor"
                        >
                          <Play size={12} /> {executing === c.name ? '…' : 'Run'}
                        </Button>
                        <Button size="sm" variant="danger" onClick={() => remove(c.name)} title="Delete snippet">
                          <Trash2 size={12} />
                        </Button>
                      </div>
                    </div>

                    {/* Version pills */}
                    {c.versions?.length > 0 && (
                      <div className={styles.versions}>
                        {c.versions
                          .slice()
                          .sort((a, b) => a.version - b.version)
                          .map(v => (
                            <span
                              key={v.version}
                              className={`${styles.vTag} ${STATUS_CLASS[v.status] || styles.vOther}`}
                            >
                              v{v.version} · {v.status}
                              {v.changeNote && (
                                <span style={{ opacity: 0.65 }}>
                                  {' — '}{v.changeNote.slice(0, 28)}{v.changeNote.length > 28 ? '…' : ''}
                                </span>
                              )}
                            </span>
                          ))}
                      </div>
                    )}

                    {/* Code preview */}
                    {codePreviewLines.length > 0 && (
                      <div className={styles.codePreview}>
                        <div className={styles.codePreviewHeader}>
                          <span className={styles.codePreviewLabel}>
                            {previewVersion?.status === 'active' ? `v${previewVersion.version} · active` : `v${previewVersion?.version} · ${previewVersion?.status}`}
                          </span>
                          <button
                            className={styles.expandBtn}
                            onClick={() => setExpandedCards(p => ({ ...p, [`code_${c.name}`]: !p[`code_${c.name}`] }))}
                          >
                            {isCodeExpanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                            {isCodeExpanded ? 'Less' : 'View code'}
                          </button>
                        </div>
                        <pre className={styles.codePreviewPre}>
                          {isCodeExpanded
                            ? (previewVersion?.code || '')
                            : codePreviewLines.join('\n') + (previewVersion?.code?.split('\n').filter(l => l.trim()).length > 4 ? '\n…' : '')}
                        </pre>
                      </div>
                    )}

                    {/* Footer: stats + expand */}
                    {(lastExec || hasVersionActions) && (
                      <div className={styles.cardFooter}>
                        {lastExec ? (
                          <div className={styles.statsRow}>
                            <Clock size={11} />
                            Last run {formatRelativeTime(lastExec.startedAt)}
                            {avgDuration != null && <> · avg {avgDuration}ms</>}
                            {lastExec.success === false && (
                              <span style={{ color: '#ef4444' }}> · last failed</span>
                            )}
                          </div>
                        ) : <div />}
                        {hasVersionActions && (
                          <button className={styles.expandBtn} onClick={() => toggleCard(c.name)}>
                            {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                            {isExpanded ? 'Hide' : 'Actions'}
                          </button>
                        )}
                      </div>
                    )}

                    {/* Expanded version actions */}
                    {isExpanded && (
                      <div className={styles.actions}>
                        {c.versions?.filter(v => v.status !== 'active').map(v => (
                          <Button
                            key={`act-${v.version}`}
                            size="sm"
                            onClick={() => activate(c.name, v.version)}
                          >
                            <CheckCircle size={12} /> Activate v{v.version}
                          </Button>
                        ))}
                        {c.versions?.map(v => (
                          <Button
                            key={`rst-${v.version}`}
                            size="sm"
                            variant="secondary"
                            onClick={() => restore(c.name, v.version)}
                          >
                            <RotateCcw size={12} /> Restore v{v.version}
                          </Button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* ── Execution result ── */}
          {execResult && (
            <div className={styles.execPanel}>
              <div className={styles.execHeader}>
                <span>
                  <Play size={13} style={{ marginRight: 6, verticalAlign: 'middle' }} />
                  Execution result — <strong>{execResult.name}</strong>
                  {execResult.data?.success === true && (
                    <span className={styles.execSuccess}> · success</span>
                  )}
                  {execResult.data?.success === false && (
                    <span className={styles.execError}> · failed</span>
                  )}
                  {execResult.data?.durationMs != null && (
                    <span style={{ color: 'var(--color-gray-400)', fontWeight: 400 }}>
                      {' · '}{execResult.data.durationMs}ms
                    </span>
                  )}
                </span>
                <button
                  onClick={() => setExecResult(null)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-gray-400)' }}
                >
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
