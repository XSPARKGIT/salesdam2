import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText } from 'lucide-react';
import Button from '../common/Button/Button';
import toast from 'react-hot-toast';
import api from '../../services/api';
import ConvertLeadToDealModal from './ConvertLeadToDealModal';

const ConvertToDealButton = ({
  leadId,
  lead,
  tender,
  source = 'lead',
  onSuccess,
  // Configured button appearance (BRD 4.4 action buttons)
  label = 'Convert to Deal',
  variant = 'primary',
  icon = <FileText size={14} />,
}) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);

  const handleConvert = async (clientId) => {
    setLoading(true);
    try {
      const isTenderSource = source === 'tender';

      const response = isTenderSource
        ? await api.post('/tenders/convert-to-deal', {
            tender,
            clientId,
            supportDocuments: tender?.supportDocuments || [],
          })
        : await api.post(`/leads/${leadId}/convert-to-deal`, { clientId });

      const dealId =
        response.data?.data?.deal?._id || response.data?.data?.deal?.id;

      toast.success(
        isTenderSource
          ? 'Tender converted to deal successfully'
          : 'Lead converted to deal successfully',
      );

      onSuccess?.();
      setShowModal(false);
      if (dealId) {
        navigate(`/o/deal/${dealId}`);
      }
    } catch (error) {
      const message =
        error.response?.data?.message ||
        error.message ||
        'Failed to convert lead';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

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

      <ConvertLeadToDealModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        lead={lead}
        onConfirm={handleConvert}
        isLoading={loading}
      />
    </>
  );
};

export default ConvertToDealButton;
