import styles from './ActionButtonModal.module.css';
import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import Modal from '../../../components/common/Modal/Modal';
import Button from '../../../components/common/Button/Button';
import BtnIconPicker from './BtnIconPicker/BtnIconPicker';
import BtnColorPicker from './BtnColorPicker/BtnColorPicker';
import { getAutomations } from '../../../services/api/automations';
import { getFields } from '../../../services/api/objects';
import {
  createActionButton,
  updateActionButton,
} from '../../../services/api/actionButtons';
import {
  actionTypeOf,
  nativeActionsFor,
  CONDITION_OPERATORS,
} from '../../../utils/recordActions';

const DEFAULT_BTN = {
  label: '',
  icon: 'Zap',
  variant: 'secondary',
  color: '',
  location: 'record_detail',
  resultMode: 'popup',
  actionType: 'flow',
  automationId: '',
  nativeAction: '',
  conditions: [],
  confirmMessage: '',
};

// Which automation types each action type can run.
const FLOW_TYPES = {
  flow: ['autolaunched', 'record_triggered'],
  screen_flow: ['screen_flow'],
};
const needsValue = (op) => op === 'eq' || op === 'neq';

const ActionButtonModal = ({
  objectApiName,
  isOpen,
  onClose,
  editingIndex,
  initialData,
}) => {
  const queryClient = useQueryClient();

  const [btnForm, setBtnForm] = useState(DEFAULT_BTN);

  const { data: automations } = useQuery({
    queryKey: ['button-automations-all'],
    queryFn: () => getAutomations({ limit: 500 }),
    enabled: isOpen,
  });

  const { data: objectFields = [] } = useQuery({
    queryKey: ['fields', objectApiName],
    queryFn: () => getFields(objectApiName),
    enabled: isOpen && !!objectApiName,
  });

  const actionType = btnForm.actionType || 'flow';
  const flowOptions = (automations || []).filter((a) =>
    (FLOW_TYPES[actionType] || []).includes(a?.type),
  );
  const nativeOptions = nativeActionsFor(objectApiName);
  const conditionFields = [...objectFields].sort((a, b) =>
    (a.label || a.apiName).localeCompare(b.label || b.apiName),
  );

  useEffect(() => {
    if (isOpen) {
      setBtnForm(
        initialData
          ? {
              ...DEFAULT_BTN,
              ...initialData,
              actionType: actionTypeOf(initialData),
              automationId: initialData.automationId ? String(initialData.automationId) : '',
              conditions: (initialData.conditions || []).map((c) => ({ ...c })),
            }
          : { ...DEFAULT_BTN },
      );
    }
  }, [isOpen, initialData]);

  const setConditions = (conditions) => setBtnForm((p) => ({ ...p, conditions }));
  const updateCondition = (idx, patch) =>
    setConditions(
      btnForm.conditions.map((c, i) => {
        if (i !== idx) return c;
        const next = { ...c, ...patch };
        if (patch.field && patch.field !== c.field) next.value = '';
        return next;
      }),
    );

  const renderConditionValue = (c, idx) => {
    if (!needsValue(c.operator)) return <span className={styles.noValue}>—</span>;
    const field = objectFields.find((f) => f.apiName === c.field);
    const options = (field?.picklistValues || []).filter((pv) => pv.isActive !== false);
    if (['picklist', 'multipicklist'].includes(field?.type) && options.length) {
      return (
        <select
          className={styles.select}
          aria-label="Value"
          value={c.value || ''}
          onChange={(e) => updateCondition(idx, { value: e.target.value })}
        >
          <option value="">Choose a value…</option>
          {options.map((pv) => (
            <option key={pv.value} value={pv.value}>{pv.label || pv.value}</option>
          ))}
          {c.value && !options.some((pv) => pv.value === c.value) && (
            <option value={c.value}>{c.value} (not a current picklist value)</option>
          )}
        </select>
      );
    }
    if (field?.type === 'boolean') {
      return (
        <select
          className={styles.select}
          aria-label="Value"
          value={c.value || ''}
          onChange={(e) => updateCondition(idx, { value: e.target.value })}
        >
          <option value="">Choose…</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      );
    }
    return (
      <input
        className={styles.input}
        aria-label="Value"
        placeholder="Value"
        value={c.value || ''}
        onChange={(e) => updateCondition(idx, { value: e.target.value })}
      />
    );
  };

  const handleSave = async () => {
    if (!btnForm.label.trim()) {
      toast.error('Button label is required.');
      return;
    }
    if (actionType === 'native' && !btnForm.nativeAction) {
      toast.error('Choose a platform action.');
      return;
    }
    if (actionType !== 'native' && !btnForm.automationId) {
      toast.error(actionType === 'screen_flow' ? 'Choose a screen flow.' : 'Choose a flow.');
      return;
    }
    const badCondition = btnForm.conditions.findIndex(
      (c) => !c.field || (needsValue(c.operator) && !String(c.value || '').trim()),
    );
    if (badCondition !== -1) {
      toast.error(`Condition ${badCondition + 1}: choose a field and a value.`);
      return;
    }

    try {
      if (editingIndex !== null) {
        await updateActionButton(objectApiName, btnForm._id, btnForm);
      } else {
        await createActionButton(objectApiName, btnForm);
      }
      toast.success(
        editingIndex !== null
          ? 'Action button updated successfully.'
          : 'Action button created successfully.',
      );
      queryClient.invalidateQueries({
        queryKey: ['action-buttons', objectApiName],
      });
      // Record pages read buttons from the object metadata.
      queryClient.invalidateQueries({ queryKey: ['object', objectApiName] });
      onClose();
    } catch (err) {
      // Keep the dialog open so the admin can fix what the server rejected.
      toast.error(err.message || 'Failed to save action button.');
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        editingIndex !== null
          ? `Edit Button: ${btnForm.label || 'Untitled'}`
          : 'New Action Button'
      }
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave}>
            {editingIndex !== null ? 'Save Changes' : 'Add Button'}
          </Button>
        </>
      }
    >
      <div className={styles.grid}>
        <div className={`${styles.field} ${styles.fullWidth}`}>
          <label className={styles.label}>Button Label *</label>
          <input
            className={styles.input}
            value={btnForm.label}
            onChange={(e) =>
              setBtnForm((p) => ({ ...p, label: e.target.value }))
            }
            placeholder="e.g. Send Email"
          />
        </div>

        <div className={`${styles.field} ${styles.fullWidth}`}>
          <BtnIconPicker
            label="Button Icon"
            value={btnForm.icon || 'Zap'}
            onChange={(icon) => setBtnForm((p) => ({ ...p, icon }))}
          />
        </div>

        <div className={`${styles.field} ${styles.fullWidth}`}>
          <BtnColorPicker
            label="Button Color"
            value={btnForm.color || ''}
            onChange={(color) => setBtnForm((p) => ({ ...p, color }))}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Variant</label>
          <select
            className={styles.select}
            value={btnForm.variant || 'secondary'}
            onChange={(e) =>
              setBtnForm((p) => ({ ...p, variant: e.target.value }))
            }
          >
            <option value="primary">Primary</option>
            <option value="secondary">Secondary</option>
            <option value="ghost">Ghost</option>
            <option value="danger">Danger</option>
            <option value="success">Success</option>
          </select>
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Show on</label>
          <select
            className={styles.select}
            value={actionType === 'native' ? 'record_detail' : btnForm.location || 'record_detail'}
            disabled={actionType === 'native'}
            title={actionType === 'native' ? 'Platform actions run on the open record' : undefined}
            onChange={(e) =>
              setBtnForm((p) => ({ ...p, location: e.target.value }))
            }
          >
            <option value="record_detail">Record Detail page</option>
            <option value="record_list">Record List (bulk action)</option>
            <option value="both">Both</option>
          </select>
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Result display</label>
          <select
            className={styles.select}
            value={btnForm.resultMode || 'popup'}
            onChange={(e) =>
              setBtnForm((p) => ({ ...p, resultMode: e.target.value }))
            }
          >
            <option value="popup">Popup / Screen flow</option>
            <option value="toast_only">Toast notification only</option>
            <option value="inline">Inline (no modal)</option>
          </select>
        </div>

        <div className={`${styles.field} ${styles.fullWidth}`}>
          <label className={styles.label}>Action type</label>
          <select
            className={styles.select}
            aria-label="Action type"
            value={actionType}
            onChange={(e) =>
              setBtnForm((p) => ({
                ...p,
                actionType: e.target.value,
                automationId: '',
                nativeAction: '',
              }))
            }
          >
            <option value="flow">Flow — runs straight away</option>
            <option value="screen_flow">Screen flow — asks the user for input first</option>
            <option value="native">Platform action — e.g. convert, clone, generate PDF</option>
          </select>
        </div>

        {actionType === 'native' ? (
          <div className={`${styles.field} ${styles.fullWidth}`}>
            <label className={styles.label}>Platform action</label>
            <select
              className={styles.select}
              aria-label="Platform action"
              value={btnForm.nativeAction || ''}
              onChange={(e) =>
                setBtnForm((p) => ({ ...p, nativeAction: e.target.value }))
              }
            >
              <option value="">— Choose —</option>
              {nativeOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <p className={styles.smallHint}>
              Only actions that apply to this object are listed.
            </p>
          </div>
        ) : (
          <div className={`${styles.field} ${styles.fullWidth}`}>
            <label className={styles.label}>
              {actionType === 'screen_flow' ? 'Screen flow' : 'Flow'}
            </label>
            <select
              className={styles.select}
              aria-label={actionType === 'screen_flow' ? 'Screen flow' : 'Flow'}
              value={btnForm.automationId || ''}
              onChange={(e) =>
                setBtnForm((p) => ({ ...p, automationId: e.target.value }))
              }
            >
              <option value="">— Choose —</option>
              {flowOptions.map((f) => (
                <option key={f?._id} value={f?._id}>
                  {f?.name}
                </option>
              ))}
            </select>
            <p className={styles.smallHint}>
              {actionType === 'screen_flow'
                ? 'The flow shows its screens in a popup before it runs.'
                : 'The flow runs as soon as the button is clicked.'}
            </p>
          </div>
        )}

        <div className={`${styles.field} ${styles.fullWidth}`}>
          <label className={styles.label}>
            Show only when <span className={styles.hint}>(optional — all must match)</span>
          </label>
          {btnForm.conditions.length === 0 && (
            <p className={styles.smallHint}>
              No conditions — the button always shows. Add one to show it only for
              matching records, e.g. Stage equals Closed Won.
            </p>
          )}
          {btnForm.conditions.map((c, idx) => (
            <div key={idx} className={styles.conditionRow} data-testid="action-condition">
              <select
                className={styles.select}
                aria-label="Field"
                value={c.field || ''}
                onChange={(e) => updateCondition(idx, { field: e.target.value })}
              >
                <option value="">Field…</option>
                {conditionFields.map((f) => (
                  <option key={f.apiName} value={f.apiName}>{f.label || f.apiName}</option>
                ))}
              </select>
              <select
                className={styles.select}
                aria-label="Condition"
                value={c.operator || 'eq'}
                onChange={(e) => updateCondition(idx, { operator: e.target.value })}
              >
                {CONDITION_OPERATORS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              {renderConditionValue(c, idx)}
              <button
                type="button"
                className={styles.removeCondition}
                aria-label="Remove condition"
                onClick={() => setConditions(btnForm.conditions.filter((_, i) => i !== idx))}
              >
                ✕
              </button>
            </div>
          ))}
          <div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setConditions([...btnForm.conditions, { field: '', operator: 'eq', value: '' }])
              }
            >
              + Add condition
            </Button>
          </div>
        </div>

        <div className={`${styles.field} ${styles.fullWidth}`}>
          <label className={styles.label}>
            Confirmation message <span className={styles.hint}>(optional)</span>
          </label>
          <input
            className={styles.input}
            value={btnForm.confirmMessage || ''}
            onChange={(e) =>
              setBtnForm((p) => ({ ...p, confirmMessage: e.target.value }))
            }
            placeholder="Are you sure you want to perform this action?"
          />
          <p className={styles.smallHint}>
            If set, a confirmation dialog is shown before the action runs.
          </p>
        </div>
      </div>
    </Modal>
  );
};

export default ActionButtonModal;
