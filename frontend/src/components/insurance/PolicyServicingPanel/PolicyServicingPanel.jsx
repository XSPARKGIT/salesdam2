import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { format, formatDistanceToNow } from 'date-fns';
import {
  ShieldCheck,
  FileText,
  Download,
  ExternalLink,
  Mail,
  MessageSquare,
  History,
  BadgeCheck,
} from 'lucide-react';
import Button from '../../common/Button/Button';
import Modal from '../../common/Modal/Modal';
import {
  getPolicyState,
  applyPolicyAction,
  issuePolicy,
  getPolicyDocuments,
  generatePolicyDocument,
  getPolicyCommunications,
  getFile,
} from '../../../services/api/insurance';
import styles from './PolicyServicingPanel.module.css';

// Display order and wording for each servicing action the server may allow.
const ACTIONS = {
  reinstate: {
    label: 'Reinstate',
    variant: 'primary',
    reasonRequired: false,
    description: 'Restores cover on a lapsed or in-arrears policy.',
    notifies: true,
  },
  reactivate: {
    label: 'Reactivate',
    variant: 'primary',
    reasonRequired: false,
    description: 'Resumes a suspended policy.',
  },
  suspend: {
    label: 'Suspend',
    variant: 'secondary',
    reasonRequired: true,
    description: 'Temporarily pauses the policy. It can be reactivated later.',
  },
  lapse: {
    label: 'Lapse',
    variant: 'secondary',
    reasonRequired: true,
    description: 'Cover stops. The policy can be reinstated later.',
    notifies: true,
  },
  cancel: {
    label: 'Cancel policy',
    variant: 'danger',
    reasonRequired: true,
    description: 'Cover ends permanently. A cancelled policy can’t be reinstated — only closed.',
    notifies: true,
  },
  close: {
    label: 'Close',
    variant: 'danger',
    reasonRequired: true,
    description: 'Final. No further status changes are possible after closing.',
  },
};

const DONE = {
  issue: 'issued',
  reinstate: 'reinstated',
  reactivate: 'reactivated',
  suspend: 'suspended',
  lapse: 'lapsed',
  cancel: 'cancelled',
  close: 'closed',
};

const DOC_TYPES = [
  { type: 'contract', label: 'Contract' },
  { type: 'schedule', label: 'Schedule' },
  { type: 'certificate', label: 'Certificate' },
];

const STATUS_TONE = {
  active: 'good',
  application_submitted: 'info',
  quote_generated: 'info',
  application_started: 'info',
  inactive: 'warn',
  in_arrears: 'warn',
  lapsed: 'bad',
  cancelled: 'bad',
  closed: 'muted',
};

const humanize = (v) => (v ? String(v).replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : '');

const fmtDate = (v) => (v ? format(new Date(v), 'd MMM yyyy') : '—');
const fmtBytes = (n) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round((n || 0) / 1024))} KB`);
const errMessage = (err, fallback) => err?.response?.data?.message || fallback;

/** Open (HTML) or download (PDF/other) a stored file. */
const openFile = async (doc) => {
  // Open the tab synchronously, inside the click: a window.open() after the
  // download finishes no longer counts as user-initiated and is popup-blocked.
  const viewer = doc.mimeType === 'text/html' ? window.open('', '_blank') : null;
  let file;
  try {
    file = await getFile(doc.id);
  } catch (err) {
    viewer?.close();
    throw err;
  }
  const bytes = Uint8Array.from(atob(file.data || ''), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: file.mimeType }));
  if (viewer) {
    viewer.opener = null;
    viewer.location.href = url;
  } else {
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
};

/**
 * Insurance policy servicing (Insurance BRD §11–§12, §16.3): status and billing
 * facts, the lifecycle actions the policy's current status allows, generated
 * policy documents, status history and the communication log.
 */
const PolicyServicingPanel = ({ policyId, fields = [], canUpdate }) => {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('history');
  const [pending, setPending] = useState(null); // action key awaiting confirmation
  const [reason, setReason] = useState('');
  const [generating, setGenerating] = useState(null);

  const stateKey = ['policy-state', policyId];
  const { data: state, isLoading, isError } = useQuery({
    queryKey: stateKey,
    queryFn: () => getPolicyState(policyId),
    enabled: !!policyId,
    staleTime: 0,
  });
  const { data: documents = [] } = useQuery({
    queryKey: ['policy-documents', policyId],
    queryFn: () => getPolicyDocuments(policyId),
    enabled: !!policyId,
    staleTime: 0,
  });
  const { data: communications = [] } = useQuery({
    queryKey: ['policy-communications', policyId],
    queryFn: () => getPolicyCommunications(policyId),
    enabled: !!policyId,
    staleTime: 0,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: stateKey });
    queryClient.invalidateQueries({ queryKey: ['policy-communications', policyId] });
    queryClient.invalidateQueries({ queryKey: ['policy-documents', policyId] });
    // Status, dates and reason are fields on the policy record itself.
    queryClient.invalidateQueries({ queryKey: ['record-detail', 'policy', policyId] });
  };

  const act = useMutation({
    mutationFn: ({ action, text }) =>
      action === 'issue' ? issuePolicy(policyId) : applyPolicyAction(policyId, action, text),
    onSuccess: (_d, { action }) => {
      toast.success(`Policy ${DONE[action]}.`);
      setPending(null);
      setReason('');
      refresh();
    },
    onError: (err) => toast.error(errMessage(err, 'The policy could not be updated.')),
  });

  const generate = async (type) => {
    setGenerating(type);
    try {
      await generatePolicyDocument(policyId, type);
      toast.success(`${humanize(type)} generated.`);
      queryClient.invalidateQueries({ queryKey: ['policy-documents', policyId] });
      setTab('documents');
    } catch (err) {
      toast.error(errMessage(err, 'The document could not be generated.'));
    } finally {
      setGenerating(null);
    }
  };

  if (isLoading) return <section className={styles.panel}><p className={styles.muted}>Loading policy…</p></section>;
  if (isError || !state) {
    return (
      <section className={styles.panel}>
        <p className={styles.muted}>Policy servicing details couldn’t be loaded.</p>
      </section>
    );
  }

  const fieldOf = (apiName) => fields.find((f) => f.apiName === apiName);
  const optionLabel = (apiName, value) =>
    fieldOf(apiName)?.picklistValues?.find((o) => o.value === value)?.label || humanize(value);

  const p = state.policy || {};
  const status = p.status || 'application_started';
  const allowed = Object.keys(ACTIONS).filter((a) => state.allowed_actions?.includes(a));
  const history = [...(state.status_history || [])].sort(
    (a, b) => new Date(b.effective_date || 0) - new Date(a.effective_date || 0),
  );
  const pendingAction = pending && pending !== 'issue' ? ACTIONS[pending] : null;
  const money = (v) =>
    v === undefined || v === null || v === '' ? '—' : `R ${Number(v).toLocaleString('en-ZA', { minimumFractionDigits: 2 })}`;

  const facts = [
    { label: 'Premium', value: money(p.current_premium), sub: p.billing_frequency ? optionLabel('billing_frequency', p.billing_frequency) : null },
    { label: 'Paid through', value: fmtDate(p.paid_through_date) },
    { label: 'Next billing', value: fmtDate(p.next_billing_date) },
    {
      label: 'Arrears',
      value: p.arrears_status ? optionLabel('arrears_status', p.arrears_status) : 'None',
      sub: p.grace_period_end_date ? `Grace until ${fmtDate(p.grace_period_end_date)}` : null,
    },
  ];

  const confirm = () => {
    if (pendingAction?.reasonRequired && !reason.trim()) {
      toast.error('Add a reason — it is recorded in the policy history.');
      return;
    }
    act.mutate({ action: pending, text: reason.trim() });
  };

  return (
    <section className={styles.panel} aria-label="Policy servicing">
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <ShieldCheck size={16} className={styles.titleIcon} />
          <span className={styles.title}>Policy servicing</span>
          <span className={`${styles.status} ${styles[`tone_${STATUS_TONE[status] || 'muted'}`]}`}>
            {optionLabel('status', status)}
          </span>
          {p.status_effective_date && (
            <span className={styles.since}>since {fmtDate(p.status_effective_date)}</span>
          )}
        </div>
        {canUpdate && (state.can_issue || allowed.length > 0) && (
          <div className={styles.actions}>
            {state.can_issue && (
              <Button size="sm" icon={<BadgeCheck size={14} />} onClick={() => setPending('issue')}>
                Issue policy
              </Button>
            )}
            {allowed.map((a) => (
              <Button key={a} size="sm" variant={ACTIONS[a].variant} onClick={() => setPending(a)}>
                {ACTIONS[a].label}
              </Button>
            ))}
          </div>
        )}
      </div>

      {p.status_reason && <p className={styles.reason}>Reason: {p.status_reason}</p>}

      <dl className={styles.facts}>
        {facts.map((f) => (
          <div key={f.label} className={styles.fact}>
            <dt>{f.label}</dt>
            <dd>{f.value}</dd>
            {f.sub && <dd className={styles.factSub}>{f.sub}</dd>}
          </div>
        ))}
      </dl>

      <div className={styles.tabs} role="tablist">
        {[
          { key: 'history', label: 'History', icon: History, count: history.length },
          { key: 'documents', label: 'Documents', icon: FileText, count: documents.length },
          { key: 'communications', label: 'Communications', icon: Mail, count: communications.length },
        ].map((t) => {
          const TabIcon = t.icon;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              className={`${styles.tab} ${tab === t.key ? styles.tabActive : ''}`}
              onClick={() => setTab(t.key)}
            >
              <TabIcon size={13} /> {t.label} <span className={styles.count}>{t.count}</span>
            </button>
          );
        })}
      </div>

      {tab === 'history' && (
        history.length === 0 ? (
          <p className={styles.muted}>No status changes recorded yet.</p>
        ) : (
          <ol className={styles.list}>
            {history.map((h) => (
              <li key={h.id} className={styles.row}>
                <div className={styles.rowMain}>
                  <span className={styles.rowTitle}>
                    {h.from_status ? `${optionLabel('status', h.from_status)} → ` : ''}
                    {optionLabel('status', h.to_status)}
                  </span>
                  {h.reason && <span className={styles.rowSub}>{h.reason}</span>}
                </div>
                <time className={styles.rowMeta} title={h.effective_date ? format(new Date(h.effective_date), 'PPpp') : ''}>
                  {fmtDate(h.effective_date)}
                </time>
              </li>
            ))}
          </ol>
        )
      )}

      {tab === 'documents' && (
        <div className={styles.tabBody}>
          {canUpdate && (
            <div className={styles.docActions}>
              <span className={styles.rowSub}>Generate a new version:</span>
              {DOC_TYPES.map((d) => (
                <Button
                  key={d.type}
                  size="xs"
                  variant="secondary"
                  icon={<FileText size={12} />}
                  loading={generating === d.type}
                  disabled={!!generating}
                  onClick={() => generate(d.type)}
                >
                  {d.label}
                </Button>
              ))}
            </div>
          )}
          {documents.length === 0 ? (
            <p className={styles.muted}>No documents yet. They are generated automatically when the policy is issued.</p>
          ) : (
            <ul className={styles.list}>
              {documents.map((d) => {
                const isPdf = d.mimeType === 'application/pdf';
                const kind = DOC_TYPES.find((t) => d.tags?.includes(t.type))?.label || 'Document';
                return (
                  <li key={d.id} className={styles.row}>
                    <div className={styles.rowMain}>
                      <span className={styles.rowTitle}>
                        {kind} <span className={styles.badge}>{isPdf ? 'PDF' : 'HTML'}</span>
                      </span>
                      <span className={styles.rowSub}>
                        {fmtBytes(d.sizeBytes)} · {d.createdAt ? formatDistanceToNow(new Date(d.createdAt), { addSuffix: true }) : ''}
                      </span>
                    </div>
                    <Button
                      size="xs"
                      variant="secondary"
                      icon={isPdf ? <Download size={12} /> : <ExternalLink size={12} />}
                      onClick={() => openFile(d).catch(() => toast.error('The file could not be opened.'))}
                    >
                      {isPdf ? 'Download' : 'View'}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {tab === 'communications' && (
        communications.length === 0 ? (
          <p className={styles.muted}>No communications logged for this policy.</p>
        ) : (
          <ul className={styles.list}>
            {communications.map((c) => (
              <li key={c.id} className={styles.row}>
                <div className={styles.rowMain}>
                  <span className={styles.rowTitle}>
                    {c.channel === 'email' ? <Mail size={12} /> : <MessageSquare size={12} />} {c.subject}
                  </span>
                  <span className={styles.rowSub}>
                    {humanize(c.event)} · {humanize(c.channel)} · {humanize(c.status)}
                  </span>
                </div>
                <time className={styles.rowMeta}>{fmtDate(c.sent_at)}</time>
              </li>
            ))}
          </ul>
        )
      )}

      <Modal
        isOpen={!!pending}
        onClose={() => {
          if (act.isPending) return;
          setPending(null);
          setReason('');
        }}
        title={pending === 'issue' ? 'Issue policy' : `${pendingAction?.label} — ${p.policy_number || 'policy'}`}
        size="sm"
        footer={
          <>
            <Button
              variant="secondary"
              disabled={act.isPending}
              onClick={() => {
                setPending(null);
                setReason('');
              }}
            >
              Back
            </Button>
            <Button
              variant={pendingAction?.variant === 'danger' ? 'danger' : 'primary'}
              loading={act.isPending}
              onClick={confirm}
            >
              {pending === 'issue' ? 'Issue policy' : pendingAction?.label}
            </Button>
          </>
        }
      >
        {pending === 'issue' ? (
          <p className={styles.modalText}>
            The policy becomes active, and the contract and schedule are generated. If the product
            requires sign-off, an approved approval is needed first.
          </p>
        ) : (
          <>
            <p className={styles.modalText}>{pendingAction?.description}</p>
            {pendingAction?.notifies && (
              <p className={styles.modalNote}>A notification to the premium payer is logged under Communications.</p>
            )}
            <label className={styles.reasonLabel} htmlFor="policy-action-reason">
              Reason {pendingAction?.reasonRequired ? '(required)' : '(optional)'}
            </label>
            <textarea
              id="policy-action-reason"
              className={styles.reasonInput}
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Recorded in the policy history"
              autoFocus
            />
          </>
        )}
      </Modal>
    </section>
  );
};

export default PolicyServicingPanel;
