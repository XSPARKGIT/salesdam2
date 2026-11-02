import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Edit2, Trash2, KeyRound } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../services/api';
import Button from '../../components/common/Button/Button';
import Modal from '../../components/common/Modal/Modal';
import Layout from '../../layout/Layout';
import roleStyles from './RoleManagement.module.css';
import styles from './PermissionSets.module.css';

const SYSTEM_PERMISSIONS = [
  { key: 'canCustomizeApplication', label: 'Customize Application' },
  { key: 'canManageObjects', label: 'Manage Custom Objects and Fields' },
  { key: 'canManageLayouts', label: 'Manage Page Layouts' },
  { key: 'canManageAutomations', label: 'Manage Flows' },
  { key: 'canManageApprovals', label: 'Manage Approval Processes' },
  { key: 'canManageCustomCode', label: 'Manage Custom Code' },
  { key: 'canDeployCustomCode', label: 'Deploy Custom Code' },
  { key: 'canManageIntegrations', label: 'Manage Integrations' },
  { key: 'canManageApiKeys', label: 'Manage API Credentials' },
  { key: 'canManageWebhooks', label: 'Manage Webhooks' },
  { key: 'canManageUsers', label: 'Manage Users' },
  { key: 'canManageRoles', label: 'Manage Profiles and Permissions' },
  { key: 'canManageTenantSettings', label: 'Manage Tenant Configuration' },
  { key: 'canExportData', label: 'Export Data' },
  { key: 'canImportData', label: 'Import Data' },
  { key: 'canViewAuditLog', label: 'View Audit Logs' },
  { key: 'canViewAnalytics', label: 'View Analytics' },
  { key: 'canManageAnalytics', label: 'Manage Analytics' },
  { key: 'canViewCallRecordings', label: 'View Call Recordings' },
  { key: 'canManageCommunicationTemplates', label: 'Manage Communication Templates' },
  { key: 'canManageDocumentTemplates', label: 'Manage Document Templates' },
];

const EMPTY = { label: '', description: '', appIds: [], systemPermissions: {}, assignedUserIds: [] };
const idOf = (x) => String(x?._id || x);
const fullName = (u) => [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email;

/**
 * Permission Sets (BRD 5.3) — grant Apps to individual users on top of their
 * Role. A user's App Switcher shows the Apps from their Role, their Permission
 * Sets and any App they were added to directly.
 */
export default function PermissionSets() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(null); // null | { _id?, ...form }
  const [saving, setSaving] = useState(false);
  const [userSearch, setUserSearch] = useState('');

  const { data: sets = [], isLoading: loading, isError } = useQuery({
    queryKey: ['permission-sets'],
    queryFn: () => api.get('/permission-sets').then((r) => r.data.data || []),
  });
  // The default app is available to everyone, so it isn't granted here.
  const { data: apps = [] } = useQuery({
    queryKey: ['app-catalogue'],
    queryFn: () =>
      api.get('/workspaces/catalogue').then((r) => (r.data.data || []).filter((a) => !a.isDefault)),
  });
  const { data: users = [] } = useQuery({
    queryKey: ['users', 'permission-set-picker'],
    queryFn: () =>
      api.get('/users', { params: { limit: 500 } }).then((r) => {
        const u = r.data.data;
        return Array.isArray(u) ? u : u?.records || [];
      }),
  });
  const reload = () => queryClient.invalidateQueries({ queryKey: ['permission-sets'] });

  const openEditor = (set) => {
    setUserSearch('');
    setEditing(
      set
        ? {
            _id: set._id,
            label: set.label,
            description: set.description || '',
            appIds: (set.appIds || []).map(idOf),
            systemPermissions: set.systemPermissions || {},
            assignedUserIds: (set.assignedUserIds || []).map(idOf),
          }
        : { ...EMPTY },
    );
  };

  const toggle = (key, id) =>
    setEditing((p) => ({
      ...p,
      [key]: p[key].includes(id) ? p[key].filter((x) => x !== id) : [...p[key], id],
    }));

  const save = async () => {
    if (!editing.label.trim()) {
      toast.error('Label is required.');
      return;
    }
    setSaving(true);
    try {
      const body = {
        label: editing.label.trim(),
        description: editing.description,
        appIds: editing.appIds,
        systemPermissions: editing.systemPermissions,
        assignedUserIds: editing.assignedUserIds,
      };
      if (editing._id) await api.put(`/permission-sets/${editing._id}`, body);
      else await api.post('/permission-sets', body);
      toast.success(editing._id ? 'Permission set updated.' : 'Permission set created.');
      setEditing(null);
      reload();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (set) => {
    if (!window.confirm(`Delete permission set "${set.label}"? Its users lose the apps it grants unless their role or membership also grants them.`)) return;
    try {
      await api.delete(`/permission-sets/${set._id}`);
      toast.success('Permission set deleted.');
      reload();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Delete failed.');
    }
  };

  const visibleUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    const list = [...users].sort((a, b) => fullName(a).localeCompare(fullName(b)));
    if (!q) return list;
    return list.filter((u) => `${fullName(u)} ${u.email}`.toLowerCase().includes(q));
  }, [users, userSearch]);

  return (
    <Layout title="Permission Sets" description="Grant apps to individual users on top of their role">
      <div className={roleStyles.page}>
        <div className={roleStyles.header}>
          <div>
            <h1 className={roleStyles.title}>Permission Sets</h1>
            <p className={styles.intro}>
              A user's App Switcher shows the apps from their role, their permission sets, and
              any app they were added to directly. Object permissions still come from the role.
            </p>
          </div>
          <Button icon={<Plus size={14} />} onClick={() => openEditor(null)}>
            New Permission Set
          </Button>
        </div>

        {loading ? (
          <p className={styles.muted}>Loading…</p>
        ) : isError ? (
          <div className={styles.empty}>Couldn't load permission sets. Refresh to try again.</div>
        ) : sets.length === 0 ? (
          <div className={styles.empty} data-testid="permission-sets-empty">
            No permission sets yet. Create one to give specific users access to an app without
            changing their role.
          </div>
        ) : (
          <div className={roleStyles.roleList}>
            {sets.map((set) => (
              <div key={set._id} className={roleStyles.roleCard} data-testid="permission-set-card">
                <div className={roleStyles.roleIcon}>
                  <KeyRound size={18} />
                </div>
                <div className={roleStyles.roleInfo}>
                  <div className={roleStyles.roleName}>
                    {set.label}
                    <span className={roleStyles.roleApiName}>{set.name}</span>
                  </div>
                  {set.description && <div className={roleStyles.roleDesc}>{set.description}</div>}
                  <div className={styles.chips}>
                    {(set.appIds || []).length === 0 ? (
                      <span className={styles.muted}>No apps</span>
                    ) : (
                      set.appIds.map((a) => (
                        <span key={idOf(a)} className={styles.chip}>
                          {a.name || 'Unknown app'}
                        </span>
                      ))
                    )}
                  </div>
                  <div className={roleStyles.roleObjectCount}>
                    {(set.assignedUserIds || []).length} user{(set.assignedUserIds || []).length === 1 ? '' : 's'}
                  </div>
                </div>
                <div className={roleStyles.roleActions}>
                  <Button variant="ghost" size="sm" icon={<Edit2 size={14} />} onClick={() => openEditor(set)} aria-label={`Edit ${set.label}`} />
                  <Button variant="ghost" size="sm" icon={<Trash2 size={14} />} onClick={() => remove(set)} aria-label={`Delete ${set.label}`} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal
        isOpen={!!editing}
        onClose={() => setEditing(null)}
        title={editing?._id ? `Edit ${editing.label || 'permission set'}` : 'New Permission Set'}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={save} loading={saving}>{editing?._id ? 'Save Changes' : 'Create'}</Button>
          </>
        }
      >
        {editing && (
          <div className={styles.form}>
            <label className={styles.field}>
              <span className={styles.label}>Label *</span>
              <input
                className={roleStyles.input}
                value={editing.label}
                maxLength={80}
                placeholder="e.g. Insurance Back Office"
                onChange={(e) => setEditing((p) => ({ ...p, label: e.target.value }))}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Description</span>
              <input
                className={roleStyles.input}
                value={editing.description}
                placeholder="Who this is for"
                onChange={(e) => setEditing((p) => ({ ...p, description: e.target.value }))}
              />
            </label>

            <fieldset className={styles.group}>
              <legend className={styles.label}>Apps granted</legend>
              {apps.length === 0 ? (
                <p className={styles.muted}>No apps besides the default, which everyone has.</p>
              ) : (
                <div className={roleStyles.permGrid}>
                  {apps.map((app) => (
                    <label key={app._id} className={roleStyles.permItem}>
                      <input
                        type="checkbox"
                        checked={editing.appIds.includes(idOf(app))}
                        onChange={() => toggle('appIds', idOf(app))}
                      />
                      {app.name}
                    </label>
                  ))}
                </div>
              )}
            </fieldset>

            <fieldset className={styles.group}>
              <legend className={styles.label}>System Permissions</legend>
              <div className={roleStyles.permGrid}>
                {SYSTEM_PERMISSIONS.map((perm) => (
                  <label key={perm.key} className={roleStyles.permItem}>
                    <input
                      type="checkbox"
                      checked={!!editing.systemPermissions[perm.key]}
                      onChange={() =>
                        setEditing((p) => ({
                          ...p,
                          systemPermissions: {
                            ...p.systemPermissions,
                            [perm.key]: !p.systemPermissions[perm.key],
                          },
                        }))
                      }
                    />
                    {perm.label}
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className={styles.group}>
              <legend className={styles.label}>
                Assigned users <span className={styles.muted}>({editing.assignedUserIds.length})</span>
              </legend>
              <input
                className={roleStyles.input}
                placeholder="Search users…"
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                aria-label="Search users"
              />
              <div className={styles.userList}>
                {visibleUsers.map((u) => (
                  <label key={u._id} className={styles.userRow}>
                    <input
                      type="checkbox"
                      checked={editing.assignedUserIds.includes(idOf(u))}
                      onChange={() => toggle('assignedUserIds', idOf(u))}
                    />
                    <span className={styles.userName}>{fullName(u)}</span>
                    <span className={styles.muted}>{u.email}</span>
                  </label>
                ))}
                {visibleUsers.length === 0 && <p className={styles.muted}>No users match.</p>}
              </div>
            </fieldset>
          </div>
        )}
      </Modal>
    </Layout>
  );
}
