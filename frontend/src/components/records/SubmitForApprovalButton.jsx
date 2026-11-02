import { useState } from 'react';
import { Send } from 'lucide-react';
import Button from '../common/Button/Button';
import Modal from '../common/Modal/Modal';
import toast from 'react-hot-toast';
import api from '../../services/api';
import styles from './ApprovalActions.module.css';

const SubmitForApprovalButton = ({
  leadId,
  approvalStatus,
  onSuccess,
  // Configured button appearance (BRD 4.4 action buttons)
  label = 'Submit for Approval',
  variant = 'primary',
  icon = <Send size={14} />,
}) => {
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);

  const canSubmit = approvalStatus !== 'Submitted for Approval' && approvalStatus !== 'Approved';

  const handleSubmit = async () => {
    setLoading(true);
    try {
      await api.post(`/leads/${leadId}/submit-for-approval`);
      toast.success('Lead submitted for approval');
      onSuccess?.();
      setShowModal(false);
    } catch (error) {
      const message = error.response?.data?.message || error.message || 'Failed to submit lead for approval';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  if (!canSubmit) return null;

  return (
    <>
      <Button
        variant={variant}
        size="sm"
        icon={icon}
        onClick={() => setShowModal(true)}
      >
        {label}
      </Button>

      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title="Submit for Approval"
        size="md"
      >
        <div className={styles.modalContent}>
          <p>Are you sure you want to submit this lead for your manager's approval?</p>
          <p className={styles.note}>
            Your manager will receive an email with the lead details and can approve or reject it.
          </p>
          <div className={styles.modalActions}>
            <Button
              variant="secondary"
              onClick={() => setShowModal(false)}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={loading}
              onClick={handleSubmit}
            >
              Submit for Approval
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
};

export default SubmitForApprovalButton;
