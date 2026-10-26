import styles from './ObjectBuilder.module.css';
import { useEffect, useState } from 'react';
import {
  useParams,
  useNavigate,
  useSearchParams,
  Link,
} from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Save, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import Button from '../../components/common/Button/Button';
import {
  getObjectConfig,
  updateObjectConfig,
} from '../../services/api/objectConfig';
import {
  getObject,
  getObjects,
  createObject,
  updateObject,
  deleteObject,
} from '../../services/api/objects';
import Layout from '../../layout/Layout';
import { useTenantContext } from '../../context/TenantContext';
import DeleteObjectModal from './DeleteObjectModal/DeleteObjectModal';
import DetailsTab from './DetailsTab/DetailsTab';
import FieldsTab from './FieldsTab/FieldsTab';
import ActionsTab from './ActionsTab/ActionsTab';
import ActionButtonModal from './ActionButtonModal/ActionButtonModal';
import ValidationsTab from './ValidationsTab/ValidationsTab';
import ValidationRuleModal from './ValidationRuleModal/ValidationRuleModal';
import { pluralize } from '../../utils/pluralize';

const toApiName = (value) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');

const ObjectBuilder = () => {
  const { apiName } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { refreshObjects } = useTenantContext();
  const isEdit = !!apiName;

  // Once the user edits the name field's API name by hand we stop deriving it
  // from the label.
  const [nameFieldApiNameTouched, setNameFieldApiNameTouched] = useState(false);

  const [objForm, setObjForm] = useState({
    name: '',
    label: '',
    pluralLabel: '',
    apiName: '',
    description: '',
    icon: 'Box',
    color: '#6366f1',
    showInNav: true,
    navOrder: 100,
    sharingModel: 'private',
    nameFieldType: 'text',
    nameFieldLabel: 'Name',
    nameFieldApiName: 'name',
    autoNumberPrefix: '',
    autoNumberPadding: 5,
    autoNumberStartAt: 1,
    kanbanConfig: {
      enabled: false,
      fieldApiName: '',
    },
    // Object-level settings (BRD §3.1.1)
    isActive: true,
    enableHistory: false,
    enableActivities: true,
    enableNotes: true,
    searchable: true,
    hasRecordTypes: false,
    isJunctionObject: false,
  });
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const [btnModalOpen, setBtnModalOpen] = useState(false);
  const [editingBtnIndex, setEditingBtnIndex] = useState(null);
  const [editingBtnData, setEditingBtnData] = useState(null);

  // Validation rules
  const [validationRules, setValidationRules] = useState([]);
  const [savingRules, setSavingRules] = useState(false);
  const [vrModalOpen, setVrModalOpen] = useState(false);
  const [editingVrIndex, setEditingVrIndex] = useState(null);
  const [editingVrData, setEditingVrData] = useState(null);

  // Object config (lead/case)
  const [objectConfig, setObjectConfig] = useState(null);
  const [savingConfig, setSavingConfig] = useState(false);

  // Tracks the last objectData payload we've synced into objForm, so we
  // can derive state during render instead of via a useEffect + setState
  // (which causes an extra cascading render pass).
  const [loadedObjectData, setLoadedObjectData] = useState(null);

  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'details';
  const setActiveTab = (tab) => setSearchParams({ tab }, { replace: true });

  const { data: allObjects } = useQuery({
    queryKey: ['all-Objects'],
    queryFn: () => getObjects(),
    onError: () => toast.error('Failed to load objects.'),
  });

  const { data: objectData, isLoading: loading } = useQuery({
    queryKey: ['object', apiName],
    queryFn: () => getObject(apiName),
    enabled: isEdit && !!apiName,
  });

  // Adjust state during render when fresh objectData arrives — avoids
  // the cascading-render pattern of setState inside a useEffect.
  if (objectData && objectData !== loadedObjectData) {
    setLoadedObjectData(objectData);
    setObjForm({
      name: objectData.name,
      label: objectData.label,
      pluralLabel: objectData.pluralLabel,
      apiName: objectData.apiName,
      description: objectData.description || '',
      icon: objectData.icon || 'Box',
      color: objectData.color || '#6366f1',
      showInNav: objectData.showInNav,
      navOrder: objectData.navOrder,
      sharingModel: objectData.sharingModel,
      // Read-only on edit, but needed so the Details tab can resolve which
      // field is the name field.
      nameFieldApiName: objectData.nameFieldApiName || 'name',
      kanbanConfig: objectData.kanbanConfig || {
        enabled: false,
        fieldApiName: '',
      },
      // Object-level settings
      isActive: objectData.isActive !== false,
      enableHistory: objectData.enableHistory || false,
      enableActivities: objectData.enableActivities !== false,
      enableNotes: objectData.enableNotes !== false,
      searchable: objectData.searchable !== false,
      hasRecordTypes: objectData.hasRecordTypes || false,
      isJunctionObject: objectData.isJunctionObject || false,
    });
    setValidationRules(objectData.validationRules || []);
  }

  useEffect(() => {
    if (isEdit && (apiName === 'lead' || apiName === 'case')) {
      getObjectConfig(apiName)
        .then((res) => setObjectConfig(res.data.data))
        .catch(() => {});
    }
  }, [apiName, isEdit]);

  const handleObjChange = (e) => {
    const { name, value, type, checked } = e.target;
    if (name === 'nameFieldApiName') setNameFieldApiNameTouched(true);
    setObjForm((prev) => {
      // Handle nested kanbanConfig object
      if (name === 'kanbanConfig') {
        return { ...prev, kanbanConfig: value };
      }

      let coerced = type === 'checkbox' ? checked : value;
      if (name === 'autoNumberPadding') coerced = parseInt(value) || 1;
      if (name === 'autoNumberStartAt') coerced = parseInt(value) || 1;
      if (name === 'nameFieldApiName') coerced = toApiName(value);
      const updated = { ...prev, [name]: coerced };
      if (name === 'label' && !isEdit) {
        updated.name = value;
        updated.apiName = toApiName(value);
        updated.pluralLabel = pluralize(value);
      }
      // Keep the name field's API name in step with its label until the user
      // overrides it themselves.
      if (name === 'nameFieldLabel' && !isEdit && !nameFieldApiNameTouched) {
        updated.nameFieldApiName = toApiName(value);
      }
      return updated;
    });
  };

  const handleSaveObject = async () => {
    setSaving(true);
    try {
      if (isEdit) {
        await updateObject(apiName, {
          ...objForm,
          validationRules,
        });
        // Invalidate all object caches so the list and detail both reflect the update
        queryClient.invalidateQueries({ queryKey: ['objects'] });
        queryClient.invalidateQueries({ queryKey: ['object', apiName] });
        queryClient.invalidateQueries({ queryKey: ['record-list-bundle'] });
        queryClient.invalidateQueries({ queryKey: ['objects', 'includeInactive'] });
        refreshObjects();
        toast.success('Object updated.');
      } else {
        const {
          nameFieldType,
          nameFieldLabel,
          nameFieldApiName,
          autoNumberPrefix,
          autoNumberPadding,
          autoNumberStartAt,
          ...rest
        } = objForm;
        // Blank values fall back to the defaults the backend also applies.
        const resolvedLabel = nameFieldLabel?.trim() || 'Name';
        const res = await createObject({
          ...rest,
          nameFieldType: nameFieldType || 'text',
          nameFieldLabel: resolvedLabel,
          nameFieldApiName:
            nameFieldApiName?.trim() || toApiName(resolvedLabel) || 'name',
          autoNumberPrefix: autoNumberPrefix || '',
          autoNumberPadding: parseInt(autoNumberPadding) || 5,
          autoNumberStartAt: parseInt(autoNumberStartAt) || 1,
        });

        const newApiName = res?.apiName;

        // Invalidate objects cache so it reloads with the new object
        queryClient.invalidateQueries({ queryKey: ['objects'] });

        toast.success('Object created.');
        navigate(`/setup/objects/${newApiName}`);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  // Only user-created objects can be deleted; the backend enforces this too.
  const canDelete =
    isEdit && !!objectData?.isCustom && !objectData?.isSystem;

  const handleDeleteObject = async () => {
    try {
      const result = await deleteObject(apiName);
      const { recordCount, fieldCount } = result || {};
      toast.success(
        typeof recordCount === 'number'
          ? `Deleted "${objForm.label}" — ${recordCount} record(s) and ${fieldCount} field(s) removed.`
          : 'Object deleted.',
      );
      setDeleteOpen(false);
      // Drop the cached object and refresh the sidebar before navigating away,
      // otherwise the deleted object lingers in the nav.
      queryClient.removeQueries({ queryKey: ['object', apiName] });
      queryClient.invalidateQueries({ queryKey: ['objects'] });
      queryClient.invalidateQueries({ queryKey: ['objects', 'includeInactive'] });
      refreshObjects();
      navigate('/setup/objects');
    } catch (err) {
      toast.error(err.message || 'Delete failed.');
      throw err;
    }
  };

  const handleSaveConfig = async () => {
    if (!objectConfig) return;
    setSavingConfig(true);
    try {
      const res = await updateObjectConfig(apiName, objectConfig);
      setObjectConfig(res.data.data);
      toast.success('Settings saved.');
    } catch (err) {
      toast.error(err.message || 'Save failed.');
    } finally {
      setSavingConfig(false);
    }
  };

  /**
   * Writes the whole rule list to the server straight away.
   *
   * Rules used to be staged in local state and only persisted when the admin
   * also pressed the object-level "Save Changes" button, which lost them two
   * ways: navigating away without pressing Save discarded the rule silently,
   * and any refetch of the object query resynced local state from the server
   * (see the render-time sync above), wiping a staged rule mid-session.
   *
   * @returns {Promise<boolean>} whether the save succeeded
   */
  const persistValidationRules = async (next, successMessage) => {
    const previous = validationRules;
    setValidationRules(next); // optimistic; rolled back below if the save fails
    setSavingRules(true);
    try {
      const updated = await updateObject(apiName, { validationRules: next });

      // Keep the cached object in step without triggering a refetch. `fields` is
      // added by the GET endpoint and absent from the PUT response, so it has to
      // be carried over. Pointing loadedObjectData at the same reference stops
      // the render-time sync from firing, which would otherwise also throw away
      // unsaved edits on the Details tab.
      const merged = { ...objectData, ...updated, fields: objectData?.fields };
      queryClient.setQueryData(['object', apiName], merged);
      setLoadedObjectData(merged);
      setValidationRules(merged.validationRules || []);

      // Records are validated against these rules on save, so the list bundle's
      // copy of the object metadata is now stale.
      queryClient.invalidateQueries({ queryKey: ['record-list-bundle'] });
      toast.success(successMessage);
      return true;
    } catch (err) {
      setValidationRules(previous);
      toast.error(err.message || 'Failed to save validation rule.');
      return false;
    } finally {
      setSavingRules(false);
    }
  };

  const handleSaveValidationRule = (vrData, editingIndex) =>
    persistValidationRules(
      editingIndex !== null
        ? validationRules.map((r, i) =>
            i === editingIndex ? { ...r, ...vrData } : r,
          )
        : [...validationRules, { id: `vr_${Date.now()}`, ...vrData }],
      editingIndex !== null ? 'Validation rule updated.' : 'Validation rule added.',
    );

  const handleDeleteValidationRule = (index) =>
    persistValidationRules(
      validationRules.filter((_, i) => i !== index),
      'Validation rule deleted.',
    );

  const handleToggleValidationRule = (index, isActive) =>
    persistValidationRules(
      validationRules.map((r, i) => (i === index ? { ...r, isActive } : r)),
      isActive ? 'Rule activated.' : 'Rule deactivated.',
    );

  if (loading) {
    return (
      <Layout
        title={isEdit ? `Edit: ${objForm.label}` : 'New Object'}
        description="Configure object fields, actions, and settings"
      >
        <div className={styles.loading}>
          <div className={styles.spinner} />
        </div>
      </Layout>
    );
  }

  return (
    <Layout
      title={isEdit ? `Edit: ${objForm.label}` : 'New Object'}
      description="Configure object fields, actions, and settings"
    >
      <div className={styles.page}>
        <div className={styles.header}>
          <Link to="/setup/objects" className={styles.backLink}>
            <ArrowLeft size={16} /> Back to Objects
          </Link>
          <div className={styles.headerRow}>
            <h1 className={styles.title}>
              {isEdit ? `Edit: ${objForm.label}` : 'New Object'}
            </h1>
            <div className={styles.headerActions}>
              {canDelete && (
                <Button
                  variant="danger"
                  icon={<Trash2 size={14} />}
                  onClick={() => setDeleteOpen(true)}
                >
                  Delete Object
                </Button>
              )}
              <Button
                icon={<Save size={14} />}
                loading={saving}
                onClick={handleSaveObject}
              >
                {isEdit ? 'Save Changes' : 'Create Object'}
              </Button>
            </div>
          </div>
        </div>

        <div className={styles.tabs}>
          <button
            className={`${styles.tab} ${activeTab === 'details' ? styles.activeTab : ''}`}
            onClick={() => setActiveTab('details')}
          >
            Object Details
          </button>
          {isEdit && (
            <button
              className={`${styles.tab} ${activeTab === 'fields' ? styles.activeTab : ''}`}
              onClick={() => setActiveTab('fields')}
            >
              Fields
            </button>
          )}
          {isEdit && (
            <button
              className={`${styles.tab} ${activeTab === 'actions' ? styles.activeTab : ''}`}
              onClick={() => setActiveTab('actions')}
            >
              Action Buttons
            </button>
          )}
          {isEdit && (
            <button
              className={`${styles.tab} ${activeTab === 'validations' ? styles.activeTab : ''}`}
              onClick={() => setActiveTab('validations')}
            >
              Validations ({validationRules?.length})
            </button>
          )}
          {isEdit && (
            <button
              className={styles.tab}
              onClick={() => navigate(`/setup/objects/${apiName}/layout`)}
            >
              Layout
            </button>
          )}
        </div>

        {activeTab === 'details' && (
          <DetailsTab
            objForm={objForm}
            onChange={handleObjChange}
            isEdit={isEdit}
            onIconChange={(val) => setObjForm((p) => ({ ...p, icon: val }))}
            fields={objectData?.fields || []}
          />
        )}

        {activeTab === 'fields' && isEdit && (
          <FieldsTab objectApiName={apiName} allObjects={allObjects} />
        )}

        {activeTab === 'actions' && isEdit && (
          <ActionsTab
            objectApiName={apiName}
            onAddButton={() => {
              setEditingBtnIndex(null);
              setEditingBtnData(null);
              setBtnModalOpen(true);
            }}
            onEditButton={(i, btn) => {
              setEditingBtnIndex(i);
              setEditingBtnData(btn);
              setBtnModalOpen(true);
            }}
          />
        )}

        {activeTab === 'validations' && isEdit && (
          <ValidationsTab
            validationRules={validationRules}
            onAddRule={() => {
              setEditingVrIndex(null);
              setEditingVrData(null);
              setVrModalOpen(true);
            }}
            onEditRule={(i, rule) => {
              setEditingVrIndex(i);
              setEditingVrData(rule);
              setVrModalOpen(true);
            }}
            onDeleteRule={handleDeleteValidationRule}
            onToggleRule={handleToggleValidationRule}
            saving={savingRules}
          />
        )}


        <ActionButtonModal
          objectApiName={apiName}
          isOpen={btnModalOpen}
          onClose={() => setBtnModalOpen(false)}
          editingIndex={editingBtnIndex}
          initialData={editingBtnData}
        />

        <ValidationRuleModal
          isOpen={vrModalOpen}
          onClose={() => setVrModalOpen(false)}
          editingIndex={editingVrIndex}
          initialData={editingVrData}
          apiName={apiName}
          // Without this the expression editor's field list renders empty.
          fields={objectData?.fields || []}
          onSave={handleSaveValidationRule}
        />

        <DeleteObjectModal
          isOpen={deleteOpen}
          onClose={() => setDeleteOpen(false)}
          object={objectData}
          fieldCount={objectData?.fields?.length}
          onConfirm={handleDeleteObject}
        />
      </div>
    </Layout>
  );
};

export default ObjectBuilder;
