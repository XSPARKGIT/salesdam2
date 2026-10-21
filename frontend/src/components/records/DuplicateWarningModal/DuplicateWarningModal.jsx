import { AlertTriangle, ExternalLink, Ban, GitMerge } from 'lucide-react';
import Modal from '../../common/Modal/Modal';
import Button from '../../common/Button/Button';
import styles from './DuplicateWarningModal.module.css';

/**
 * Shows the records a save would duplicate (Core BRD §3.4).
 *
 * `action` comes from the tenant's duplicate rules: 'warn' lets the user save
 * anyway, 'block' only lets them go back and change the form.
 */
const DuplicateWarningModal = ({
  isOpen,
  action,
  matches = [],
  fields = [],
  objectApiName,
  objectLabel,
  saving,
  onSaveAnyway,
  onMerge,
  onClose,
}) => {
  const blocked = action === 'block';
  // Offered when editing an existing record: merge it with the matches instead.
  const mergeButton = onMerge ? (
    <Button variant="secondary" icon={<GitMerge size={14} />} onClick={onMerge} disabled={saving}>
      Merge instead
    </Button>
  ) : null;
  const labelOf = (apiName) =>
    fields.find((f) => f.apiName === apiName)?.label || apiName;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={blocked ? 'Duplicate record found' : 'Possible duplicate'}
      size="md"
      footer={
        blocked ? (
          <>
            {mergeButton}
            <Button variant="secondary" onClick={onClose}>
              Back to form
            </Button>
          </>
        ) : (
          <>
            {mergeButton}
            <Button variant="secondary" onClick={onClose} disabled={saving}>
              Back to form
            </Button>
            <Button variant="primary" onClick={onSaveAnyway} loading={saving}>
              Save anyway
            </Button>
          </>
        )
      }
    >
      <div className={`${styles.banner} ${blocked ? styles.bannerBlock : ''}`}>
        {blocked ? <Ban size={16} /> : <AlertTriangle size={16} />}
        <span>
          {blocked
            ? `This ${objectLabel || 'record'} matches an existing one, and your duplicate rules don't allow saving it.`
            : `This ${objectLabel || 'record'} looks like ${matches.length === 1 ? 'an existing record' : `${matches.length} existing records`}. Check before saving.`}
        </span>
      </div>

      <ul className={styles.list}>
        {matches.map((m) => (
          <li key={m.recordId} className={styles.item}>
            <div className={styles.itemMain}>
              <span className={styles.name}>{m.name || 'Untitled record'}</span>
              {m.matchedFields?.length > 0 && (
                <span className={styles.matched}>
                  Matches on {m.matchedFields.map(labelOf).join(', ')}
                </span>
              )}
            </div>
            <a
              className={styles.open}
              href={`/o/${objectApiName}/${m.recordId}`}
              target="_blank"
              rel="noreferrer"
            >
              Open <ExternalLink size={12} />
            </a>
          </li>
        ))}
      </ul>
    </Modal>
  );
};

export default DuplicateWarningModal;
