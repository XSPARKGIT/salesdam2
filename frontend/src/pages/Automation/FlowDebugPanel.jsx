import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Play,
  RotateCcw,
  Search,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  SkipForward,
  Clock,
  Database,
  Zap,
  ChevronDown,
  ChevronRight,
  Info,
} from 'lucide-react';
import api from '../../services/api';
import styles from './FlowDebugPanel.module.css';

// ─── Step type icons / colors ─────────────────────────────────
const TYPE_META = {
  trigger: { color: '#7c3aed', label: 'Trigger' },
  condition: { color: '#3b82f6', label: 'Condition' },
  decision: { color: '#7c3aed', label: 'Decision' },
  assignment: { color: '#059669', label: 'Assignment' },
  loop: { color: '#b45309', label: 'Loop' },
  formula: { color: '#0284c7', label: 'Formula' },
  transform: { color: '#7c3aed', label: 'Transform' },
  collection_filter: { color: '#2563eb', label: 'Collection Filter' },
  collection_sort: { color: '#2563eb', label: 'Collection Sort' },
  get_records: { color: '#0891b2', label: 'Get Records' },
  action_update_record: { color: '#10b981', label: 'Update Record' },
  action_create_record: { color: '#6366f1', label: 'Create Record' },
  delete_records: { color: '#dc2626', label: 'Delete Records' },
  action_send_notification: { color: '#8b5cf6', label: 'Send Notification' },
  action_send_email: { color: '#0ea5e9', label: 'Send Email' },
  action_send_message_template: { color: '#25d366', label: 'Send Message Template' },
  action_http_request: { color: '#f59e0b', label: 'HTTP Request' },
  action_toast: { color: '#f59e0b', label: 'Toast' },
  action_wait: { color: '#64748b', label: 'Wait' },
  subflow: { color: '#0ea5e9', label: 'Subflow' },
  pause: { color: '#64748b', label: 'Pause' },
  screen: { color: '#ec4899', label: 'Screen' },
  end: { color: '#94a3b8', label: 'End' },
};

function StatusIcon({ status, size = 16 }) {
  if (status === 'success')
    return <CheckCircle2 size={size} className={styles.iconSuccess} />;
  if (status === 'failed')
    return <XCircle size={size} className={styles.iconFailed} />;
  if (status === 'warning')
    return <AlertTriangle size={size} className={styles.iconWarning} />;
  if (status === 'skipped')
    return <SkipForward size={size} className={styles.iconSkipped} />;
  return <Clock size={size} className={styles.iconSkipped} />;
}

function TraceStep({ step, index }) {
  const [expanded, setExpanded] = useState(false);
  const meta = TYPE_META[step.type] || { color: '#64748b', label: step.type };
  const hasContext =
    step.contextSnapshot && Object.keys(step.contextSnapshot).length > 0;

  return (
    <div
      className={`${styles.traceStep} ${styles[`traceStep_${step.status}`]}`}
    >
      <div
        className={styles.traceStepHeader}
        onClick={() => hasContext && setExpanded((e) => !e)}
      >
        <span className={styles.traceStepIndex}>{index + 1}</span>
        <StatusIcon status={step.status} />
        <span
          className={styles.traceStepTypeDot}
          style={{ background: meta.color }}
        />
        <div className={styles.traceStepInfo}>
          <span className={styles.traceStepLabel}>{step.label}</span>
          <span className={styles.traceStepOutput}>{step.output}</span>
          {step.error && (
            <span className={styles.traceStepError}>{step.error}</span>
          )}
        </div>
        <span className={styles.traceStepDuration}>{step.duration}ms</span>
        {hasContext && (
          <span className={styles.traceExpandBtn}>
            {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </span>
        )}
      </div>

      {expanded && hasContext && (
        <div className={styles.traceStepContext}>
          <div className={styles.contextTitle}>Variables after this step</div>
          <pre className={styles.contextJson}>
            {JSON.stringify(step.contextSnapshot, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

function RecordPicker({ objectApiName, value, onChange }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    if (!objectApiName) return;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await api.get('/records', {
          params: { objectApiName, limit: 8, search: query },
        });
        setResults(res.data.data?.records || res.data.data || []);
        setOpen(true);
      } catch {
        setResults([]);
      }
      setLoading(false);
    }, 300);
  }, [query, objectApiName]);

  const displayName = (r) => {
    const data = r.data || {};
    return data.name || data.title || data.firstName
      ? `${data.firstName ? data.firstName + ' ' : ''}${data.lastName || data.name || data.title || ''}`
      : String(r._id).slice(-8);
  };

  return (
    <div className={styles.recordPicker}>
      {value ? (
        <div className={styles.recordSelected}>
          <Database size={14} />
          <span>
            {displayName(value)} <em>({value.objectApiName})</em>
          </span>
          <button
            className={styles.recordClear}
            onClick={() => {
              onChange(null);
              setQuery('');
              setOpen(false);
            }}
          >
            ×
          </button>
        </div>
      ) : (
        <div className={styles.recordSearch}>
          <Search size={14} className={styles.searchIcon} />
          <input
            className={styles.searchInput}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => {
              if (results.length) setOpen(true);
              else if (objectApiName) setQuery((q) => q + '');
            }}
            placeholder={
              objectApiName
                ? `Search ${objectApiName} records…`
                : 'Select trigger object first'
            }
            disabled={!objectApiName}
          />
          {loading && <span className={styles.searchSpinner} />}
        </div>
      )}

      {open && !value && results.length > 0 && (
        <div className={styles.recordDropdown}>
          {results.map((r) => (
            <button
              key={r._id}
              className={styles.recordOption}
              onClick={() => {
                onChange(r);
                setOpen(false);
                setQuery('');
              }}
            >
              <Database size={12} />
              <span className={styles.recordOptionName}>{displayName(r)}</span>
              <span className={styles.recordOptionId}>
                {String(r._id).slice(-8)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────
export default function FlowDebugPanel({
  automationId,
  flowType,
  triggerObjectApiName,
  triggerEvents = [],
  open,
  onClose,
}) {
  const [phase, setPhase] = useState('config'); // 'config' | 'running' | 'results'
  const [event, setEvent] = useState(triggerEvents[0] || 'create');
  const [record, setRecord] = useState(null);
  const [dryRun, setDryRun] = useState(true);
  const [trace, setTrace] = useState([]);
  const [context, setContext] = useState({});
  const [duration, setDuration] = useState(0);
  const [success, setSuccess] = useState(null);
  const [error, setError] = useState(null);
  const [skipped, setSkipped] = useState(false);
  const resultsRef = useRef(null);

  useEffect(() => {
    if (!open) {
      setPhase('config');
      setError(null);
    }
  }, [open]);

  const runTest = async () => {
    setPhase('running');
    setError(null);
    setTrace([]);
    try {
      const res = await api.post(`/automations/${automationId}/debug`, {
        recordId: record?._id,
        objectApiName: record?.objectApiName || triggerObjectApiName,
        event,
        dryRun,
      });
      const d = res.data.data;
      setTrace(d.trace || []);
      setContext(d.context || {});
      setDuration(d.duration || 0);
      setSuccess(d.success);
      setSkipped(d.skipped || false);
      setPhase('results');
      setTimeout(
        () => resultsRef.current?.scrollTo({ top: 0, behavior: 'smooth' }),
        50,
      );
    } catch (err) {
      setError(err.message || 'Test run failed');
      setPhase('config');
    }
  };

  const reset = () => {
    setPhase('config');
    setTrace([]);
    setError(null);
  };

  if (!open) return null;

  const isRecordTriggered = flowType === 'record_triggered';
  const isScheduled = flowType === 'scheduled';
  const hasVariables = Object.keys(context).length > 0;

  return (
    <div
      className={styles.overlay}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.panel}>
        {/* ── Header ── */}
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <Play size={16} className={styles.headerIcon} />
            <span className={styles.headerTitle}>
              {phase === 'results' ? 'Test Results' : 'Test & Debug Flow'}
            </span>
            {phase === 'results' && (
              <span
                className={`${styles.resultBadge} ${success ? styles.resultBadgeSuccess : styles.resultBadgeFail}`}
              >
                {skipped ? 'Skipped' : success ? 'Passed' : 'Failed'}
              </span>
            )}
          </div>
          <div className={styles.headerRight}>
            {phase === 'results' && (
              <button className={styles.resetBtn} onClick={reset}>
                <RotateCcw size={13} /> New Test
              </button>
            )}
            <button className={styles.closeBtn} onClick={onClose}>
              <X size={16} />
            </button>
          </div>
        </div>

        {/* ── Content ── */}
        <div className={styles.body} ref={resultsRef}>
          {/* ── CONFIG phase ── */}
          {phase === 'config' && (
            <div className={styles.configSection}>
              {error && (
                <div className={styles.errorBanner}>
                  <XCircle size={14} /> {error}
                </div>
              )}

              {/* Trigger event — only for record-triggered */}
              {isRecordTriggered && (
                <div className={styles.field}>
                  <label className={styles.fieldLabel}>Trigger event</label>
                  <div className={styles.eventBtns}>
                    {['create', 'update', 'delete'].map((ev) => (
                      <button
                        key={ev}
                        className={`${styles.eventBtn} ${event === ev ? styles.eventBtnActive : ''}`}
                        onClick={() => setEvent(ev)}
                      >
                        {ev.charAt(0).toUpperCase() + ev.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Record picker */}
              {(isRecordTriggered || isScheduled) && (
                <div className={styles.field}>
                  <label className={styles.fieldLabel}>
                    {isRecordTriggered
                      ? 'Trigger record'
                      : 'Sample record (optional)'}
                    <span className={styles.fieldHint}>
                      {isRecordTriggered
                        ? 'The record the flow will run against'
                        : 'Used to populate {field} merge tokens'}
                    </span>
                  </label>
                  <RecordPicker
                    objectApiName={
                      record?.objectApiName || triggerObjectApiName
                    }
                    value={record}
                    onChange={setRecord}
                  />
                  {!record && triggerObjectApiName && (
                    <p className={styles.recordHint}>
                      No record selected — the most recent{' '}
                      {triggerObjectApiName} record will be used automatically.
                    </p>
                  )}
                </div>
              )}

              {/* Run mode */}
              <div className={styles.field}>
                <label className={styles.fieldLabel}>Run mode</label>
                <div className={styles.runModeCards}>
                  <button
                    className={`${styles.runModeCard} ${dryRun ? styles.runModeActive : ''}`}
                    onClick={() => setDryRun(true)}
                  >
                    <span
                      className={styles.runModeDot}
                      style={{ background: '#059669' }}
                    />
                    <div>
                      <strong>Dry Run</strong>
                      <span>
                        Evaluates logic, reads data — skips emails, record
                        writes & HTTP requests
                      </span>
                    </div>
                  </button>
                  <button
                    className={`${styles.runModeCard} ${!dryRun ? styles.runModeActive : ''}`}
                    onClick={() => setDryRun(false)}
                  >
                    <span
                      className={styles.runModeDot}
                      style={{ background: '#dc2626' }}
                    />
                    <div>
                      <strong>Live Execution</strong>
                      <span>
                        Executes for real — sends emails, updates records, calls
                        APIs
                      </span>
                    </div>
                  </button>
                </div>
                {!dryRun && (
                  <div className={styles.liveWarning}>
                    <AlertTriangle size={13} />
                    Live mode will send real emails, update real records, and
                    call external APIs.
                  </div>
                )}
              </div>

              <button className={styles.runBtn} onClick={runTest}>
                <Play size={15} /> Run Test
              </button>
            </div>
          )}

          {/* ── RUNNING phase ── */}
          {phase === 'running' && (
            <div className={styles.runningSection}>
              <div className={styles.runningSpinner} />
              <p className={styles.runningText}>
                Running flow{dryRun ? ' (dry run)' : ' (live)'}…
              </p>
            </div>
          )}

          {/* ── RESULTS phase ── */}
          {phase === 'results' && (
            <div className={styles.resultsSection}>
              {/* Summary bar */}
              <div
                className={`${styles.summaryBar} ${success ? styles.summaryBarSuccess : styles.summaryBarFail}`}
              >
                <StatusIcon status={success ? 'success' : 'failed'} size={18} />
                <div className={styles.summaryText}>
                  <strong>
                    {skipped
                      ? 'Flow skipped'
                      : success
                        ? 'All steps passed'
                        : 'One or more steps failed'}
                  </strong>
                  <span>
                    {trace.length} step{trace.length !== 1 ? 's' : ''} ·{' '}
                    {duration}ms total · {dryRun ? 'Dry run' : 'Live execution'}
                  </span>
                </div>
              </div>

              {/* Trace steps */}
              <div className={styles.traceList}>
                {trace.map((step, i) => (
                  <TraceStep key={step.id + i} step={step} index={i} />
                ))}
              </div>

              {/* Final variables */}
              {hasVariables && (
                <details className={styles.varDetails}>
                  <summary className={styles.varSummary}>
                    <Info size={13} /> Final variable values (
                    {Object.keys(context).length})
                  </summary>
                  <pre className={styles.varJson}>
                    {JSON.stringify(context, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
