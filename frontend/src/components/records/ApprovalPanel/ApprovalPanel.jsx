import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { format, formatDistanceToNow } from 'date-fns';
import {
  ClipboardCheck,
  Check,
  X,
  Undo2,
  Send,
  Lock,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import Button from '../../common/Button/Button';
import Modal from '../../common/Modal/Modal';
import {
  getApprovalState,
  submitForApproval,
  approveRequest,
  rejectRequest,
  recallRequest,
} from '../../../services/api/approvals';
import styles from './ApprovalPanel.module.css';

const STATUS_LABEL = {
  pending: 'Pending approval',
  approved: 'Approved',
  rejected: 'Rejected',
  recalled: 'Recalled',
};

const HISTORY_LABEL = {
  submitted: 'Submitted',
  approved_step: 'Approved step',
  approved: 'Approved',
  rejected: 'Rejected',
  recalled: 'Recalled',
};

const personName = (p) =>
  p && typeof p === 'object' ? [p.firstName, p.lastName].filter(Boolean).join(' ') : '';

const approverLabel = (step) => {
  if (step.approverUserId) return personName(step.approverUserId) || 'Named approver';
  if (step.approverRoleId) {
    const role = step.approverRoleId;
    return `Anyone with the ${role.label || role.name || 'assigned'} role`;
  }
  if (step.status === 'waiting') return 'Assigned when this step starts';
  return '—';
};

const errMessage = (err, fallback) => err?.response?.data?.message || fallback;

/**
 * Approval status and actions for any record (Core BRD §8): submit to a
 * matching approval process, approve/reject the current step, recall, and
 * review the decision history. Renders nothing when no process applies.
 */
const ApprovalPanel = ({ objectApiName, recordId }) => {
  const queryClient = useQueryClient();
  const [decision, setDecision] = useState(null); // 'approve' | 'reject'
  const [comment, setComment] = useState('');
  const [processId, setProcessId] = useState('');
  const [showHistory, setShowHistory] = useState(false);

  const stateKey = ['approval-state', objectApiName, recordId];
  const { data: state } = useQuery({
    queryKey: stateKey,
    queryFn: () => getApprovalState(objectApiName, recordId),
    enabled: !!objectApiName && !!recordId,
    // Another user may decide at any time; don't reuse the 5-minute cache.
    staleTime: 0,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: stateKey });
    // Approval actions can write field updates onto the record.
    queryClient.invalidateQueries({ queryKey: ['record-detail', objectApiName, recordId] });
    queryClient.invalidateQueries({ queryKey: ['my-pending-approvals'] });
  };

  const submit = useMutation({
    mutationFn: () =>
      submitForApproval(
        objectApiName,
        recordId,
        processId || state?.eligibleProcesses?.[0]?._id,
      ),
    onSuccess: () => {
      toast.success('Submitted for approval.');
      refresh();
    },
    onError: (err) => toast.error(errMessage(err, 'Failed to submit for approval.')),
  });

  const decide = useMutation({
    mutationFn: ({ kind, text }) =>
      kind === 'approve'
        ? approveRequest(state.request._id, text)
        : rejectRequest(state.request._id, text),
    onSuccess: (_data, { kind }) => {
      toast.success(kind === 'approve' ? 'Approval recorded.' : 'Rejection recorded.');
      setDecision(null);
      setComment('');
      refresh();
    },
    onError: (err) => toast.error(errMessage(err, 'Failed to record the decision.')),
  });

  const recall = useMutation({
    mutationFn: () => recallRequest(state.request._id),
    onSuccess: () => {
      toast.success('Approval request recalled.');
      refresh();
    },
    onError: (err) => toast.error(errMessage(err, 'Failed to recall the request.')),
  });

  if (!state) return null;
  const { request, canDecide, canRecall, canSubmit, eligibleProcesses = [] } = state;
  if (!request && !canSubmit) return null;

  const isPending = request?.status === 'pending';
  const steps = request?.steps || [];
  const history = [...(request?.history || [])].reverse();

  const confirmDecision = () => {
    if (decision === 'reject' && !comment.trim()) {
      toast.error('Add a reason for the rejection.');
      return;
    }
    decide.mutate({ kind: decision, text: comment.trim() });
  };

  return (
    <section className={styles.panel} aria-label="Approval">
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <ClipboardCheck size={16} className={styles.titleIcon} />
          <span className={styles.title}>
            {request ? request.processName || 'Approval' : 'Approval'}
          </span>
          {request && (
            <span className={`${styles.status} ${styles[`status_${request.status}`]}`}>
              {STATUS_LABEL[request.status] || request.status}
            </span>
          )}
          {isPending && request.locked && (
            <span className={styles.locked} title="Edits are blocked until a decision is made">
              <Lock size={12} /> Locked
            </span>
          )}
        </div>

        <div className={styles.actions}>
          {canDecide && (
            <>
              <Button size="sm" variant="secondary" icon={<X size={14} />} onClick={() => setDecision('reject')}>
                Reject
              </Button>
              <Button size="sm" icon={<Check size={14} />} onClick={() => setDecision('approve')}>
                Approve
              </Button>
            </>
          )}
          {canRecall && (
            <Button
              size="sm"
              variant="secondary"
              icon={<Undo2 size={14} />}
              loading={recall.isPending}
              onClick={() => {
                if (window.confirm('Recall this approval request? Any changes made on submit will be undone.')) {
                  recall.mutate();
                }
              }}
            >
              Recall
            </Button>
          )}
          {!isPending && canSubmit && (
            <>
              {eligibleProcesses.length > 1 && (
                <select
                  className={styles.select}
                  value={processId || eligibleProcesses[0]._id}
                  onChange={(e) => setProcessId(e.target.value)}
                  aria-label="Approval process"
                >
                  {eligibleProcesses.map((p) => (
                    <option key={p._id} value={p._id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              )}
              <Button size="sm" icon={<Send size={14} />} loading={submit.isPending} onClick={() => submit.mutate()}>
                {request ? 'Submit again' : 'Submit for approval'}
              </Button>
            </>
          )}
        </div>
      </div>

      {!request && (
        <p className={styles.hint}>
          {eligibleProcesses.length === 1
            ? `This record can be submitted to “${eligibleProcesses[0].name}”.`
            : `This record matches ${eligibleProcesses.length} approval processes.`}
        </p>
      )}

      {request && (
        <>
          <ol className={styles.steps}>
            {steps.map((step, i) => (
              <li
                key={`${step.order}-${i}`}
                className={`${styles.step} ${styles[`step_${step.status}`] || ''} ${
                  isPending && i === request.currentStep ? styles.stepCurrent : ''
                }`}
              >
                <span className={styles.stepMarker}>
                  {step.status === 'approved' ? <Check size={12} /> : step.status === 'rejected' ? <X size={12} /> : i + 1}
                </span>
                <div className={styles.stepBody}>
                  <span className={styles.stepName}>{step.name || `Step ${i + 1}`}</span>
                  <span className={styles.stepMeta}>
                    {step.decidedBy
                      ? `${step.status === 'rejected' ? 'Rejected' : 'Approved'} by ${personName(step.decidedBy)}`
                      : approverLabel(step)}
                  </span>
                  {step.comment && <span className={styles.stepComment}>“{step.comment}”</span>}
                </div>
              </li>
            ))}
          </ol>

          <div className={styles.footer}>
            <span>
              Submitted by {personName(request.submittedBy) || 'unknown'}{' '}
              <time title={format(new Date(request.submittedAt), 'PPpp')}>
                {formatDistanceToNow(new Date(request.submittedAt), { addSuffix: true })}
              </time>
            </span>
            {history.length > 0 && (
              <button type="button" className={styles.historyToggle} onClick={() => setShowHistory((v) => !v)}>
                {showHistory ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                History ({history.length})
              </button>
            )}
          </div>

          {showHistory && (
            <ul className={styles.history}>
              {history.map((h, i) => (
                <li key={i}>
                  <span className={styles.historyAction}>{HISTORY_LABEL[h.action] || h.action}</span>
                  {h.by && <span> by {personName(h.by)}</span>}
                  <time className={styles.historyTime} title={format(new Date(h.at), 'PPpp')}>
                    {formatDistanceToNow(new Date(h.at), { addSuffix: true })}
                  </time>
                  {h.comment && <span className={styles.historyComment}>“{h.comment}”</span>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <Modal
        isOpen={!!decision}
        onClose={() => {
          setDecision(null);
          setComment('');
        }}
        title={decision === 'approve' ? 'Approve request' : 'Reject request'}
        size="sm"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setDecision(null);
                setComment('');
              }}
              disabled={decide.isPending}
            >
              Cancel
            </Button>
            <Button
              variant={decision === 'reject' ? 'danger' : 'primary'}
              loading={decide.isPending}
              onClick={confirmDecision}
            >
              {decision === 'approve' ? 'Approve' : 'Reject'}
            </Button>
          </>
        }
      >
        <label className={styles.commentLabel} htmlFor="approval-comment">
          {decision === 'reject' ? 'Reason (required)' : 'Comment (optional)'}
        </label>
        <textarea
          id="approval-comment"
          className={styles.comment}
          rows={3}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder={decision === 'reject' ? 'Why is this being rejected?' : 'Add a note for the submitter'}
          autoFocus
        />
      </Modal>
    </section>
  );
};

export default ApprovalPanel;
