import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import Modal from '../../../components/common/Modal/Modal';
import Button from '../../../components/common/Button/Button';
import FormulaEditor from '../../../components/common/FormulaEditor/FormulaEditor';
import styles from './ValidationRuleModal.module.css';

const DEFAULT_VR = {
  name: '',
  description: '',
  expression: '',
  errorMessage: 'Validation failed.',
  errorField: '',
  isActive: true,
};

// Must match VALIDATION_RULE_LIMITS in backend/models/ObjectMeta.js, which the
// schema and the object controller both enforce.
const LIMITS = {
  name: 80,
  description: 255,
  expression: 1000,
  errorMessage: 255,
};

export default function ValidationRuleModal({
  isOpen,
  onClose,
  editingIndex,
  initialData,
  apiName,
  fields,
  onSave,
}) {
  const [vrForm, setVrForm] = useState(DEFAULT_VR);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setVrForm(
        initialData
          ? {
              name: initialData.name,
              description: initialData.description || '',
              expression: initialData.expression,
              errorMessage: initialData.errorMessage,
              errorField: initialData.errorField || '',
              isActive: initialData.isActive !== false,
            }
          : { ...DEFAULT_VR },
      );
    }
  }, [isOpen, initialData]);

  const handleSave = async () => {
    if (!vrForm.name.trim()) {
      toast.error('Rule name is required.');
      return;
    }
    if (!vrForm.expression.trim()) {
      toast.error('Expression is required.');
      return;
    }
    if (!vrForm.errorMessage.trim()) {
      toast.error('An error message is required — it is what the user sees.');
      return;
    }
    // Belt-and-braces: maxLength on the inputs stops typing past the cap, but a
    // paste into a pre-existing over-long value would otherwise slip through.
    for (const [key, limit] of Object.entries(LIMITS)) {
      if ((vrForm[key] || '').trim().length > limit) {
        toast.error(`${key} must be ${limit} characters or fewer.`);
        return;
      }
    }
    // The rule is persisted immediately, so the modal has to wait for the result
    // and stay open if the server rejects it — closing on failure would throw
    // away everything the admin just typed.
    setSaving(true);
    try {
      const ok = await onSave(vrForm, editingIndex);
      if (ok !== false) onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        editingIndex !== null
          ? `Edit Rule: ${vrForm.name || 'Untitled'}`
          : 'New Validation Rule'
      }
      size="xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} loading={saving}>
            {editingIndex !== null ? 'Save Changes' : 'Add Rule'}
          </Button>
        </>
      }
    >
      <div className={styles.content}>
        <div className={styles.fieldGroup}>
          <label className={styles.label}>Rule Name *</label>
          <input
            className={styles.input}
            value={vrForm.name}
            onChange={(e) => setVrForm((p) => ({ ...p, name: e.target.value }))}
            placeholder="e.g. Phone must be 10 digits"
            maxLength={LIMITS.name}
            autoFocus
          />
        </div>

        <div className={styles.fieldGroup}>
          <label className={styles.label}>
            Description{' '}
            <span className={styles.optional}>(optional)</span>
          </label>
          <input
            className={styles.input}
            value={vrForm.description}
            onChange={(e) => setVrForm((p) => ({ ...p, description: e.target.value }))}
            placeholder="Explain what this rule enforces"
            maxLength={LIMITS.description}
          />
        </div>

        <label className={styles.toggleCard}>
          <input
            type="checkbox"
            className={styles.toggleInput}
            checked={vrForm.isActive}
            onChange={(e) => setVrForm((p) => ({ ...p, isActive: e.target.checked }))}
          />
          <span className={styles.toggleText}>
            <span className={styles.toggleTitle}>Active</span>
            <span className={styles.toggleHint}>
              Enforced every time a record is saved. An inactive rule is kept and
              can be switched back on at any time, but is skipped on save.
            </span>
          </span>
        </label>

        <div className={styles.fieldGroup}>
          <label className={styles.label}>Expression &amp; Error Message *</label>
          <p className={styles.hint}>
            Write the condition you want to <strong>reject</strong>. When the
            expression returns <strong>true</strong> the save is blocked and the
            error message below is shown — so{' '}
            <code>ISBLANK(client_number)</code> requires a client number. Use the
            Fields / Functions / Examples panels to build it.
          </p>
          <FormulaEditor
            objectApiName={apiName}
            expression={vrForm.expression}
            errorMessage={vrForm.errorMessage}
            availableFields={fields}
            onExpressionChange={(expr) => setVrForm((p) => ({ ...p, expression: expr }))}
            onErrorMessageChange={(msg) => setVrForm((p) => ({ ...p, errorMessage: msg }))}
          />
        </div>

        <div className={styles.fieldGroup}>
          <label className={styles.label}>Error Location</label>
          <p className={styles.hint}>
            Where to show the error message when this rule fails.
          </p>
          <div className={styles.locationRow}>
            <label className={styles.locationOption}>
              <input
                type="radio"
                name="errorLocation"
                checked={!vrForm.errorField}
                onChange={() => setVrForm((p) => ({ ...p, errorField: '' }))}
              />
              <span>Top of record</span>
            </label>
            <label className={styles.locationOption}>
              <input
                type="radio"
                name="errorLocation"
                checked={!!vrForm.errorField}
                onChange={() => {
                  const first = (fields || []).find((f) => !['id', 'createdAt', 'updatedAt'].includes(f.apiName));
                  setVrForm((p) => ({ ...p, errorField: first?.apiName || '' }));
                }}
              />
              <span>Specific field</span>
            </label>
          </div>
          {vrForm.errorField !== '' && (
            <select
              className={styles.input}
              value={vrForm.errorField}
              onChange={(e) => setVrForm((p) => ({ ...p, errorField: e.target.value }))}
            >
              {(fields || [])
                .filter((f) => !['id', 'createdAt', 'updatedAt', 'createdBy', 'lastModifiedBy'].includes(f.apiName))
                .map((f) => (
                  <option key={f.apiName} value={f.apiName}>
                    {f.label || f.apiName}
                  </option>
                ))}
            </select>
          )}
        </div>
      </div>
    </Modal>
  );
}
