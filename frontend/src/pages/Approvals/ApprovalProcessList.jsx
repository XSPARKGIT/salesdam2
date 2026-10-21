import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { formatDistanceToNow } from 'date-fns';
import { ClipboardCheck, Plus, Pencil, Trash2, Power } from 'lucide-react';
import Layout from '../../layout/Layout';
import Button from '../../components/common/Button/Button';
import { useTenantContext } from '../../context/TenantContext';
import {
  getApprovalProcesses,
  updateApprovalProcess,
  deleteApprovalProcess,
} from '../../services/api/approvals';
import styles from './Approvals.module.css';

/**
 * Setup › Approval Processes — every configured approval process with its
 * object, steps and status (Core BRD §8).
 */
export default function ApprovalProcessList() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { getObject } = useTenantContext();

  const { data: processes = [], isLoading } = useQuery({
    queryKey: ['approval-processes'],
    queryFn: () => getApprovalProcesses(),
    staleTime: 0,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['approval-processes'] });

  const toggle = useMutation({
    mutationFn: (p) => updateApprovalProcess(p._id, { active: !p.active }),
    onSuccess: (p) => {
      toast.success(p.active ? 'Process activated.' : 'Process deactivated.');
      refresh();
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to update process.'),
  });

  const remove = useMutation({
    mutationFn: (p) => deleteApprovalProcess(p._id),
    onSuccess: () => {
      toast.success('Process deleted.');
      refresh();
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to delete process.'),
  });

  const handleDelete = (p) => {
    if (
      window.confirm(
        `Delete “${p.name}”? Requests already pending on it can no longer be decided.`,
      )
    ) {
      remove.mutate(p);
    }
  };

  return (
    <Layout title="Approval Processes" description="Configure approval processes">
      <div className={styles.page}>
        <div className={styles.header}>
          <div>
            <h1 className={styles.title}>Approval Processes</h1>
            <p className={styles.subtitle}>
              Route records to the right people before they move on. Each process sets which
              records need approval, who approves them in what order, and what happens on
              submit, approval and rejection.
            </p>
          </div>
          <Button icon={<Plus size={15} />} onClick={() => navigate('/setup/approval-processes/new')}>
            New process
          </Button>
        </div>

        {isLoading ? (
          <div className={styles.loading}>Loading approval processes…</div>
        ) : processes.length === 0 ? (
          <div className={styles.empty}>
            <ClipboardCheck size={28} />
            <h3>No approval processes yet</h3>
            <p>
              Create one to add a “Submit for approval” button to matching records of any object.
            </p>
            <Button icon={<Plus size={15} />} onClick={() => navigate('/setup/approval-processes/new')}>
              New process
            </Button>
          </div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Object</th>
                  <th>Steps</th>
                  <th>Entry criteria</th>
                  <th>Status</th>
                  <th>Updated</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {processes.map((p) => {
                  const conditions = p.entryCriteria?.conditions?.length || 0;
                  return (
                    <tr key={p._id}>
                      <td>
                        <div className={styles.nameCell}>
                          <Link className={styles.nameLink} to={`/setup/approval-processes/${p._id}`}>
                            {p.name}
                          </Link>
                          {p.description && <span className={styles.muted}>{p.description}</span>}
                        </div>
                      </td>
                      <td>{getObject(p.objectApiName)?.label || p.objectApiName}</td>
                      <td>{p.steps?.length || 0}</td>
                      <td>
                        {conditions === 0
                          ? 'All records'
                          : `${conditions} condition${conditions === 1 ? '' : 's'}`}
                      </td>
                      <td>
                        <span className={`${styles.badge} ${p.active ? styles.badgeActive : ''}`}>
                          {p.active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className={styles.muted}>
                        {p.updatedAt
                          ? formatDistanceToNow(new Date(p.updatedAt), { addSuffix: true })
                          : '—'}
                      </td>
                      <td>
                        <div className={styles.rowActions}>
                          <button
                            type="button"
                            className={styles.iconBtn}
                            onClick={() => toggle.mutate(p)}
                            title={p.active ? 'Deactivate' : 'Activate'}
                            aria-label={p.active ? `Deactivate ${p.name}` : `Activate ${p.name}`}
                            disabled={toggle.isPending}
                          >
                            <Power size={15} />
                          </button>
                          <button
                            type="button"
                            className={styles.iconBtn}
                            onClick={() => navigate(`/setup/approval-processes/${p._id}`)}
                            title="Edit"
                            aria-label={`Edit ${p.name}`}
                          >
                            <Pencil size={15} />
                          </button>
                          <button
                            type="button"
                            className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                            onClick={() => handleDelete(p)}
                            title="Delete"
                            aria-label={`Delete ${p.name}`}
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Layout>
  );
}
