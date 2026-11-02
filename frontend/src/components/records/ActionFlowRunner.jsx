/**
 * ActionFlowRunner
 *
 * Triggers an action-flow / screen-flow automation from a button click.
 * Opens a popup modal with FlowWizard for multi-step screen navigation.
 *
 * Props:
 *   button          — ObjectMeta actionButton config
 *   record          — current record data or null
 *   selectedRecords — array of selected record IDs (list view)
 *   objectApiName   — which object
 *   fields          — FieldMeta array
 *   onDone          — called on completion (optional)
 *   onClose         — called when popup is dismissed (optional)
 */
import React, { useState } from 'react';
import toast from 'react-hot-toast';
import * as LucideIcons from 'lucide-react';
import { Loader } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import FlowWizard from './FlowWizard';
import useConfirm from './useConfirm';
import styles from './ActionFlowRunner.module.css';

function buildNavPath(nav) {
  if (!nav?.objectApiName) return null;
  if (nav.targetType === 'record_detail' && nav.recordId) {
    return `/o/${nav.objectApiName}/${nav.recordId}`;
  }
  return `/o/${nav.objectApiName}`;
}

// ─── Popup modal ───────────────────────────────────────────────────────────────
function PopupModal({
  title,
  automationId,
  record,
  fields,
  objectApiName,
  onDone,
  onClose,
}) {
  return (
    <div
      className={styles.popupOverlay}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.popup}>
        <div className={styles.popupHeader}>
          <span className={styles.popupTitle}>{title}</span>
          <button className={styles.popupClose} onClick={onClose}>
            ✕
          </button>
        </div>
        <div className={styles.popupBody}>
          <FlowWizard
            automationId={automationId}
            record={record}
            fields={fields}
            objectApiName={objectApiName}
            onDone={(data) => {
              onDone?.(data);
              onClose();
            }}
            onClose={onClose}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Main ActionFlowRunner ────────────────────────────────────────────────────
export default function ActionFlowRunner({
  button,
  record,
  selectedRecords = [],
  objectApiName,
  fields = [],
  onDone,
  onClose,
}) {
  const [running, setRunning] = useState(false);
  const [popup, setPopup] = useState(false);
  const { confirm, ConfirmDialog } = useConfirm();
  const navigate = useNavigate();

  const run = async () => {
    if (button.confirmMessage) {
      const yes = await confirm(button.confirmMessage);
      if (!yes) return;
    }

    // Bulk action (no screen flow) — run straight through
    if (selectedRecords.length > 0) {
      setRunning(true);
      try {
        const res = await api.post(
          `/automations/${button.automationId}/run-action`,
          {
            recordId: record?._id || record?.id || null,
            objectApiName,
            selectedRecordIds: selectedRecords,
            contextData: record || {},
          },
        );
        const data = res.data.data;
        (data.toasts || []).forEach((t) =>
          (toast[t.type] || toast.success)(t.message),
        );
        (data.errors || []).forEach((e) => toast.error(e));
        if (data.updatedCount)
          toast.success(
            `${data.updatedCount} record${data.updatedCount > 1 ? 's' : ''} updated.`,
          );
        if (data.createdCount)
          toast.success(
            `${data.createdCount} record${data.createdCount > 1 ? 's' : ''} created.`,
          );
        onDone?.(data);
        if (data.status === 'navigate') {
          const path = buildNavPath(data.navigate);
          if (path) navigate(path);
        }
      } catch (err) {
        toast.error(
          err.response?.data?.message || err.message || 'Action failed.',
        );
      } finally {
        setRunning(false);
      }
      return;
    }

    // Single record — open wizard modal
    setPopup(true);
  };

  const hasCustomColor =
    typeof button.color === 'string' && button.color.trim().length > 0;

  return (
    <>
      <button
        className={[
          styles.actionBtn,
          !hasCustomColor && styles[`v-${button.variant || 'secondary'}`],
        ]
          .filter(Boolean)
          .join(' ')}
        style={
          hasCustomColor
            ? {
                background: button.color,
                borderColor: button.color,
                color: '#fff',
              }
            : undefined
        }
        onClick={run}
        disabled={running}
        title={button.label}
      >
        {running ? (
          <Loader size={13} className={styles.spin} />
        ) : (
          <span className={styles.btnIcon}>
            <BtnIcon name={button.icon} />
          </span>
        )}
        <span>{button.label}</span>
      </button>

      {ConfirmDialog}

      {popup && (
        <PopupModal
          title={button.label}
          automationId={button.automationId}
          record={record}
          fields={fields}
          objectApiName={objectApiName}
          onDone={(data) => {
            onDone?.(data);
          }}
          onClose={() => {
            setPopup(false);
            onClose?.();
          }}
        />
      )}
    </>
  );
}

function BtnIcon({ name }) {
  const Icon = LucideIcons[name] || LucideIcons.Zap;
  return <Icon size={13} />;
}
