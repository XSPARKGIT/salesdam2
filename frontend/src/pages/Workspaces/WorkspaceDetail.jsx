import { useQuery } from '@tanstack/react-query';
import styles from './WorkspaceDetail.module.css';
import { useState, useEffect } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import * as LucideIcons from 'lucide-react';
import { ArrowLeft, Users, Settings, Star, Box, Layers } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  getWorkspace,
  updateWorkspace,
  removeWorkspaceMember,
} from '../../services/api/workspaces';
import WorkspaceSettings from './WorkspaceSettings/WorkspaceSettings';
import WorkspaceMembers from './WorkspaceMembers/WorkspaceMembers';
import WorkspaceObjects from './WorkspaceObjects/WorkspaceObjects';
import WorkspaceObjectGroups from './WorkspaceObjectGroups/WorkspaceObjectGroups';
import AddMemberModal from './AddMemberModal/AddMemberModal';

const TABS = [
  { id: 'settings', label: 'Settings', Icon: Settings },
  { id: 'members', label: 'Members', Icon: Users },
  { id: 'objects', label: 'Objects', Icon: Box },
  { id: 'groups', label: 'Object Groups', Icon: Layers },
];

const WorkspaceDetail = () => {
  const { id } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'settings';

  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [addModal, setAddModal] = useState(false);

  // Use React Query to fetch workspace
  const {
    data: workspace,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ['workspace', id],
    queryFn: () => getWorkspace(id),
    onError: () => {
      toast.error('Failed to load workspace.');
    },
    enabled: !!id, // Only run if ID is present
  });

  // Populate form whenever workspace data changes
  useEffect(() => {
    if (!workspace) return;

    setForm({
      name: workspace.name,
      description: workspace.description || '',
      color: workspace.color || '#6366f1',
      icon: workspace.icon || 'Briefcase',
      isDefault: workspace.isDefault,
      defaultObjectApiName: workspace.defaultObjectApiName || '',
    });
  }, [workspace]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateWorkspace(id, form);
      toast.success('Settings saved.');
      refetch(); // Refresh data after update
    } catch (err) {
      toast.error(err.message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (userId, name) => {
    if (!window.confirm(`Remove ${name} from this workspace?`)) return;
    try {
      await removeWorkspaceMember(id, userId);
      toast.success('User removed.');
      refetch(); // Refresh data after removing member
    } catch (err) {
      toast.error(err.message);
    }
  };

  if (isLoading)
    return (
      <div className={styles.loading}>
        <div className={styles.spinner} />
      </div>
    );

  const WsIcon = LucideIcons[workspace?.icon] || LucideIcons.Briefcase;
  const members = workspace?.memberIds || [];

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <Link to="/workspaces" className={styles.backLink}>
          <ArrowLeft size={16} /> Workspaces
        </Link>
        <div className={styles.titleRow}>
          <div
            className={styles.wsIconWrap}
            style={{
              background: `${workspace?.color}20`,
              color: workspace?.color,
            }}
          >
            <WsIcon size={22} />
          </div>
          <div className={styles.wsInfo}>
            <h1 className={styles.title}>
              {workspace?.name}
              {workspace?.isDefault && (
                <span className={styles.defaultBadge}>
                  <Star size={11} /> Default
                </span>
              )}
            </h1>
            <span className={styles.slug}>{workspace?.slug}</span>
          </div>
        </div>
      </div>

      <div className={styles.tabs}>
        {TABS.map(({ id: tabId, label, Icon }) => (
          <button
            key={tabId}
            className={`${styles.tab} ${activeTab === tabId ? styles.activeTab : ''}`}
            onClick={() => setSearchParams({ tab: tabId })}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {activeTab === 'settings' && (
        <WorkspaceSettings
          form={form}
          setForm={setForm}
          saving={saving}
          onSave={handleSave}
          allowedObjects={workspace?.allowedObjects || []}
        />
      )}

      {activeTab === 'members' && (
        <WorkspaceMembers
          members={members}
          onAdd={() => setAddModal(true)}
          onRemove={handleRemove}
        />
      )}

      {activeTab === 'objects' && <WorkspaceObjects />}

      {activeTab === 'groups' && <WorkspaceObjectGroups />}

      <AddMemberModal
        isOpen={addModal}
        onClose={() => setAddModal(false)}
        workspaceId={id}
        existingMembers={members}
        onSuccess={refetch}
      />
    </div>
  );
};

export default WorkspaceDetail;
