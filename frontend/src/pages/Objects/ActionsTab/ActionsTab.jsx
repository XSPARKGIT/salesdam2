import styles from './ActionsTab.module.css';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, CreditCard as Edit2, Trash2 } from 'lucide-react';
import * as LucideIcons from 'lucide-react';
import Button from '../../../components/common/Button/Button';
import { getActionButtons } from '../../../services/api/actionButtons';
import { deleteActionButton } from '../../../services/api/actionButtons';
import { getAutomations } from '../../../services/api/automations';
import { getFields } from '../../../services/api/objects';
import {
  ACTION_TYPE_LABELS,
  NATIVE_ACTIONS,
  actionTypeOf,
  describeConditions,
} from '../../../utils/recordActions';
import toast from 'react-hot-toast';

const BTN_VARIANT_COLORS = {
  primary: 'var(--color-primary)',
  secondary: 'var(--color-gray-600)',
  ghost: 'var(--color-gray-500)',
  danger: 'var(--color-danger)',
  success: '#16a34a',
};

const LOCATION_LABELS = {
  record_detail: 'Record Detail',
  record_list: 'Record List',
  both: 'Both',
};

const ActionsTab = ({ objectApiName, onAddButton, onEditButton }) => {
  const queryClient = useQueryClient();
  const [isDeleting, setIsDeleting] = useState(false);

  const { data: actionButtons } = useQuery({
    queryKey: ['action-buttons', objectApiName],
    queryFn: () => getActionButtons(objectApiName),
    enabled: !!objectApiName,
  });

  const { data: automations = [] } = useQuery({
    queryKey: ['button-automations-all'],
    queryFn: () => getAutomations({ limit: 500 }),
    enabled: !!objectApiName,
  });
  const { data: fields = [] } = useQuery({
    queryKey: ['fields', objectApiName],
    queryFn: () => getFields(objectApiName),
    enabled: !!objectApiName,
  });

  // "Platform action: Convert deal to order" / "Screen flow: Collect details"
  const runsLabel = (btn) => {
    const type = actionTypeOf(btn);
    const target =
      type === 'native'
        ? NATIVE_ACTIONS[btn.nativeAction]?.label || btn.nativeAction
        : automations.find((a) => String(a._id) === String(btn.automationId))?.name || 'missing flow';
    return `${ACTION_TYPE_LABELS[type]}: ${target}`;
  };
  const shownWhen = (btn) => describeConditions(btn.conditions, fields) || 'Always';

  const handleDelete = async (btn) => {
    if (window.confirm(`Delete button "${btn?.label}"?`)) {
      try {
        setIsDeleting(true);
        await deleteActionButton(objectApiName, btn._id);
        toast.success('Action button deleted successfully.');
        queryClient.invalidateQueries({
          queryKey: ['action-buttons', objectApiName],
        });
      } catch (err) {
        toast.error(
          err.message || 'Failed to delete action button. Please try again.',
        );
      } finally {
        setIsDeleting(false);
      }
    }
  };

  return (
    <div className={styles.fieldsSection}>
      <div className={styles.fieldsHeader}>
        <div>
          <h3 className={styles.fieldsTitle}>Action Buttons</h3>
          <p className={styles.subtitle}>
            Buttons on record pages. Each runs a flow, a screen flow or a
            platform action, and can be shown only when the record matches
            conditions.
          </p>
        </div>
        <div className={styles.headerActions}>
          <Button size="sm" icon={<Plus size={14} />} onClick={onAddButton}>
            New Button
          </Button>
        </div>
      </div>

      {actionButtons?.length === 0 ? (
        <div className={styles.emptyState}>
          No action buttons yet. Click <strong>New Button</strong> to add one.
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr className={styles.tableHead}>
                  {['Label', 'Runs', 'Shown when', 'Location', 'Actions'].map(
                    (h) => (
                      <th key={h} className={styles.th}>
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {actionButtons?.map((btn, i) => {
                  const BtnIcon = LucideIcons[btn?.icon] || LucideIcons.Zap;
                  const variantColor =
                    btn?.color ||
                    BTN_VARIANT_COLORS[btn?.variant] ||
                    'var(--color-gray-600)';
                  return (
                    <tr key={btn._id || btn.id || i} className={styles.tableRow}>
                      <td className={styles.td} style={{ fontWeight: 500 }}>
                        <div className={styles.labelCell}>
                          <span
                            className={styles.iconBadge}
                            style={{
                              background: `${variantColor}20`,
                              color: variantColor,
                            }}
                          >
                            <BtnIcon size={13} />
                          </span>
                          {btn?.label || (
                            <span className={styles.italic}>Untitled</span>
                          )}
                        </div>
                      </td>
                      <td className={`${styles.td} ${styles.muted}`}>
                        {runsLabel(btn)}
                      </td>
                      <td className={`${styles.td} ${styles.muted}`}>
                        {shownWhen(btn)}
                      </td>
                      <td className={`${styles.td} ${styles.muted2}`}>
                        {LOCATION_LABELS[btn?.location] || btn?.location}
                      </td>
                      <td className={styles.td}>
                        <div className={styles.rowActions}>
                          <button
                            title="Edit"
                            onClick={() => onEditButton(i, btn)}
                            className={styles.editBtn}
                          >
                            <Edit2 size={13} />
                          </button>
                          <button
                            title="Delete"
                            onClick={() => handleDelete(btn)}
                            className={styles.deleteBtn}
                            disabled={isDeleting}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className={styles.cardList}>
            {actionButtons?.map((btn, i) => {
              const BtnIcon = LucideIcons[btn?.icon] || LucideIcons.Zap;
              const variantColor =
                btn?.color ||
                BTN_VARIANT_COLORS[btn?.variant] ||
                'var(--color-gray-600)';
              return (
                <div key={btn.id || i} className={styles.card}>
                  <div className={styles.cardHeader}>
                    <div className={styles.labelCell}>
                      <span
                        className={styles.iconBadge}
                        style={{
                          background: `${variantColor}20`,
                          color: variantColor,
                        }}
                      >
                        <BtnIcon size={14} />
                      </span>
                      <span className={styles.cardLabel}>
                        {btn?.label || (
                          <span className={styles.italic}>Untitled</span>
                        )}
                      </span>
                      <span
                        className={styles.variantBadge}
                        style={{
                          background: `${variantColor}18`,
                          color: variantColor,
                        }}
                      >
                        {btn.variant || 'secondary'}
                      </span>
                    </div>
                    <div className={styles.rowActions}>
                      <button
                        title="Edit"
                        onClick={() => onEditButton(i, btn)}
                        className={styles.editBtn}
                      >
                        <Edit2 size={13} />
                      </button>
                      <button
                        title="Delete"
                        onClick={() => handleDelete(btn)}
                        className={styles.deleteBtn}
                        disabled={isDeleting}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                  <div className={styles.cardMeta}>
                    <div className={styles.metaItem}>
                      <span className={styles.metaLabel}>Runs</span>
                      <span className={styles.metaValue}>{runsLabel(btn)}</span>
                    </div>
                    <div className={styles.metaItem}>
                      <span className={styles.metaLabel}>Shown when</span>
                      <span className={styles.metaValue}>{shownWhen(btn)}</span>
                    </div>
                    <div className={styles.metaItem}>
                      <span className={styles.metaLabel}>Location</span>
                      <span className={styles.metaValue}>
                        {LOCATION_LABELS[btn?.location] || btn?.location}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};

export default ActionsTab;
