import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, FileBarChart, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import Layout from '../../layout/Layout';
import Button from '../../components/common/Button/Button';
import Modal from '../../components/common/Modal/Modal';
import { getReports, deleteReport } from '../../services/api/reports';
import { useState } from 'react';
import styles from './Reports.module.css';

const CHART_LABELS = {
  table: 'Table', bar: 'Bar Chart', line: 'Line Chart',
  pie: 'Pie Chart', metric: 'Metric', donut: 'Donut',
};

export default function ReportList() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [pendingDelete, setPendingDelete] = useState(null);

  const { data: reports = [], isLoading } = useQuery({
    queryKey: ['reports'],
    queryFn: getReports,
  });

  const deleteMut = useMutation({
    mutationFn: (id) => deleteReport(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      toast.success('Report deleted');
      setPendingDelete(null);
    },
    onError: (err) => toast.error(err.message || 'Delete failed'),
  });

  return (
    <Layout>
      <div className={styles.page}>
        <div className={styles.header}>
          <div>
            <h1 className={styles.title}>Reports</h1>
            <p className={styles.subtitle}>
              Build and save reports on any object
            </p>
          </div>
          <Button onClick={() => navigate('/reports/new')}>
            <Plus size={16} /> New Report
          </Button>
        </div>

        {isLoading ? (
          <div className={styles.loading}><div className={styles.spinner} /></div>
        ) : reports.length === 0 ? (
          <div className={styles.empty}>
            <FileBarChart size={40} />
            <p>No reports yet. Create your first report to get started.</p>
          </div>
        ) : (
          <div className={styles.grid}>
            {reports.map((r) => (
              <div
                key={r._id}
                className={styles.card}
                onClick={() => navigate(`/reports/${r._id}`)}
              >
                <div className={styles.cardName}>{r.name}</div>
                {r.description && (
                  <div className={styles.cardDesc}>{r.description}</div>
                )}
                <div className={styles.cardMeta}>
                  <span className={styles.badge}>
                    {r.objectApiName}
                  </span>
                  <span className={styles.badge}>
                    {CHART_LABELS[r.chartType] || r.chartType}
                  </span>
                  {r.createdBy && (
                    <span>{r.createdBy.firstName} {r.createdBy.lastName}</span>
                  )}
                  <button
                    className={styles.removeBtn}
                    onClick={(e) => { e.stopPropagation(); setPendingDelete(r); }}
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <Modal
          isOpen={!!pendingDelete}
          onClose={() => setPendingDelete(null)}
          title="Delete report"
          size="sm"
          footer={
            <>
              <Button variant="secondary" size="sm" onClick={() => setPendingDelete(null)}>
                Cancel
              </Button>
              <Button
                variant="danger" size="sm"
                loading={deleteMut.isPending}
                onClick={() => deleteMut.mutate(pendingDelete._id)}
              >
                Delete
              </Button>
            </>
          }
        >
          <div className={styles.deleteModal}>
            <p>Delete <strong>{pendingDelete?.name}</strong>? This cannot be undone.</p>
          </div>
        </Modal>
      </div>
    </Layout>
  );
}
