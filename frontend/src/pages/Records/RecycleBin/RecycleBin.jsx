import styles from './RecycleBin.module.css';
import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2, RotateCcw, ArrowLeft, Clock } from 'lucide-react';
import toast from 'react-hot-toast';
import { listDeletedRecords, restoreRecord } from '../../../services/api/objects';
import { getObject } from '../../../services/api/objects';
import Layout from '../../../layout/Layout';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

const RecycleBin = () => {
  const { objectApiName } = useParams();
  const queryClient = useQueryClient();
  const [restoring, setRestoring] = useState(null);

  const { data: objMeta } = useQuery({
    queryKey: ['object', objectApiName],
    queryFn: () => getObject(objectApiName),
  });

  const { data, isLoading, isError } = useQuery({
    queryKey: ['recycle-bin', objectApiName],
    queryFn: () => listDeletedRecords(objectApiName),
    refetchInterval: 3000,
    refetchOnWindowFocus: true,
  });

  const records = data?.records || [];

  const handleRestore = async (record) => {
    setRestoring(record._id);
    try {
      await restoreRecord(objectApiName, record._id);
      toast.success(`"${getRecordName(record)}" restored.`);
      queryClient.invalidateQueries({ queryKey: ['recycle-bin', objectApiName] });
      queryClient.invalidateQueries({ queryKey: ['records', objectApiName] });
    } catch (err) {
      toast.error(err.message || 'Restore failed.');
    } finally {
      setRestoring(null);
    }
  };

  const getRecordName = (record) => {
    const nameKey = Object.keys(record.data || {}).find((k) =>
      ['name', 'label', 'title', 'subject'].includes(k),
    );
    return nameKey ? record.data[nameKey] : record._id;
  };

  const daysLeft = (deletedAt) => {
    const remaining = THIRTY_DAYS_MS - (Date.now() - new Date(deletedAt).getTime());
    return Math.max(0, Math.ceil(remaining / (24 * 60 * 60 * 1000)));
  };

  const objectLabel = objMeta?.pluralLabel || objectApiName;

  return (
    <Layout>
      <div className={styles.page}>
        <div className={styles.header}>
          <Link to={`/o/${objectApiName}`} className={styles.back}>
            <ArrowLeft size={16} />
            Back to {objectLabel}
          </Link>
          <div className={styles.titleRow}>
            <Trash2 size={20} className={styles.icon} />
            <h1 className={styles.title}>{objectLabel} — Recycle Bin</h1>
          </div>
          <p className={styles.subtitle}>
            Deleted records are kept for 30 days. After that they cannot be restored.
          </p>
        </div>

        {isLoading && <div className={styles.empty}>Loading…</div>}
        {isError && <div className={styles.empty}>Failed to load recycle bin.</div>}

        {!isLoading && !isError && records.length === 0 && (
          <div className={styles.empty}>
            <Trash2 size={36} className={styles.emptyIcon} />
            <p>No deleted records in the last 30 days.</p>
          </div>
        )}

        {!isLoading && records.length > 0 && (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Record</th>
                <th>Deleted</th>
                <th>Expires in</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => {
                const days = daysLeft(record.deletedAt);
                const expired = days === 0;
                return (
                  <tr key={record._id} className={expired ? styles.expired : ''}>
                    <td className={styles.nameCell}>
                      <span className={styles.recordName}>{getRecordName(record)}</span>
                      <span className={styles.recordId}>{record._id}</span>
                    </td>
                    <td className={styles.dateCell}>
                      {new Date(record.deletedAt).toLocaleDateString(undefined, {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </td>
                    <td className={styles.expiryCell}>
                      {expired ? (
                        <span className={styles.expiredBadge}>Expired</span>
                      ) : (
                        <span className={days <= 3 ? styles.urgentBadge : styles.daysBadge}>
                          <Clock size={11} />
                          {days}d
                        </span>
                      )}
                    </td>
                    <td className={styles.actionCell}>
                      <button
                        className={styles.restoreBtn}
                        disabled={expired || restoring === record._id}
                        onClick={() => handleRestore(record)}
                        title={expired ? 'Cannot restore — older than 30 days' : 'Restore record'}
                      >
                        <RotateCcw size={14} />
                        {restoring === record._id ? 'Restoring…' : 'Restore'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </Layout>
  );
};

export default RecycleBin;
