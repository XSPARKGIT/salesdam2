import React, { useState, useEffect } from 'react';
import { Plus, Copy, RefreshCw, Trash2, Eye, EyeOff, AlertCircle, CheckCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import Button from '../../../components/common/Button/Button';
import AdminSettingsPage from '../AdminSettingsPage';
import {
  listIntegrations,
  createIntegration,
  updateIntegration,
  regenerateToken,
  deleteIntegration,
} from '../../../lib/api/integrations';
import styles from '../AdminSettingsPage.module.css';
import localStyles from './Integrations.module.css';

const IntegrationStatus = ({ status }) => {
  if (status === 'active') {
    return (
      <span className={`${localStyles.badge} ${localStyles.badgeActive}`}>
        <CheckCircle size={12} /> Active
      </span>
    );
  }
  return (
    <span className={`${localStyles.badge} ${localStyles.badgeInactive}`}>
      <AlertCircle size={12} /> Inactive
    </span>
  );
};

const TokenDisplay = ({ token, isVisible, onToggle, onCopy }) => {
  return (
    <div className={localStyles.tokenContainer}>
      <input
        type={isVisible ? 'text' : 'password'}
        value={token}
        readOnly
        className={localStyles.tokenInput}
      />
      <Button
        variant="ghost"
        size="sm"
        icon={isVisible ? <EyeOff size={14} /> : <Eye size={14} />}
        onClick={onToggle}
      />
      <Button
        variant="ghost"
        size="sm"
        icon={<Copy size={14} />}
        onClick={onCopy}
      />
    </div>
  );
};

export default function Integrations() {
  const [integrations, setIntegrations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showTokenModal, setShowTokenModal] = useState(false);
  const [selectedIntegration, setSelectedIntegration] = useState(null);
  const [tokenVisibility, setTokenVisibility] = useState({});
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    externalSystem: 'custom',
    permissions: ['read'],
    metadata: {
      documentation_url: '',
      notes: '',
    },
  });

  const loadIntegrations = async () => {
    try {
      setLoading(true);
      const data = await listIntegrations();
      setIntegrations(data);
    } catch {
      toast.error('Failed to load integrations');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadIntegrations();
  }, []);

  const handleCreateIntegration = async () => {
    try {
      if (!formData.name.trim()) {
        toast.error('Integration name is required');
        return;
      }

      const newIntegration = await createIntegration(formData);
      setSelectedIntegration(newIntegration);
      setShowCreateModal(false);
      setShowTokenModal(true);
      setFormData({
        name: '',
        description: '',
        externalSystem: 'custom',
        permissions: ['read'],
        metadata: {
          documentation_url: '',
          notes: '',
        },
      });
      await loadIntegrations();
    } catch (err) {
      toast.error(err.message || 'Failed to create integration');
    }
  };

  const handleRegenerateToken = async (integrationId) => {
    if (!window.confirm('Are you sure? The old token will stop working immediately.')) {
      return;
    }

    try {
      const updated = await regenerateToken(integrationId);
      setSelectedIntegration(updated);
      toast.success('Token regenerated. Save the new token immediately.');
      await loadIntegrations();
    } catch (err) {
      toast.error(err.message || 'Failed to regenerate token');
    }
  };

  const handleDeleteIntegration = async (integrationId) => {
    if (!window.confirm('Are you sure? This will revoke access for external systems using this token.')) {
      return;
    }

    try {
      await deleteIntegration(integrationId);
      toast.success('Integration deleted');
      await loadIntegrations();
    } catch (err) {
      toast.error(err.message || 'Failed to delete integration');
    }
  };

  const handleToggleStatus = async (integration) => {
    try {
      const updated = await updateIntegration(integration._id, {
        status: integration.status === 'active' ? 'inactive' : 'active',
      });
      toast.success(`Integration ${updated.status === 'active' ? 'activated' : 'deactivated'}`);
      await loadIntegrations();
    } catch (err) {
      toast.error(err.message || 'Failed to update integration');
    }
  };

  const toggleTokenVisibility = (integrationId) => {
    setTokenVisibility((prev) => ({
      ...prev,
      [integrationId]: !prev[integrationId],
    }));
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  };

  if (loading) {
    return (
      <AdminSettingsPage
        title="Integrations"
        description="Manage external integrations with auto-generated access tokens"
        icon={Plus}
        iconColor="#0066FF"
      >
        <div style={{ textAlign: 'center', padding: '40px' }}>Loading integrations...</div>
      </AdminSettingsPage>
    );
  }

  return (
    <AdminSettingsPage
      title="Integrations"
      description="Manage external integrations with auto-generated access tokens"
      icon={Plus}
      iconColor="#0066FF"
    >
      <div className={styles.panel}>
        <div className={localStyles.headerRow}>
          <p className={localStyles.headerDesc}>
            Connect Salesdam to external applications using auto-generated access tokens. Control token expiration and status for each integration.
          </p>
          <Button variant="primary" icon={<Plus size={14} />} onClick={() => setShowCreateModal(true)}>
            Create Integration
          </Button>
        </div>

        {integrations.length > 0 ? (
          <div className={localStyles.integrationsList}>
            {integrations.map((integration) => (
              <div key={integration._id} className={localStyles.integrationCard}>
                <div className={localStyles.cardHeader}>
                  <div>
                    <h3 className={localStyles.integrationName}>{integration.name}</h3>
                    {integration.description && (
                      <p className={localStyles.integrationDesc}>{integration.description}</p>
                    )}
                  </div>
                  <IntegrationStatus status={integration.status} />
                </div>

                <div className={localStyles.cardBody}>
                  <div className={localStyles.infoRow}>
                    <span className={localStyles.label}>External System:</span>
                    <span className={localStyles.value}>{integration.externalSystem}</span>
                  </div>

                  {integration.expiresAt && (
                    <div className={localStyles.infoRow}>
                      <span className={localStyles.label}>Expires:</span>
                      <span className={localStyles.value}>
                        {new Date(integration.expiresAt).toLocaleDateString('en-ZA')}
                      </span>
                    </div>
                  )}

                  {integration.lastUsedAt && (
                    <div className={localStyles.infoRow}>
                      <span className={localStyles.label}>Last Used:</span>
                      <span className={localStyles.value}>
                        {new Date(integration.lastUsedAt).toLocaleDateString('en-ZA')}
                        {integration.lastUsedIp && ` from ${integration.lastUsedIp}`}
                      </span>
                    </div>
                  )}

                  {integration.permissions && (
                    <div className={localStyles.infoRow}>
                      <span className={localStyles.label}>Permissions:</span>
                      <span className={localStyles.value}>{integration.permissions.join(', ')}</span>
                    </div>
                  )}
                </div>

                <div className={localStyles.cardFooter}>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setSelectedIntegration(integration);
                      setShowTokenModal(true);
                    }}
                  >
                    View Token
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<RefreshCw size={12} />}
                    onClick={() => handleRegenerateToken(integration._id)}
                  >
                    Regenerate Token
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleToggleStatus(integration)}
                  >
                    {integration.status === 'active' ? 'Deactivate' : 'Activate'}
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    icon={<Trash2 size={12} />}
                    onClick={() => handleDeleteIntegration(integration._id)}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className={localStyles.emptyState}>
            <AlertCircle size={32} />
            <p>No integrations yet</p>
            <p className={localStyles.emptyStateHint}>Create your first integration to connect external applications</p>
          </div>
        )}
      </div>

      {/* Create Integration Modal */}
      {showCreateModal && (
        <div className={localStyles.modal} onClick={() => setShowCreateModal(false)}>
          <div className={localStyles.modalContent} onClick={(e) => e.stopPropagation()}>
            <h2>Create Integration</h2>
            <div className={localStyles.formGroup}>
              <label>Integration Name *</label>
              <input
                type="text"
                placeholder="e.g., Zapier Webhook"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className={localStyles.input}
              />
            </div>

            <div className={localStyles.formGroup}>
              <label>Description</label>
              <textarea
                placeholder="What is this integration for?"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className={localStyles.textarea}
                rows={3}
              />
            </div>

            <div className={localStyles.formGroup}>
              <label>External System</label>
              <select
                value={formData.externalSystem}
                onChange={(e) => setFormData({ ...formData, externalSystem: e.target.value })}
                className={localStyles.select}
              >
                <option value="custom">Custom</option>
                <option value="zapier">Zapier</option>
                <option value="make">Make</option>
                <option value="webhook">Webhook</option>
              </select>
            </div>

            <div className={localStyles.formGroup}>
              <label>Documentation URL</label>
              <input
                type="url"
                placeholder="https://docs.example.com"
                value={formData.metadata.documentation_url}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    metadata: { ...formData.metadata, documentation_url: e.target.value },
                  })
                }
                className={localStyles.input}
              />
            </div>

            <div className={localStyles.formActions}>
              <Button variant="primary" onClick={handleCreateIntegration}>
                Create Integration
              </Button>
              <Button variant="secondary" onClick={() => setShowCreateModal(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Token Modal */}
      {showTokenModal && selectedIntegration && (
        <div className={localStyles.modal} onClick={() => setShowTokenModal(false)}>
          <div className={localStyles.modalContent} onClick={(e) => e.stopPropagation()}>
            <h2>Access Token</h2>
            <p className={localStyles.tokenWarning}>
              <AlertCircle size={14} />{' '}
              {selectedIntegration.accessToken
                ? "Save this token somewhere safe. You won't be able to see it again."
                : 'The token is shown only once, when it is created or regenerated. Use Regenerate Token to get a new one.'}
            </p>

            <div className={localStyles.formGroup}>
              <label>Token</label>
              <TokenDisplay
                token={selectedIntegration.accessToken}
                isVisible={tokenVisibility[selectedIntegration._id]}
                onToggle={() => toggleTokenVisibility(selectedIntegration._id)}
                onCopy={() => copyToClipboard(selectedIntegration.accessToken)}
              />
            </div>

            <div className={localStyles.formGroup}>
              <label>Usage Instructions</label>
              <pre className={localStyles.codeBlock}>
                {`Authorization: Bearer ${selectedIntegration.accessToken}

                Example:
                curl -H "Authorization: Bearer ${selectedIntegration.accessToken}" \\
                  https://your-backend.com/api/integrations/verify-token`}
              </pre>
            </div>

            <div className={localStyles.formActions}>
              <Button
                variant="secondary"
                onClick={() => copyToClipboard(selectedIntegration.accessToken)}
              >
                Copy Token
              </Button>
              <Button variant="secondary" onClick={() => setShowTokenModal(false)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </AdminSettingsPage>
  );
}
