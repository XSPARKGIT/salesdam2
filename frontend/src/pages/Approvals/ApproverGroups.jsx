import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Edit2, Trash2, Users } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../services/api';
import {
  getApproverGroups,
  createApproverGroup,
  updateApproverGroup,
  deleteApproverGroup,
} from '../../services/api/approvals';
import Button from '../../components/common/Button/Button';
import Modal from '../../components/common/Modal/Modal';
import Layout from '../../layout/Layout';
import roleStyles from '../Admin/RoleManagement.module.css';
import styles from '../Admin/PermissionSets.module.css';

const EMPTY = { label: '', description: '', memberIds: [], roleIds: [] };
const idOf = (x) => String(x?._id || x);
const fullName = (u) => [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email;

/**
 * Approver groups (BRD §8) — public groups of eligible approvers. An approval
 * step can name a group; anyone in it may decide that step. A member is listed
 * directly, or holds one of the group's roles.
 */
export default function ApproverGroups() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(null); // null | { _id?, ...form }
  const [saving, setSaving] = useState(false);
  const [userSearch, setUserSearch] = useState('');

  const { data: groups = [], isLoading, isError } = useQuery({
    queryKey: ['approver-groups'],
    queryFn: getApproverGroups,
  });
  const { data: roles = [] } = useQuery({
    queryKey: ['roles'],
    queryFn: () => api.get('/roles').then((r) => r.data.data || []),
  });
  const { data: users = [] } = useQuery({
    queryKey: ['users', 'approver-group-picker'],
    queryFn: () =>
      api.get('/users', { params: { limit: 500 } }).then((r) => {
        const u = r.data.data;
        return Array.isArray(u) ? u : u?.records || [];
      }),
  });
  const reload = () => queryClient.invalidateQueries({ queryKey: ['approver-groups'] });

  const openEditor = (group) => {
    setUserSearch('');
    setEditing(
      group
        ? {
            _id: group._id,
            label: group.label,
            description: group.description || '',
            memberIds: (group.memberIds || []).map(idOf),
            roleIds: (group.roleIds || []).map(idOf),
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
        memberIds: editing.memberIds,
        roleIds: editing.roleIds,
      };
      if (editing._id) await updateApproverGroup(editing._id, body);
      else await createApproverGroup(body);
      toast.success(editing._id ? 'Approver group updated.' : 'Approver group created.');
      setEditing(null);
      reload();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (group) => {
    if (!window.confirm(`Delete the approver group "${group.label}"?`)) return;
    try {
      await deleteApproverGroup(group._id);
      toast.success('Approver group deleted.');
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
    <Layout title="Approver Groups" description="Groups of people who can decide an approval step">
      <div className={roleStyles.page}>
        <div className={roleStyles.header}>
          <div>
            <h1 className={roleStyles.title}>Approver Groups</h1>
            <p className={styles.intro}>
              A public group of eligible approvers. An approval step can name a group instead of one
              person — anyone in it may decide that step. A person is in a group when they are listed
              in it, or hold one of its roles.
            </p>
          </div>
          <Button icon={<Plus size={14} />} onClick={() => openEditor(null)}>
            New Group
          </Button>
        </div>

        {isLoading ? (
          <p className={styles.muted}>Loading…</p>
        ) : isError ? (
          <div className={styles.empty}>Couldn't load approver groups. Refresh to try again.</div>
        ) : groups.length === 0 ? (
          <div className={styles.empty} data-testid="approver-groups-empty">
            No approver groups yet. Create one, then choose "A public group of approvers" on an
            approval step.
          </div>
        ) : (
          <div className={roleStyles.roleList}>
            {groups.map((group) => (
              <div key={group._id} className={roleStyles.roleCard} data-testid="approver-group-card">
                <div className={roleStyles.roleIcon}>
                  <Users size={18} />
                </div>
                <div className={roleStyles.roleInfo}>
                  <div className={roleStyles.roleName}>
                    {group.label}
                    <span className={roleStyles.roleApiName}>{group.name}</span>
                  </div>
                  {group.description && <div className={roleStyles.roleDesc}>{group.description}</div>}
                  <div className={styles.chips}>
                    {(group.roleIds || []).map((r) => (
                      <span key={idOf(r)} className={styles.chip}>Role: {r.label || r.name}</span>
                    ))}
                    {(group.roleIds || []).length === 0 && (group.memberIds || []).length === 0 && (
                      <span className={styles.muted}>No members</span>
                    )}
                  </div>
                  <div className={roleStyles.roleObjectCount}>
                    {(group.memberIds || []).length} listed member{(group.memberIds || []).length === 1 ? '' : 's'}
                  </div>
                </div>
                <div className={roleStyles.roleActions}>
                  <Button variant="ghost" size="sm" icon={<Edit2 size={14} />} onClick={() => openEditor(group)} aria-label={`Edit ${group.label}`} />
                  <Button variant="ghost" size="sm" icon={<Trash2 size={14} />} onClick={() => remove(group)} aria-label={`Delete ${group.label}`} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal
        isOpen={!!editing}
        onClose={() => setEditing(null)}
        title={editing?._id ? `Edit ${editing.label || 'approver group'}` : 'New Approver Group'}
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
                placeholder="e.g. Claims Panel"
                onChange={(e) => setEditing((p) => ({ ...p, label: e.target.value }))}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Description</span>
              <input
                className={roleStyles.input}
                value={editing.description}
                placeholder="Who this group is for"
                onChange={(e) => setEditing((p) => ({ ...p, description: e.target.value }))}
              />
            </label>

            <fieldset className={styles.group}>
              <legend className={styles.label}>Everyone holding these roles</legend>
              <div className={roleStyles.permGrid}>
                {roles.map((role) => (
                  <label key={role._id} className={roleStyles.permItem}>
                    <input
                      type="checkbox"
                      checked={editing.roleIds.includes(idOf(role))}
                      onChange={() => toggle('roleIds', idOf(role))}
                    />
                    {role.label || role.name}
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className={styles.group}>
              <legend className={styles.label}>
                Listed members <span className={styles.muted}>({editing.memberIds.length})</span>
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
                      checked={editing.memberIds.includes(idOf(u))}
                      onChange={() => toggle('memberIds', idOf(u))}
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
