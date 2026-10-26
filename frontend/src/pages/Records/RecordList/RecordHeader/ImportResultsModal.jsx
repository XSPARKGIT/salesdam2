import Modal from '../../../../components/common/Modal/Modal';
import Button from '../../../../components/common/Button/Button';
import { CheckCircle2, XCircle } from 'lucide-react';

export default function ImportResultsModal({ results, onClose }) {
  const { created = 0, failed = 0, errors = [] } = results || {};
  const total = created + failed;

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Import Results"
      size="md"
      footer={<Button onClick={onClose}>Close</Button>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Summary row */}
        <div style={{ display: 'flex', gap: 12 }}>
          <div style={statBox('#ecfdf5', '#10b981')}>
            <CheckCircle2 size={18} />
            <span><strong>{created}</strong> created</span>
          </div>
          <div style={statBox('#fef2f2', '#ef4444')}>
            <XCircle size={18} />
            <span><strong>{failed}</strong> failed</span>
          </div>
        </div>

        {errors.length > 0 && (
          <div>
            <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
              Row errors ({errors.length} of {total} rows processed):
            </p>
            <div style={{ maxHeight: 280, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {errors.map((e, i) => (
                <div
                  key={i}
                  style={{
                    fontSize: 12,
                    padding: '8px 10px',
                    borderRadius: 6,
                    border: '1px solid #fca5a5',
                    background: '#fef2f2',
                    color: '#991b1b',
                  }}
                >
                  <strong>Row {e.row ?? i + 1}:</strong>{' '}
                  {Array.isArray(e.errors) ? e.errors.join(', ') : e.error || 'Unknown error'}
                </div>
              ))}
            </div>
          </div>
        )}

        {created === 0 && errors.length === 0 && (
          <p style={{ fontSize: 13, color: 'var(--color-gray-500)' }}>
            No new records were imported. All rows may have been duplicates or already exist.
          </p>
        )}
      </div>
    </Modal>
  );
}

function statBox(bg, color) {
  return {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '10px 12px',
    borderRadius: 8,
    background: bg,
    color,
    fontSize: 13,
  };
}
