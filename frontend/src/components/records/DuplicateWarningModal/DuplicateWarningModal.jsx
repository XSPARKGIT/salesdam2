import { AlertTriangle, ExternalLink, Ban, GitMerge, ArrowRight } from 'lucide-react';
import Modal from '../../common/Modal/Modal';
import Button from '../../common/Button/Button';
import styles from './DuplicateWarningModal.module.css';

/**
 * Shows the records a save would duplicate (Core BRD §3.4).
 *
 * action:
 *   'warn'           — user may save anyway or go back
 *   'block'          — user may only go back (or merge if editing)
 *   'present_matches'— user must pick one of the existing records; no new record is created
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
  onSelectMatch,
  onClose,
}) => {
  const blocked = action === 'block';
  const pickMode = action === 'present_matches';

  const mergeButton = onMerge ? (
    <Button variant="secondary" icon={<GitMerge size={14} />} onClick={onMerge} disabled={saving}>
      Merge instead
    </Button>
  ) : null;

  const labelOf = (apiName) =>
    fields.find((f) => f.apiName === apiName)?.label || apiName;

  const title = pickMode
    ? 'Select an existing record'
    : blocked
    ? 'Duplicate record found'
    : 'Possible duplicate';

  const bannerText = pickMode
    ? `${matches.length === 1 ? 'A matching' : `${matches.length} matching`} ${objectLabel || 'record'}${matches.length === 1 ? ' was' : 's were'} found. Select one to use it instead of creating a duplicate.`
    : blocked
    ? `This ${objectLabel || 'record'} matches an existing one, and your duplicate rules don't allow saving it.`
    : `This ${objectLabel || 'record'} looks like ${matches.length === 1 ? 'an existing record' : `${matches.length} existing records`}. Check before saving.`;

  const footer = pickMode ? (
    <Button variant="secondary" onClick={onClose}>
      Back to form
    </Button>
  ) : blocked ? (
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
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="md" footer={footer}>
      <div className={`${styles.banner} ${blocked ? styles.bannerBlock : ''} ${pickMode ? styles.bannerPick : ''}`}>
        {blocked ? <Ban size={16} /> : <AlertTriangle size={16} />}
        <span>{bannerText}</span>
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
            <div className={styles.itemActions}>
              {pickMode ? (
                <button
                  className={styles.selectBtn}
                  onClick={() => onSelectMatch?.(m.recordId)}
                >
                  Use this record <ArrowRight size={12} />
                </button>
              ) : (
                <a
                  className={styles.open}
                  href={`/o/${objectApiName}/${m.recordId}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open <ExternalLink size={12} />
                </a>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Modal>
  );
};

export default DuplicateWarningModal;
