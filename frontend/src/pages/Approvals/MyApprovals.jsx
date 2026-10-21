import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { format, formatDistanceToNow } from 'date-fns';
import { Inbox, ArrowRight } from 'lucide-react';
import Layout from '../../layout/Layout';
import { getMyPendingApprovals } from '../../services/api/approvals';
import styles from './Approvals.module.css';

/**
 * Approvals waiting on the current user — named approver or a member of the
 * step's role queue. Each item opens the record, where the decision is made.
 */
export default function MyApprovals() {
  const { data: items = [], isLoading } = useQuery({
    queryKey: ['my-pending-approvals'],
    queryFn: getMyPendingApprovals,
    staleTime: 0,
  });

  return (
    <Layout title="My Approvals" description="Records awaiting your approval">
      <div className={styles.page}>
        <div className={styles.header}>
          <div>
            <h1 className={styles.title}>My Approvals</h1>
            <p className={styles.subtitle}>
              Records waiting on your decision. Open one to approve or reject it.
            </p>
          </div>
        </div>

        {isLoading ? (
          <div className={styles.loading}>Loading…</div>
        ) : items.length === 0 ? (
          <div className={styles.empty}>
            <Inbox size={28} />
            <h3>You're all caught up</h3>
            <p>Nothing is waiting for your approval right now.</p>
          </div>
        ) : (
          <div className={styles.inbox}>
            {items.map((r) => (
              <Link key={r._id} to={`/o/${r.objectApiName}/${r.recordId}`} className={styles.inboxItem}>
                <div className={styles.inboxMain}>
                  <span className={styles.inboxTitle}>
                    {r.recordName || 'Untitled record'}
                  </span>
                  <div className={styles.inboxMeta}>
                    <span className={styles.badge}>{r.objectLabel}</span>
                    <span>{r.processName}</span>
                    <span>
                      Step {r.currentStep + 1} of {r.steps?.length || 1}
                      {r.currentStepName ? ` · ${r.currentStepName}` : ''}
                    </span>
                    {r.submittedByName && <span>From {r.submittedByName}</span>}
                    <time title={format(new Date(r.submittedAt), 'PPpp')}>
                      {formatDistanceToNow(new Date(r.submittedAt), { addSuffix: true })}
                    </time>
                  </div>
                </div>
                <span className={styles.inboxOpen}>
                  Review <ArrowRight size={14} />
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
