/**
 * useConfirm — an in-page confirmation dialog for action buttons.
 * `await confirm(message)` resolves true/false (immediately true when there
 * is no message); render `ConfirmDialog` somewhere in the component.
 * Shared by flow buttons (ActionFlowRunner) and platform actions
 * (RecordActionButtons).
 */
import { useState } from 'react';
import { AlertCircle } from 'lucide-react';
import styles from './ActionFlowRunner.module.css';

// ─── Confirm dialog ────────────────────────────────────────────────────────────
function useConfirm() {
  const [pending, setPending] = useState(null);

  const confirm = (message) =>
    new Promise((resolve) => {
      if (!message) {
        resolve(true);
        return;
      }
      setPending({ resolve, message });
    });

  const answer = (yes) => {
    pending?.resolve(yes);
    setPending(null);
  };

  const ConfirmDialog = pending ? (
    <div className={styles.confirmOverlay}>
      <div className={styles.confirmBox}>
        <AlertCircle size={20} className={styles.confirmIcon} />
        <p className={styles.confirmMsg}>{pending.message}</p>
        <div className={styles.confirmActions}>
          <button className={styles.confirmNo} onClick={() => answer(false)}>
            Cancel
          </button>
          <button className={styles.confirmYes} onClick={() => answer(true)}>
            Confirm
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return { confirm, ConfirmDialog };
}

export default useConfirm;
