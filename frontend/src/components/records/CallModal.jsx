import { useState } from 'react';
import { Phone, X } from 'lucide-react';
import { dial } from '../../services/api/telephony';

const CallModal = ({ open, onClose, objectApiName, recordId, defaultNumber }) => {
  const [number, setNumber] = useState(defaultNumber || '');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  if (!open) return null;

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await dial({ provider: 'euphoria', to: number, objectApiName, recordId });
      setResult(res?.data?.data || res?.data || { status: 'accepted' });
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || 'Call failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15,23,42,0.55)' }}>
      <div style={{ background: '#fff', padding: '1.5rem', borderRadius: '12px', width: '100%', maxWidth: '420px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 style={{ margin: 0 }}>Click to Call</h3>
          <button type="button" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <form onSubmit={submit}>
          <label style={{ display: 'block', marginBottom: '0.75rem' }}>
            Phone number
            <input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="+27..." required style={{ width: '100%', marginTop: '0.25rem' }} />
          </label>
          <button type="submit" disabled={loading || !number} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
            <Phone size={14} /> {loading ? 'Initiating...' : 'Call'}
          </button>
        </form>
        {error && <p style={{ color: '#dc2626', marginTop: '0.75rem' }}>{error}</p>}
        {result && <pre style={{ marginTop: '0.75rem', fontSize: '0.75rem' }}>{JSON.stringify(result, null, 2)}</pre>}
      </div>
    </div>
  );
};

export default CallModal;
