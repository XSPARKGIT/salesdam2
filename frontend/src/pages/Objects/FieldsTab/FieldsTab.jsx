import styles from './FieldsTab.module.css';
import { Link } from 'react-router-dom';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, LayoutGrid as LayoutIcon } from 'lucide-react';
import toast from 'react-hot-toast';
import { getFields, deleteField } from '../../../services/api/objects';
import Button from '../../../components/common/Button/Button';
import FieldModal from '../FieldModal/FieldModal';

const FieldsTab = ({ objectApiName, allObjects = [] }) => {
  const queryClient = useQueryClient();

  const [fieldModalOpen, setFieldModalOpen] = useState(false);
  const [editingField, setEditingField] = useState(null);

  const { data: fields = [], isLoading } = useQuery({
    queryKey: ['fields', objectApiName],
    queryFn: () => getFields(objectApiName),
    enabled: !!objectApiName,
  });

  const openFieldModal = (field = null) => {
    setEditingField(field);
    setFieldModalOpen(true);
  };

  // The record list caches its own copy of the field metadata under a different
  // key, so both have to be dropped or new columns won't be selectable there.
  const invalidateFields = () => {
    queryClient.invalidateQueries({ queryKey: ['fields', objectApiName] });
    queryClient.invalidateQueries({ queryKey: ['object-fields', objectApiName] });
    // Invalidate the object itself so ObjectBuilder's fields list (used by the
    // junction warning in DetailsTab) reflects the new field immediately.
    queryClient.invalidateQueries({ queryKey: ['object', objectApiName] });
  };

  const handleFieldSaved = () => {
    invalidateFields();
    setFieldModalOpen(false);
  };

  const handleDeleteField = async (field) => {
    if (field.isSystem) {
      toast.error('System fields cannot be deleted. This field is part of the object structure.');
      return;
    }

    if (!window.confirm(`Delete field "${field.label}"?`)) return;

    try {
      await deleteField(objectApiName, field.apiName);
      toast.success('Field deleted.');
      invalidateFields();
    } catch (err) {
      toast.error(err.message || 'Delete failed.');
    }
  };

  if (isLoading) {
    return <div className={styles.fieldsSection}>Loading...</div>;
  }

  return (
    <div className={styles.fieldsSection}>
      <div className={styles.fieldsHeader}>
        <h3 className={styles.fieldsTitle}>Fields</h3>

        <div className={styles.headerActions}>
          <Link
            to={`/setup/objects/${objectApiName}/layout`}
            state={{ from: `/setup/objects/${objectApiName}?tab=fields` }}
          >
            <Button
              variant="secondary"
              size="sm"
              icon={<LayoutIcon size={14} />}
            >
              Edit Layout
            </Button>
          </Link>

          <Button
            size="sm"
            icon={<Plus size={14} />}
            onClick={() => openFieldModal()}
          >
            Add Field
          </Button>
        </div>
      </div>

      <div className={styles.fieldsList}>
        {fields.map((f) => (
          <div key={f.apiName} className={styles.fieldRow}>
            <div className={styles.fieldInfo}>
              <span className={styles.fieldLabel}>{f.label}</span>
              <span className={styles.fieldApiName}>{f.apiName}</span>
            </div>

            <div className={styles.fieldMeta}>
              <span className={styles.fieldType}>{f.type}</span>
              {f.isRequired && (
                <span className={styles.reqBadge}>Required</span>
              )}
              {f.isSystem && <span className={styles.sysBadge}>System</span>}
            </div>

            <div className={styles.fieldActions}>
              <button
                className={styles.editFieldBtn}
                onClick={() => openFieldModal(f)}
                title={f.isSystem ? 'Edit label only (system field)' : 'Edit field'}
              >
                <Pencil size={14} />
              </button>

              {!f.isSystem && (
                <button
                  className={styles.deleteFieldBtn}
                  onClick={() => handleDeleteField(f)}
                  title="Delete field"
                >
                  <Trash2 size={14} />
                </button>
              )}

              {f.isSystem && (
                <span
                  className={styles.systemFieldNote}
                  title="System fields are protected. Only the label can be edited."
                >
                  Protected
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      <FieldModal
        isOpen={fieldModalOpen}
        onClose={() => setFieldModalOpen(false)}
        editingField={editingField}
        objectApiName={objectApiName}
        // Without this the formula editor's field browser renders empty.
        fields={fields || []}
        allObjects={allObjects}
        onFieldSaved={handleFieldSaved}
      />
    </div>
  );
};

export default FieldsTab;
