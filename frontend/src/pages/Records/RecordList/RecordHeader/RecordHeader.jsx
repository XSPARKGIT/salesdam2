import styles from './RecordHeader.module.css';
import { useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import * as LucideIcons from 'lucide-react';
import { Plus, Trash2, RefreshCw, Calendar, LayoutGrid, GitMerge, Download, Upload } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../../../services/api';
import Button from '../../../../components/common/Button/Button';
import ActionFlowRunner from '../../../../components/records/ActionFlowRunner';
import RecurringTaskModal from '../../../../components/tasks/RecurringTaskModal';
import DeleteConfirmationModal from '../../../../components/records/DeleteConfirmationModal/DeleteConfirmationModal';
import ImportResultsModal from './ImportResultsModal';
import { MAX_MERGE_RECORDS } from '../../RecordMerge/mergeConstants';

const RecordHeader = ({
  objectApiName,
  objMeta,
  pagination,
  activeView,
  selected,
  setSelected,
  allFields,
  perms,
  refetch,
}) => {
  const navigate = useNavigate();
  const [deleting, setDeleting] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [recurringModalOpen, setRecurringModalOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResults, setImportResults] = useState(null);
  const importInputRef = useRef(null);

  const objectLabel = objMeta?.pluralLabel || objectApiName;
  const objectColor = objMeta?.color || 'var(--color-primary)';
  const Icon = LucideIcons[objMeta?.icon] || LucideIcons.Box;

  const handleBulkDelete = () => {
    if (!perms.canDelete) {
      toast.error('You do not have permission to delete records.');
      return;
    }

    setDeleteModalOpen(true);
  };

  const confirmBulkDelete = async () => {
    setDeleting(true);
    try {
      const response = await api.post(`/records/${objectApiName}/bulk-delete`, {
        ids: selected,
      });

      const { deleted, failed } = response.data?.data || {};

      if (deleted > 0) {
        toast.success(
          failed > 0
            ? `${deleted} deleted, ${failed} failed.`
            : `${deleted} record(s) deleted successfully.`
        );
      }

      if (failed > 0) {
        toast.error(`Failed to delete ${failed} record(s).`);
      }

      setSelected([]);
      setDeleteModalOpen(false);
      refetch();
    } catch (err) {
      console.error('Bulk delete error:', err);
      const errorMsg = err.response?.data?.message || err.message || 'Bulk delete failed.';
      toast.error(errorMsg);
    } finally {
      setDeleting(false);
    }
  };


  const handleExport = async () => {
    try {
      const res = await api.get(`/records/${objectApiName}/export`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'text/csv' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${objectApiName}_export.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Export failed.');
    }
  };

  const handleImportFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setImporting(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await api.post(`/records/${objectApiName}/import`, form, {
        headers: { 'Content-Type': undefined },
      });
      const data = res.data?.data || res.data;
      setImportResults(data);
      refetch();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Import failed.');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className={styles.header}>
      <div className={styles.titleRow}>
        <div
          className={styles.objectIcon}
          style={{ background: `${objectColor}20`, color: objectColor }}
        >
          <Icon size={20} />
        </div>
        <div>
          <h1 className={styles.title}>{objectLabel}</h1>
          <p className={styles.count}>
            {pagination.total?.toLocaleString() || 0} records
            {activeView && activeView.key !== 'all' && (
              <span className={styles.viewBadge}> · {activeView.name}</span>
            )}
          </p>
        </div>
      </div>

      <div className={styles.actions}>
        {(objMeta?.actionButtons || [])
          .filter(
            (btn) =>
              btn.automationId &&
              (btn.location === 'record_list' || btn.location === 'both'),
          )
          .sort((a, b) => (a.order || 0) - (b.order || 0))
          .map((btn) => (
            <ActionFlowRunner
              key={btn.id || btn.label}
              button={btn}
              record={null}
              selectedRecords={selected}
              objectApiName={objectApiName}
              fields={allFields}
              onDone={() => {
                setSelected([]);
                refetch();
              }}
            />
          ))}

        {selected.length > 0 && (
          <span className={styles.selectionBadge}>
            {selected.length} selected
          </span>
        )}

        {perms.canDelete && perms.canUpdate && (
          <Button
            variant="secondary"
            size="sm"
            icon={<GitMerge size={14} />}
            disabled={selected.length < 2 || selected.length > MAX_MERGE_RECORDS}
            onClick={() => navigate(`/o/${objectApiName}/merge?ids=${selected.join(',')}`)}
            title={
              selected.length < 2
                ? `Select 2–${MAX_MERGE_RECORDS} records to merge`
                : selected.length > MAX_MERGE_RECORDS
                  ? `You can merge up to ${MAX_MERGE_RECORDS} records at a time`
                  : `Merge ${selected.length} records`
            }
          >
            Merge
          </Button>
        )}

        {perms.canDelete && (
          <Button
            variant="danger"
            size="sm"
            icon={<Trash2 size={14} />}
            loading={deleting}
            disabled={selected.length === 0}
            onClick={handleBulkDelete}
            title={selected.length === 0 ? 'Select records to delete' : `Delete ${selected.length} record(s)`}
          >
            Delete {selected.length > 0 ? `(${selected.length})` : ''}
          </Button>
        )}

        <Button
          variant="secondary"
          size="sm"
          icon={<Download size={14} />}
          onClick={handleExport}
          title="Export all records as CSV"
        >
          Export
        </Button>

        {perms.canCreate && (
          <>
            <input
              ref={importInputRef}
              type="file"
              accept=".csv"
              style={{ display: 'none' }}
              onChange={handleImportFile}
            />
            <Button
              variant="secondary"
              size="sm"
              icon={<Upload size={14} />}
              loading={importing}
              onClick={() => importInputRef.current?.click()}
              title="Import records from CSV"
            >
              Import
            </Button>
          </>
        )}

        <Button
          variant="secondary"
          size="sm"
          icon={<RefreshCw size={14} />}
          onClick={refetch}
        >
          Refresh
        </Button>

        {perms.canCreate && objectApiName === 'task' && (
          <Button
            size="sm"
            icon={<Calendar size={14} />}
            onClick={() => setRecurringModalOpen(true)}
          >
            Recurring Task
          </Button>
        )}

        {objectApiName === 'task' && (
          <Button
            size="sm"
            variant="secondary"
            icon={<LayoutGrid size={14} />}
            onClick={() => navigate('/o/task/calendar')}
          >
            Calendar
          </Button>
        )}

        <Link to={`/o/${objectApiName}/deleted`}>
          <Button size="sm" variant="secondary" icon={<Trash2 size={14} />}>
            Recycle Bin
          </Button>
        </Link>

        {perms.canCreate && !['quote', 'invoice'].includes(objectApiName) && (
          <Link
            to={
              objectApiName === 'policy'
                ? '/insurance/new-business' // the application flow, not a bare record
                : `/o/${objectApiName}/new`
            }
          >
            <Button size="sm" icon={<Plus size={14} />}>
              New {objMeta?.label || objectApiName}
            </Button>
          </Link>
        )}
      </div>

      <DeleteConfirmationModal
        isOpen={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        onConfirm={confirmBulkDelete}
        isDeleting={deleting}
        recordCount={selected.length}
      />

      {objectApiName === 'task' && (
        <RecurringTaskModal
          isOpen={recurringModalOpen}
          onClose={() => setRecurringModalOpen(false)}
          onCreated={() => {
            refetch();
            setRecurringModalOpen(false);
          }}
        />
      )}

      {importResults && (
        <ImportResultsModal
          results={importResults}
          onClose={() => setImportResults(null)}
        />
      )}
    </div>
  );
};

export default RecordHeader;
