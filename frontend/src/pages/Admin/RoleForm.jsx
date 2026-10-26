import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Save, Shield, Eye, EyeOff, PenLine, ChevronDown, ChevronRight, ExternalLink, BookOpen } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../services/api';
import Button from '../../components/common/Button/Button';
import Layout from '../../layout/Layout';
import styles from './RoleForm.module.css';

const APP_PERMISSIONS = [
  { key: 'canManageUsers', label: 'Manage Users' },
  { key: 'canManageRoles', label: 'Manage Roles' },
  { key: 'canManageObjects', label: 'Manage Objects & Fields' },
  { key: 'canManageAutomations', label: 'Manage Automations' },
  { key: 'canManageIntegrations', label: 'Manage Integrations' },
  { key: 'canViewAnalytics', label: 'View Analytics' },
  { key: 'canManageAnalytics', label: 'Manage Analytics' },
  { key: 'canViewAuditLog', label: 'View Audit Logs' },
  { key: 'canManageTenantSettings', label: 'Manage Settings' },
  { key: 'canManageApiKeys', label: 'Manage API Keys' },
  { key: 'canManageWebhooks', label: 'Manage Webhooks' },
];

const OBJECT_ACTIONS = [
  { key: 'canCreate', label: 'Create' },
  { key: 'canRead', label: 'Read' },
  { key: 'canUpdate', label: 'Update' },
  { key: 'canDelete', label: 'Delete' },
  { key: 'canExport', label: 'Export' },
  { key: 'canImport', label: 'Import' },
];

// ─── Field Permissions Panel ──────────────────────────────────────────────────
const FieldPermissionsPanel = ({ objectApiName, fields, fieldPermissions = [], onChange, isReadOnly }) => {
  const getFieldPerm = (apiName) =>
    fieldPermissions.find((fp) => fp.fieldApiName === apiName) || {
      canView: true,
      canEdit: true,
    };

  const setFieldPerm = (fieldApiName, key, val) => {
    if (isReadOnly) return;
    const existing = fieldPermissions.filter((fp) => fp.fieldApiName !== fieldApiName);
    const current = getFieldPerm(fieldApiName);
    onChange([...existing, { fieldApiName, ...current, [key]: val }]);
  };

  if (!fields || fields.length === 0) {
    return <div className={styles.noFields}>No fields with permissions yet.</div>;
  }

  return (
    <div className={styles.fieldPermsTable}>
      <div className={styles.fieldPermsHeader}>
        <span>Field</span>
        <span>Type</span>
        <span>View</span>
        <span>Edit</span>
      </div>
      {fields
        .filter((f) => f.type !== 'auto_number' && f.type !== 'formula' && !f.isReadOnly)
        .map((field) => {
          const perm = getFieldPerm(field.apiName);
          return (
            <div key={field.apiName} className={styles.fieldPermRow} style={{ opacity: isReadOnly ? 0.6 : 1 }}>
              <span className={styles.fieldPermName}>{field.label}</span>
              <span className={styles.fieldPermType}>{field.type}</span>
              <button
                className={`${styles.permToggle} ${perm.canView !== false ? styles.allowed : styles.denied}`}
                onClick={() =>
                  setFieldPerm(field.apiName, 'canView', perm.canView === false ? true : false)
                }
                disabled={isReadOnly}
                title={isReadOnly ? 'Field permissions cannot be modified' : perm.canView !== false ? 'Visible — click to hide' : 'Hidden — click to show'}
                style={{ cursor: isReadOnly ? 'not-allowed' : 'pointer' }}
              >
                {perm.canView !== false ? <Eye size={14} /> : <EyeOff size={14} />}
              </button>
              <button
                className={`${styles.permToggle} ${perm.canEdit !== false ? styles.allowed : styles.denied}`}
                onClick={() =>
                  setFieldPerm(field.apiName, 'canEdit', perm.canEdit === false ? true : false)
                }
                disabled={isReadOnly}
                title={isReadOnly ? 'Field permissions cannot be modified' : perm.canEdit !== false ? 'Editable — click to make read-only' : 'Read-only — click to allow editing'}
                style={{ cursor: isReadOnly ? 'not-allowed' : 'pointer' }}
              >
                {perm.canEdit !== false ? <PenLine size={14} /> : <EyeOff size={14} />}
              </button>
            </div>
          );
        })}
    </div>
  );
};

// ─── Object Permissions Row ───────────────────────────────────────────────────
const ObjectPermRow = ({ object, objPerm, allFields, onCrudChange, onFieldPermChange, isReadOnly }) => {
  const [expanded, setExpanded] = useState(false);
  const [loadingFields, setLoadingFields] = useState(false);
  const [fields, setFields] = useState(allFields || []);

  const fetchFields = async () => {
    if (fields.length > 0) {
      setExpanded((e) => !e);
      return;
    }
    setLoadingFields(true);
    try {
      const res = await api.get(`/objects/${object.apiName}`);
      setFields(res.data.data.fields || []);
      setExpanded(true);
    } catch {
      toast.error('Failed to load fields.');
    } finally {
      setLoadingFields(false);
    }
  };

  return (
    <div className={styles.objPermBlock}>
      <div className={styles.objPermHeader}>
        <div className={styles.objPermName}>
          <div className={styles.objColor} style={{ background: `${object.color || '#6366f1'}20`, color: object.color || '#6366f1' }}>
            <Shield size={14} />
          </div>
          <span>{object.label}</span>
          <span className={styles.objApiName}>{object.apiName}</span>
        </div>
        <div className={styles.objCrudToggles}>
          {OBJECT_ACTIONS.map((action) => (
            <label key={action.key} className={styles.crudLabel} style={{ opacity: isReadOnly ? 0.6 : 1, pointerEvents: isReadOnly ? 'none' : 'auto', cursor: isReadOnly ? 'not-allowed' : 'pointer' }}>
              <span>{action.label}</span>
              <input
                type="checkbox"
                checked={!!objPerm?.[action.key]}
                onChange={(e) => onCrudChange(object.apiName, action.key, e.target.checked)}
                disabled={isReadOnly}
              />
            </label>
          ))}
        </div>
        <button className={styles.expandFieldsBtn} onClick={fetchFields} disabled={loadingFields} title="Field-level permissions">
          {loadingFields ? <span className={styles.miniSpinner} /> : expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          Fields
        </button>
      </div>

      {expanded && (
        <div className={styles.fieldPermsWrapper}>
          <FieldPermissionsPanel
            objectApiName={object.apiName}
            fields={fields}
            fieldPermissions={objPerm?.fieldPermissions || []}
            onChange={(fps) => onFieldPermChange(object.apiName, fps)}
            isReadOnly={isReadOnly}
          />
        </div>
      )}
    </div>
  );
};

const RoleForm = () => {
  const { roleId } = useParams();
  const navigate = useNavigate();
  const isEdit = !!roleId;

  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('basic');
  const [roleUsers, setRoleUsers] = useState([]);
  const [loadingRoleUsers, setLoadingRoleUsers] = useState(false);
  const [objects, setObjects] = useState([]);
  const [isReadOnly, setIsReadOnly] = useState(false);
  const [existingRoleNames, setExistingRoleNames] = useState([]);

  const [form, setForm] = useState({
    name: '',
    label: '',
    description: '',
    dataAccess: 'own',
    appPermissions: {},
    objectPermissions: [],
  });

  useEffect(() => {
    if (isEdit) {
      fetchRole();
      fetchObjects();
    } else {
      fetchObjects();
    }
  }, [roleId]);

  useEffect(() => {
    if (isEdit && activeTab === 'users') {
      loadRoleUsers();
    }
  }, [activeTab, isEdit, roleId]);

  const fetchRole = async () => {
    try {
      const res = await api.get(`/roles/${roleId}`);
      const role = res.data.data;
      setForm(role);
      // Check if role is editable
      if (role.isEditable === false || role.name?.toLowerCase() === 'superuser') {
        setIsReadOnly(true);
      }
    } catch (err) {
      toast.error('Failed to load role.');
      navigate('/admin/roles');
    } finally {
      setLoading(false);
    }
  };

  const fetchObjects = async () => {
    try {
      const res = await api.get('/objects');
      setObjects(res.data.data || []);
    } catch (err) {
      toast.error('Failed to load objects.');
    }
  };

  const fetchExistingRoleNames = async () => {
    try {
      const res = await api.get('/roles');
      const names = (res.data.data || []).map((r) => r.name);
      setExistingRoleNames(names);
    } catch {
      // non-fatal — uniqueness check degrades gracefully
    }
  };

  useEffect(() => { fetchExistingRoleNames(); }, []);

  const toUniqueApiName = (base, currentName) => {
    // Strip the current role's own name from the taken list when editing
    const taken = existingRoleNames.filter((n) => n !== currentName);
    if (!taken.includes(base)) return base;
    let i = 1;
    while (taken.includes(`${base}${i}`)) i++;
    return `${base}${i}`;
  };

  const loadRoleUsers = async () => {
    setLoadingRoleUsers(true);
    try {
      const res = await api.get(`/users/role/${roleId}`);
      setRoleUsers(res.data.data || []);
    } catch {
      setRoleUsers([]);
    } finally {
      setLoadingRoleUsers(false);
    }
  };

  const handleSave = async () => {
    if (!form.label.trim()) {
      toast.error('Label is required');
      return;
    }
    if (!form.name.trim()) {
      toast.error('API Name is required');
      return;
    }

    setSaving(true);
    try {
      if (isEdit) {
        await api.put(`/roles/${roleId}`, form);
        toast.success('Role updated.');
      } else {
        await api.post('/roles', form);
        toast.success('Role created.');
      }
      navigate('/admin/roles');
    } catch (err) {
      toast.error(err.message || 'Failed to save role.');
    } finally {
      setSaving(false);
    }
  };

  const toggleAppPermission = (key) => {
    if (isReadOnly) return;
    setForm((prev) => ({
      ...prev,
      appPermissions: {
        ...prev.appPermissions,
        [key]: !prev.appPermissions[key],
      },
    }));
  };

  const handleObjCrudChange = useCallback((objectApiName, actionKey, value) => {
    setForm((prev) => {
      const existing = prev.objectPermissions.find((p) => p.objectApiName === objectApiName) || { objectApiName };
      const updated = prev.objectPermissions.filter((p) => p.objectApiName !== objectApiName);
      return { ...prev, objectPermissions: [...updated, { ...existing, [actionKey]: value }] };
    });
  }, []);

  const handleFieldPermChange = useCallback((objectApiName, fieldPermissions) => {
    setForm((prev) => {
      const existing = prev.objectPermissions.find((p) => p.objectApiName === objectApiName) || { objectApiName };
      const updated = prev.objectPermissions.filter((p) => p.objectApiName !== objectApiName);
      return { ...prev, objectPermissions: [...updated, { ...existing, fieldPermissions }] };
    });
  }, []);

  const getObjPerm = (apiName) => form.objectPermissions.find((p) => p.objectApiName === apiName);

  if (loading) {
    return (
      <Layout title={isEdit ? 'Edit Role' : 'New Role'}>
        <div className={styles.loading}>
          <div className={styles.spinner} />
        </div>
      </Layout>
    );
  }

  return (
    <Layout title={isEdit ? `Edit: ${form.label}` : 'New Role'}>
      <div className={styles.page}>
        {/* Header */}
        <div className={styles.header}>
          <div>
            <Link to="/admin/roles" className={styles.breadcrumb}>
              <ArrowLeft size={16} />
              <span>Back to Roles</span>
            </Link>
            {isReadOnly && (
              <div style={{ marginTop: '8px', padding: '8px 12px', backgroundColor: '#f0f9ff', borderLeft: '4px solid #0ea5e9', borderRadius: '4px', fontSize: '13px', color: '#0369a1', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <BookOpen size={16} />
                This role is read-only and cannot be modified
              </div>
            )}
          </div>
          <div className={styles.actions}>
            <Link to="/admin/roles">
              <Button variant="secondary">Cancel</Button>
            </Link>
            {!isReadOnly && (
              <Button icon={<Save size={14} />} loading={saving} onClick={handleSave}>
                {isEdit ? 'Save Changes' : 'Create Role'}
              </Button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className={styles.tabs}>
          {['basic', 'app permissions', 'object permissions', ...(isEdit ? ['users'] : [])].map((tab) => (
            <button
              key={tab}
              className={`${styles.tab} ${activeTab === tab ? styles.activeTab : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab === 'app permissions' ? 'App Permissions' : tab === 'object permissions' ? 'Object Permissions' : tab.charAt(0).toUpperCase() + tab.slice(1)}
              {tab === 'users' && roleUsers.length > 0 && ` (${roleUsers.length})`}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className={styles.content}>
          {activeTab === 'basic' && (
            <div className={styles.section}>
              {isEdit && form._id && (
                <div style={{ marginBottom: '20px', padding: '12px', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '13px' }}>
                  <div style={{ color: '#64748b', marginBottom: '4px' }}>Currently Editing Role:</div>
                  <div style={{ fontWeight: '600', color: '#1e293b' }}>{form.label}</div>
                  {form.name && <div style={{ color: '#64748b', marginTop: '4px', fontSize: '12px' }}>API Name: <code style={{ backgroundColor: '#e2e8f0', padding: '2px 6px', borderRadius: '3px' }}>{form.name}</code></div>}
                </div>
              )}
              <div className={styles.formGrid}>
                <div className={styles.field}>
                  <label className={styles.label}>Label *</label>
                  <input
                    className={styles.input}
                    value={form.label}
                    onChange={(e) => {
                      const label = e.target.value;
                      const base = label.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '').replace(/_+/g, '_').replace(/^_|_$/g, '');
                      setForm((p) => ({
                        ...p,
                        label,
                        name: toUniqueApiName(base, p.name),
                      }));
                    }}
                    placeholder="e.g. Sales Manager"
                    disabled={isReadOnly}
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>API Name *</label>
                  <input
                    className={styles.input}
                    value={form.name}
                    readOnly
                    style={{ background: 'var(--color-gray-50, #f8fafc)', cursor: 'default', color: 'var(--color-gray-500, #64748b)' }}
                    placeholder="auto-generated"
                  />
                </div>
                <div className={`${styles.field} ${styles.fullWidth}`}>
                  <label className={styles.label}>Description</label>
                  <textarea
                    className={styles.textarea}
                    value={form.description}
                    onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                    placeholder="Description of this role"
                    rows={3}
                    disabled={isReadOnly}
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>Data Access</label>
                  <select
                    className={styles.input}
                    value={form.dataAccess}
                    onChange={(e) => setForm((p) => ({ ...p, dataAccess: e.target.value }))}
                    disabled={isReadOnly}
                  >
                    <option value="all">All Records</option>
                    <option value="own_and_subordinates">Own & Subordinates</option>
                    <option value="own">Own Records Only</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'app permissions' && (
            <div className={styles.section}>
              <p className={styles.sectionDescription}>Control which administrative features this role can access.</p>
              <div className={styles.permGrid}>
                {APP_PERMISSIONS.map((p) => (
                  <label key={p.key} className={styles.permItem} style={{ opacity: isReadOnly ? 0.6 : 1, pointerEvents: isReadOnly ? 'none' : 'auto', cursor: isReadOnly ? 'not-allowed' : 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={!!form.appPermissions[p.key]}
                      onChange={() => toggleAppPermission(p.key)}
                      disabled={isReadOnly}
                    />
                    {p.label}
                  </label>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'object permissions' && (
            <div className={styles.section}>
              <p className={styles.sectionDescription}>
                Set CRUD permissions per object, and optionally restrict individual field visibility and editability.
              </p>
              {objects.map((obj) => (
                <ObjectPermRow
                  key={obj._id || obj.apiName}
                  object={obj}
                  objPerm={getObjPerm(obj.apiName)}
                  allFields={[]}
                  onCrudChange={handleObjCrudChange}
                  onFieldPermChange={handleFieldPermChange}
                  isReadOnly={isReadOnly}
                />
              ))}
            </div>
          )}

          {activeTab === 'users' && isEdit && (
            <div className={styles.section}>
              <p className={styles.sectionDescription}>
                Users currently assigned this role.
                <Link to="/admin/users" style={{ color: 'var(--color-primary)', marginLeft: 8 }}>
                  Manage in Users →
                </Link>
              </p>
              {loadingRoleUsers ? (
                <div style={{ padding: 20, textAlign: 'center', color: 'var(--color-gray-400)' }}>Loading…</div>
              ) : roleUsers.length === 0 ? (
                <div style={{ padding: 20, textAlign: 'center', color: 'var(--color-gray-400)', border: '1px dashed var(--border-color)', borderRadius: 'var(--border-radius)' }}>
                  No users are assigned this role.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {roleUsers.map((u) => (
                    <div key={u._id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', border: '1px solid var(--border-color)', borderRadius: 'var(--border-radius)', background: 'var(--color-white)' }}>
                      <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--color-primary-light)', color: 'var(--color-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
                        {u.firstName?.[0]}
                        {u.lastName?.[0]}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 500 }}>
                          {u.firstName} {u.lastName}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--color-gray-400)' }}>{u.email}</div>
                      </div>
                      {u.title && <span style={{ fontSize: 11, color: 'var(--color-gray-500)' }}>{u.title}</span>}
                      <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 10, background: u.status === 'active' ? '#dcfce7' : '#fee2e2', color: u.status === 'active' ? '#166534' : '#991b1b' }}>
                        {u.status}
                      </span>
                      <Link to={`/admin/users/${u._id}`} style={{ color: 'var(--color-gray-400)', display: 'flex' }}>
                        <ExternalLink size={13} />
                      </Link>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
};

export default RoleForm;
