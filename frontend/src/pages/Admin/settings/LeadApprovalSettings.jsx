import { useState, useEffect } from 'react';
import { CheckCircle2, X, UserPlus } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../../services/api';
import AdminSettingsPage from '../AdminSettingsPage';
import LookupInput from '../../../components/forms/LookupInput/LookupInput';
import styles from './LeadApprovalSettings.module.css';
import { useAuth } from '../../../hooks/useAuth';

const DEFAULT_SETTINGS = {
  leadApprovalsRequired: true,
  approvers: [],
};

const ToggleRow = ({ label, desc, checked, onChange }) => (
  <div className={styles.featureToggleCard}>
    <div className={styles.featureToggleInfo}>
      <strong className={styles.featureToggleLabel}>{label}</strong>
      {desc && <p className={styles.featureToggleDesc}>{desc}</p>}
    </div>
    <label className={styles.toggle}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className={styles.toggleSlider} />
    </label>
  </div>
);

const ApproverRow = ({ approver, onRemove, removing }) => {
  const displayName =
    `${approver.firstName || ''} ${approver.lastName || ''}`.trim() ||
    approver.email ||
    approver._id;

  return (
    <div className={styles.approverItem}>
      <div className={styles.approverInfo}>
        <div className={styles.approverAvatar}>
          {(approver.firstName || approver.email || '?')
            .charAt(0)
            .toUpperCase()}
        </div>
        <div>
          <div className={styles.approverName}>{displayName}</div>
          {approver.email && (
            <div className={styles.approverEmail}>{approver.email}</div>
          )}
        </div>
      </div>
      <button
        type="button"
        className={styles.removeApproverBtn}
        onClick={() => onRemove(approver._id)}
        disabled={removing}
        title="Remove approver"
      >
        <X size={14} />
      </button>
    </div>
  );
};

export default function LeadApprovalSettings() {
  const { fetchMe } = useAuth();
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [savingApprovers, setSavingApprovers] = useState(false);

  useEffect(() => {
    api
      .get('/admin/settings')
      .then((res) => {
        const s = res.data.data?.leadApprovalSettings;
        if (s)
          setSettings((prev) => ({
            ...prev,
            ...s,
            approvers: s.approvers || [],
          }));
      })
      .catch(() => toast.error('Failed to load settings.'))
      .finally(() => setLoading(false));
  }, []);

  const toggleSetting = async (key, val) => {
    setSettings((prev) => ({ ...prev, [key]: val }));
    try {
      await api.put('/admin/settings', {
        leadApprovalSettings: { [key]: val },
      });
      await fetchMe();
      toast.success(
        val ? 'Lead approvals enabled.' : 'Lead approvals disabled.',
      );
    } catch (err) {
      setSettings((prev) => ({ ...prev, [key]: !val }));
      toast.error(err?.data?.message || err?.message || 'Failed to update setting.');
    }
  };

  const saveApprovers = async (nextApprovers) => {
    const previous = settings.approvers;
    setSettings((prev) => ({ ...prev, approvers: nextApprovers }));
    setSavingApprovers(true);
    try {
      await api.put('/admin/settings', {
        leadApprovalSettings: {
          approvers: nextApprovers.map((a) => a._id),
        },
      });
      await fetchMe();
    } catch (err) {
      setSettings((prev) => ({ ...prev, approvers: previous }));
      toast.error(
        err?.data?.message || err?.message || 'Failed to update approvers.',
      );
    } finally {
      setSavingApprovers(false);
    }
  };

  // NOTE: assumes LookupInput's onChange also passes the selected record as a
  // second argument (id, record) so we can display a name — adjust if its
  // actual signature only returns the id.
  const handleAddApprover = (id, record) => {
    if (!id) return;

    if (settings.approvers.some((a) => String(a._id) === String(id))) {
      toast.error('This user is already an approver.');
      return;
    }

    const approver = {
      ...(record || {}),
      _id: id,
    };

    saveApprovers([...settings.approvers, approver]);
  };

  const handleRemoveApprover = (id) => {
    saveApprovers(settings.approvers.filter((a) => a._id !== id));
  };

  const SkeletonToggle = () => (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '24px',
        padding: '16px',
        border: '1px solid #e2e8f0',
        borderRadius: '8px',
        background: '#f9fafb',
      }}
    >
      <div style={{ flex: 1 }}>
        <div
          style={{
            height: '16px',
            width: '200px',
            background: '#e2e8f0',
            borderRadius: '4px',
            marginBottom: '8px',
          }}
        />
        <div
          style={{
            height: '12px',
            width: '300px',
            background: '#e2e8f0',
            borderRadius: '4px',
          }}
        />
      </div>
      <div
        style={{
          width: '44px',
          height: '24px',
          background: '#e2e8f0',
          borderRadius: '24px',
        }}
      />
    </div>
  );

  return (
    <AdminSettingsPage
      title="Lead Approval Settings"
      description="Configure lead approval workflow requirements"
      icon={CheckCircle2}
      iconColor="#10b981"
    >
      {loading ? (
        <div
          className={styles.panel}
          style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}
        >
          <SkeletonToggle />
        </div>
      ) : (
        <div className={styles.panel}>
          <ToggleRow
            label="Require Approvals Before Conversion"
            desc="When enabled, leads must be submitted for approval and approved by a manager before conversion to deals. When disabled, users can convert leads directly."
            checked={settings.leadApprovalsRequired}
            onChange={(v) => toggleSetting('leadApprovalsRequired', v)}
          />

          {settings.leadApprovalsRequired && (
            <div className={styles.approversSection}>
              <div className={styles.approversHeader}>
                <UserPlus size={15} />
                <strong>Approvers</strong>
              </div>
              <p className={styles.featureToggleDesc}>
                Users who can review and approve leads submitted for conversion.
              </p>

              <div className={styles.addApproverRow}>
                <LookupInput
                  value=""
                  onChange={handleAddApprover}
                  objectApiName="user"
                  displayField="firstName"
                  placeholder="Search users to add as approver..."
                  allowCreate={false}
                />
              </div>

              <div className={styles.approversList}>
                {settings.approvers.length === 0 ? (
                  <p className={styles.emptyApprovers}>
                    No approvers added yet.
                  </p>
                ) : (
                  settings.approvers.map((approver) => (
                    <ApproverRow
                      key={approver._id}
                      approver={approver}
                      onRemove={handleRemoveApprover}
                      removing={savingApprovers}
                    />
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </AdminSettingsPage>
  );
}
