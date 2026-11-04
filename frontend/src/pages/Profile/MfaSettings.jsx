import { useState, useEffect, useCallback } from 'react';
import { ShieldCheck, ShieldOff, Copy } from 'lucide-react';
import api from '../../services/api';
import styles from './Profile.module.css';

/**
 * Core BRD §21.4 — MFA enrollment, verification and recovery, connected to
 * the real backend endpoints (auth/mfa/*). No state here is simulated: the
 * enabled/required flags come from GET /auth/mfa/status, and enrollment only
 * completes once POST /auth/mfa/enroll/verify accepts a real TOTP code.
 */
const MfaSettings = () => {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Enrollment in progress
  const [enrolling, setEnrolling] = useState(false);
  const [secret, setSecret] = useState('');
  const [otpAuthUri, setOtpAuthUri] = useState('');
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState('');
  const [backupCodes, setBackupCodes] = useState([]);
  const [verifyCode, setVerifyCode] = useState('');
  const [showManualEntry, setShowManualEntry] = useState(false);

  // Disable flow
  const [disabling, setDisabling] = useState(false);
  const [disablePassword, setDisablePassword] = useState('');

  const loadStatus = useCallback(async () => {
    try {
      const res = await api.get('/auth/mfa/status');
      setStatus(res.data.data);
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  const startEnroll = async () => {
    setError(''); setSuccess('');
    setLoading(true);
    try {
      const res = await api.post('/auth/mfa/enroll');
      setSecret(res.data.data.secret);
      setOtpAuthUri(res.data.data.otpAuthUri);
      setQrCodeDataUrl(res.data.data.qrCodeDataUrl);
      setBackupCodes(res.data.data.backupCodes);
      setEnrolling(true);
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || 'Could not start enrollment.');
    } finally {
      setLoading(false);
    }
  };

  const confirmEnroll = async () => {
    if (!verifyCode.trim()) { setError('Enter the 6-digit code from your authenticator app.'); return; }
    setError(''); setLoading(true);
    try {
      await api.post('/auth/mfa/enroll/verify', { code: verifyCode.trim() });
      setSuccess('MFA is now enabled on your account.');
      setEnrolling(false);
      setVerifyCode('');
      setSecret('');
      setOtpAuthUri('');
      setQrCodeDataUrl('');
      await loadStatus();
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || 'Incorrect code.');
    } finally {
      setLoading(false);
    }
  };

  const cancelEnroll = () => {
    setEnrolling(false);
    setSecret('');
    setOtpAuthUri('');
    setQrCodeDataUrl('');
    setBackupCodes([]);
    setVerifyCode('');
    setShowManualEntry(false);
    setError('');
  };

  const confirmDisable = async () => {
    if (!disablePassword) { setError('Enter your current password.'); return; }
    setError(''); setLoading(true);
    try {
      await api.post('/auth/mfa/disable', { currentPassword: disablePassword });
      setSuccess('MFA has been disabled on your account.');
      setDisabling(false);
      setDisablePassword('');
      await loadStatus();
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || 'Could not disable MFA.');
    } finally {
      setLoading(false);
    }
  };

  const copyBackupCodes = () => {
    navigator.clipboard?.writeText(backupCodes.join('\n')).catch(() => {});
  };

  if (!status) return null;

  return (
    <div className={styles.securitySection}>
      <h3>Multi-Factor Authentication</h3>
      <p className={styles.sectionDescription}>
        {status.required && !status.enabled
          ? 'Your workspace requires MFA on this account. Set it up below.'
          : 'Add a second step to signing in, using an authenticator app on your phone.'}
      </p>

      {error && (
        <p className={styles.sectionDescription} style={{ color: 'var(--color-danger, #dc2626)' }}>{error}</p>
      )}
      {success && (
        <p className={styles.sectionDescription} style={{ color: 'var(--color-success, #16a34a)' }}>{success}</p>
      )}

      {!enrolling && !disabling && (
        <div className={styles.formActions}>
          {status.enabled ? (
            <>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <ShieldCheck size={16} color="#16a34a" /> Enabled
              </span>
              <button
                className={styles.secondaryBtn}
                onClick={() => { setDisabling(true); setError(''); setSuccess(''); }}
                disabled={status.required}
                title={status.required ? 'MFA is required by your workspace and cannot be disabled here.' : ''}
              >
                <ShieldOff size={14} /> Disable MFA
              </button>
            </>
          ) : (
            <button className={styles.saveBtn} onClick={startEnroll} disabled={loading}>
              {loading ? 'Starting…' : 'Set Up MFA'}
            </button>
          )}
        </div>
      )}

      {enrolling && (
        <div>
          <p className={styles.sectionDescription}>
            Scan this with your authenticator app (Google Authenticator, Authy, 1Password…).
          </p>

          {qrCodeDataUrl && !showManualEntry && (
            <div>
              <img
                src={qrCodeDataUrl}
                alt="Scan with your authenticator app"
                width={200}
                height={200}
                style={{ display: 'block', border: '1px solid var(--color-gray-200, #e2e8f0)', borderRadius: 8, padding: 8, background: '#fff' }}
              />
              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={() => setShowManualEntry(true)}
                style={{ marginTop: 8 }}
              >
                Can't scan it? Enter the code manually
              </button>
            </div>
          )}

          {(showManualEntry || !qrCodeDataUrl) && (
            <div>
              {showManualEntry && (
                <button type="button" className={styles.secondaryBtn} onClick={() => setShowManualEntry(false)} style={{ marginBottom: 8 }}>
                  Back to QR code
                </button>
              )}
              <p className={styles.sectionDescription}>Enter this code manually in your authenticator app:</p>
              <div style={{ fontFamily: 'monospace', fontSize: 16, padding: '8px 12px', background: 'var(--color-gray-50, #f8fafc)', borderRadius: 6, display: 'inline-block', letterSpacing: 2 }}>
                {secret}
              </div>
              <p className={styles.sectionDescription} style={{ wordBreak: 'break-all', fontSize: 12 }}>{otpAuthUri}</p>
            </div>
          )}

          <div className={styles.formActions} style={{ marginTop: 8 }}>
            <input
              className={styles.input}
              placeholder="6-digit code"
              value={verifyCode}
              onChange={(e) => setVerifyCode(e.target.value)}
              style={{ maxWidth: 160 }}
            />
            <button className={styles.saveBtn} onClick={confirmEnroll} disabled={loading}>
              {loading ? 'Verifying…' : 'Confirm'}
            </button>
            <button className={styles.secondaryBtn} onClick={cancelEnroll}>Cancel</button>
          </div>

          {backupCodes.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <p className={styles.sectionDescription}>
                <strong>Save these recovery codes.</strong> Each can be used once to sign in if you lose access
                to your authenticator app. They will not be shown again.
              </p>
              <div style={{ fontFamily: 'monospace', fontSize: 13, lineHeight: 1.8, padding: 12, background: 'var(--color-gray-50, #f8fafc)', borderRadius: 6 }}>
                {backupCodes.map((c) => <div key={c}>{c}</div>)}
              </div>
              <button className={styles.secondaryBtn} onClick={copyBackupCodes} style={{ marginTop: 8 }}>
                <Copy size={14} /> Copy codes
              </button>
            </div>
          )}
        </div>
      )}

      {disabling && (
        <div className={styles.formActions}>
          <input
            type="password"
            className={styles.input}
            placeholder="Current password"
            value={disablePassword}
            onChange={(e) => setDisablePassword(e.target.value)}
            style={{ maxWidth: 220 }}
          />
          <button className={styles.saveBtn} onClick={confirmDisable} disabled={loading}>
            {loading ? 'Disabling…' : 'Confirm Disable'}
          </button>
          <button className={styles.secondaryBtn} onClick={() => { setDisabling(false); setDisablePassword(''); setError(''); }}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
};

export default MfaSettings;
