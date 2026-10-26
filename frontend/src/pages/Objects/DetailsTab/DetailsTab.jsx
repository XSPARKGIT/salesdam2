import * as LucideIcons from 'lucide-react';
import styles from './DetailsTab.module.css';
import ColorPicker from '../../../components/common/ColorPicker/ColorPicker';
import IconPicker from '../IconPicker/IconPicker';

const DetailsTab = ({ objForm, onChange, isEdit, onIconChange, fields = [] }) => {
  // Get all picklist fields for kanban selection
  const picklistFields = fields.filter(f => f.type === 'picklist' && !f.isReadOnly);

  // Resolve the object's configured name field when editing. Falls back to
  // 'name' for objects created before the API name was configurable.
  const nameField = isEdit
    ? fields.find((f) => f.apiName === (objForm.nameFieldApiName || 'name'))
    : null;

  const handleKanbanChange = (e) => {
    const { name, checked } = e.target;
    onChange({
      target: {
        name: 'kanbanConfig',
        value: {
          ...objForm.kanbanConfig,
          [name]: checked,
        },
      },
    });
  };

  const handleKanbanFieldChange = (e) => {
    const { value } = e.target;
    onChange({
      target: {
        name: 'kanbanConfig',
        value: {
          ...objForm.kanbanConfig,
          fieldApiName: value,
        },
      },
    });
  };
  return (
    <div className={styles.form}>
      <div className={styles.formGrid}>
        <div className={styles.field}>
          <label className={styles.label}>Object Label *</label>
          <input
            name="label"
            value={objForm.label}
            onChange={onChange}
            className={styles.input}
            placeholder="e.g. Property"
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label}>Plural Label *</label>
          <input
            name="pluralLabel"
            value={objForm.pluralLabel}
            onChange={onChange}
            className={styles.input}
            placeholder="e.g. Properties"
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label}>API Name *</label>
          <input
            name="apiName"
            value={objForm.apiName}
            onChange={onChange}
            className={styles.input}
            placeholder="e.g. property"
            disabled={isEdit}
          />
        </div>
        <div className={styles.field}>
          <ColorPicker
            label="Color"
            value={objForm.color}
            onChange={(color) =>
              onChange({
                target: {
                  name: 'color',
                  value: color,
                },
              })
            }
            allowCustom
          />
        </div>
        <div className={`${styles.field} ${styles.fullWidth}`}>
          <label className={styles.label}>
            Icon
            {objForm.icon &&
              (() => {
                const Icon = LucideIcons[objForm.icon] || LucideIcons.Box;
                return (
                  <span style={{ marginLeft: 8, color: objForm.color }}>
                    <Icon size={16} style={{ verticalAlign: 'middle' }} />{' '}
                    {objForm.icon}
                  </span>
                );
              })()}
          </label>
          <IconPicker value={objForm.icon} onChange={onIconChange} />
        </div>
        <div className={styles.field}>
          <label className={styles.label}>Sharing Model</label>
          <select
            name="sharingModel"
            value={objForm.sharingModel}
            onChange={onChange}
            className={styles.select}
          >
            <option value="private">Private</option>
            <option value="public_read_only">Public Read Only</option>
            <option value="public_read_write">Public Read/Write</option>
          </select>
        </div>
        <div className={`${styles.field} ${styles.fullWidth}`}>
          <label className={styles.label}>Name Field Type</label>
          <p
            style={{
              fontSize: 11,
              color: 'var(--color-gray-400)',
              margin: '2px 0 8px',
            }}
          >
            Every record has a system <strong>Name</strong> field. {isEdit ? 'This field is locked and cannot be changed.' : 'Choose its label and whether it\'s free-text or an auto-generated number.'}
          </p>

          {isEdit && nameField ? (
            <div
              style={{
                padding: '12px 14px',
                background: 'var(--color-gray-50)',
                borderRadius: 'var(--border-radius)',
                border: '1px solid var(--border-color)',
              }}
            >
              <div style={{ marginBottom: 12 }}>
                <label className={styles.label} style={{ fontSize: 11, marginBottom: 4, display: 'block' }}>
                  Field Label
                </label>
                <div style={{ fontSize: '14px', color: 'var(--color-gray-900)', fontWeight: 500 }}>
                  {nameField.label}
                </div>
              </div>

              <div style={{ marginBottom: 12 }}>
                <label className={styles.label} style={{ fontSize: 11, marginBottom: 4, display: 'block' }}>
                  API Name
                </label>
                <div style={{ fontSize: '14px', color: 'var(--color-gray-900)', fontWeight: 500, fontFamily: 'monospace' }}>
                  {nameField.apiName}
                </div>
              </div>

              <div style={{ marginBottom: 12 }}>
                <label className={styles.label} style={{ fontSize: 11, marginBottom: 4, display: 'block' }}>
                  Field Type
                </label>
                <div
                  style={{
                    display: 'inline-block',
                    fontSize: '13px',
                    padding: '4px 12px',
                    background: nameField.type === 'auto_number' ? 'var(--color-primary-light, #eff6ff)' : 'var(--color-gray-100)',
                    color: nameField.type === 'auto_number' ? 'var(--color-primary)' : 'var(--color-gray-700)',
                    borderRadius: 'var(--border-radius)',
                    fontWeight: 500,
                    textTransform: 'capitalize',
                  }}
                >
                  {nameField.type === 'auto_number' ? 'Auto Number' : 'Text'}
                </div>
              </div>

              {nameField.type === 'auto_number' && (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr 1fr',
                    gap: 10,
                    padding: '12px 0',
                    borderTop: '1px solid var(--border-color)',
                    marginTop: 12,
                    paddingTop: 12,
                  }}
                >
                  <div>
                    <label className={styles.label} style={{ fontSize: 10, marginBottom: 4, display: 'block', color: 'var(--color-gray-500)' }}>
                      Prefix
                    </label>
                    <div style={{ fontSize: '13px', fontFamily: 'monospace', fontWeight: 500 }}>
                      {nameField.autoNumberPrefix || '(none)'}
                    </div>
                  </div>
                  <div>
                    <label className={styles.label} style={{ fontSize: 10, marginBottom: 4, display: 'block', color: 'var(--color-gray-500)' }}>
                      Digit Padding
                    </label>
                    <div style={{ fontSize: '13px', fontWeight: 500 }}>
                      {nameField.autoNumberPadding}
                    </div>
                  </div>
                  <div>
                    <label className={styles.label} style={{ fontSize: 10, marginBottom: 4, display: 'block', color: 'var(--color-gray-500)' }}>
                      Start At
                    </label>
                    <div style={{ fontSize: '13px', fontWeight: 500 }}>
                      {nameField.autoNumberStartAt}
                    </div>
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label className={styles.label} style={{ fontSize: 10, marginBottom: 4, display: 'block', color: 'var(--color-gray-500)' }}>
                      Preview
                    </label>
                    <div style={{ fontSize: '13px', fontFamily: 'monospace', fontWeight: 600, color: 'var(--color-primary)' }}>
                      {(nameField.autoNumberPrefix || '') +
                        String(nameField.autoNumberStartAt || 1).padStart(
                          nameField.autoNumberPadding || 5,
                          '0',
                        )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : !isEdit ? (
            <>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 10,
                  marginBottom: 10,
                }}
              >
                <div>
                  <label className={styles.label} style={{ fontSize: 11 }}>
                    Field Label
                  </label>
                  <input
                    className={styles.input}
                    name="nameFieldLabel"
                    value={objForm.nameFieldLabel}
                    onChange={onChange}
                    placeholder="e.g. Name, Case Subject, Invoice Number"
                    style={{ marginTop: 4 }}
                  />
                </div>
                <div>
                  <label className={styles.label} style={{ fontSize: 11 }}>
                    Field API Name
                  </label>
                  <input
                    className={styles.input}
                    name="nameFieldApiName"
                    value={objForm.nameFieldApiName}
                    onChange={onChange}
                    placeholder="e.g. name, case_subject"
                    style={{ marginTop: 4 }}
                  />
                  <span
                    style={{
                      fontSize: 10,
                      color: 'var(--color-gray-400)',
                      marginTop: 2,
                      display: 'block',
                    }}
                  >
                    Derived from the label. Defaults to <code>name</code> if
                    left blank.
                  </span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
                {[
                  {
                    value: 'text',
                    label: 'Text',
                    desc: 'User types in a name when creating a record',
                  },
                  {
                    value: 'auto_number',
                    label: 'Auto Number',
                    desc: 'System generates a sequential number (e.g. CASE-00001)',
                  },
                ].map((opt) => (
                  <label
                    key={opt.value}
                    style={{
                      flex: 1,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 3,
                      padding: '10px 14px',
                      border: `2px solid ${objForm.nameFieldType === opt.value ? 'var(--color-primary)' : 'var(--border-color)'}`,
                      borderRadius: 'var(--border-radius)',
                      background:
                        objForm.nameFieldType === opt.value
                          ? 'var(--color-primary-light, #eff6ff)'
                          : 'var(--color-white)',
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                    }}
                  >
                    <input
                      type="radio"
                      name="nameFieldType"
                      value={opt.value}
                      checked={objForm.nameFieldType === opt.value}
                      onChange={onChange}
                      style={{ display: 'none' }}
                    />
                    <span
                      style={{
                        fontSize: 'var(--font-size-sm)',
                        fontWeight: 'var(--font-weight-semibold)',
                        color: 'var(--color-gray-900)',
                      }}
                    >
                      {opt.label}
                    </span>
                    <span
                      style={{ fontSize: 11, color: 'var(--color-gray-500)' }}
                    >
                      {opt.desc}
                    </span>
                  </label>
                ))}
              </div>
              {objForm.nameFieldType === 'auto_number' && (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr 1fr',
                    gap: 10,
                    padding: '12px 14px',
                    background: 'var(--color-gray-50)',
                    borderRadius: 'var(--border-radius)',
                    border: '1px solid var(--border-color)',
                  }}
                >
                  <div className={styles.field}>
                    <label className={styles.label} style={{ fontSize: 11 }}>
                      Prefix
                    </label>
                    <input
                      className={styles.input}
                      name="autoNumberPrefix"
                      value={objForm.autoNumberPrefix}
                      onChange={onChange}
                      placeholder="e.g. CASE-"
                    />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label} style={{ fontSize: 11 }}>
                      Digit padding
                    </label>
                    <input
                      type="number"
                      className={styles.input}
                      name="autoNumberPadding"
                      min={1}
                      max={10}
                      value={objForm.autoNumberPadding}
                      onChange={onChange}
                    />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label} style={{ fontSize: 11 }}>
                      Start at
                    </label>
                    <input
                      type="number"
                      className={styles.input}
                      name="autoNumberStartAt"
                      min={1}
                      value={objForm.autoNumberStartAt}
                      onChange={onChange}
                    />
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <span
                      style={{ fontSize: 11, color: 'var(--color-gray-500)' }}
                    >
                      Preview:{' '}
                      <strong>
                        {(objForm.autoNumberPrefix || '') +
                          String(objForm.autoNumberStartAt || 1).padStart(
                            objForm.autoNumberPadding || 5,
                            '0',
                          )}
                      </strong>
                    </span>
                  </div>
                </div>
              )}
            </>
          ) : (
            <p
              style={{
                fontSize: 12,
                color: 'var(--color-orange-600)',
                margin: 0,
              }}
            >
              ⚠️ Could not resolve the name field
              {objForm.nameFieldApiName
                ? ` ("${objForm.nameFieldApiName}")`
                : ''}
              . Check the Fields tab.
            </p>
          )}
        </div>
        <div className={`${styles.field} ${styles.fullWidth}`}>
          <label className={styles.label}>Description</label>
          <textarea
            name="description"
            value={objForm.description}
            onChange={onChange}
            className={styles.textarea}
            rows={3}
          />
        </div>
        <div className={styles.field}>
          <label className={styles.checkboxLabel}>
            <input
              type="checkbox"
              name="showInNav"
              checked={objForm.showInNav}
              onChange={onChange}
            />
            Show in navigation sidebar
          </label>
        </div>

        {/* ── Object-Level Settings (BRD §3.1.1) ── */}
        <div className={`${styles.field} ${styles.fullWidth}`}>
          <label className={styles.label} style={{ marginBottom: 10, display: 'block', fontSize: 13, fontWeight: 600 }}>
            Object Settings
          </label>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: 8,
            padding: '14px 16px',
            background: 'var(--color-gray-50)',
            borderRadius: 'var(--border-radius)',
            border: '1px solid var(--border-color)',
          }}>
            <label className={styles.checkboxLabel}>
              <input type="checkbox" name="isActive" checked={objForm.isActive !== false} onChange={onChange} />
              <span>
                <strong>Active</strong>
                <span style={{ display: 'block', fontSize: 11, color: 'var(--color-gray-500)', marginTop: 1 }}>Inactive objects are hidden from nav and search</span>
              </span>
            </label>
            <label className={styles.checkboxLabel}>
              <input type="checkbox" name="enableHistory" checked={!!objForm.enableHistory} onChange={onChange} />
              <span>
                <strong>Track Field History</strong>
                <span style={{ display: 'block', fontSize: 11, color: 'var(--color-gray-500)', marginTop: 1 }}>Audit trail of field-level changes (BRD §3.1.1)</span>
              </span>
            </label>
            <label className={styles.checkboxLabel}>
              <input type="checkbox" name="hasRecordTypes" checked={!!objForm.hasRecordTypes} onChange={onChange} />
              <span>
                <strong>Enable Type Field</strong>
                <span style={{ display: 'block', fontSize: 11, color: 'var(--color-gray-500)', marginTop: 1 }}>Auto-provisions a protected "Type" picklist (BRD §3.3)</span>
              </span>
            </label>
            <label className={styles.checkboxLabel}>
              <input type="checkbox" name="enableActivities" checked={objForm.enableActivities !== false} onChange={onChange} />
              <span>
                <strong>Allow Activities</strong>
                <span style={{ display: 'block', fontSize: 11, color: 'var(--color-gray-500)', marginTop: 1 }}>Permit Tasks &amp; Cases to relate to this object</span>
              </span>
            </label>
            <label className={styles.checkboxLabel}>
              <input type="checkbox" name="enableNotes" checked={objForm.enableNotes !== false} onChange={onChange} />
              <span>
                <strong>Allow Notes</strong>
                <span style={{ display: 'block', fontSize: 11, color: 'var(--color-gray-500)', marginTop: 1 }}>Users can add notes to records</span>
              </span>
            </label>
            <label className={styles.checkboxLabel}>
              <input type="checkbox" name="searchable" checked={objForm.searchable !== false} onChange={onChange} />
              <span>
                <strong>Allow Search</strong>
                <span style={{ display: 'block', fontSize: 11, color: 'var(--color-gray-500)', marginTop: 1 }}>Include in Global Search indexing</span>
              </span>
            </label>
            <label className={styles.checkboxLabel}>
              <input type="checkbox" name="isJunctionObject" checked={!!objForm.isJunctionObject} onChange={onChange} />
              <span>
                <strong>Junction Object</strong>
                <span style={{ display: 'block', fontSize: 11, color: 'var(--color-gray-500)', marginTop: 1 }}>Allows two Master-Detail fields (many-to-many)</span>
              </span>
            </label>
            {objForm.isJunctionObject && (() => {
              const mdFields = fields.filter(f => f.type === 'master_detail');
              if (mdFields.length === 2) return (
                <div style={{ marginTop: 4, padding: '8px 12px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, fontSize: 12, color: '#15803d', display: 'flex', gap: 8, alignItems: 'center' }}>
                  ✓ Linked to <strong>{mdFields[0].label}</strong> and <strong>{mdFields[1].label}</strong>
                </div>
              );
              return (
                <div style={{ marginTop: 4, padding: '8px 12px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, fontSize: 12, color: '#b45309', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <span>⚠️</span>
                  <span>
                    Junction objects need exactly <strong>2 Master-Detail fields</strong>.
                    {mdFields.length === 0 && ' None added yet — go to the Fields tab and add two.'}
                    {mdFields.length === 1 && ` You have 1 (${mdFields[0].label}) — add one more.`}
                  </span>
                </div>
              );
            })()}
          </div>
        </div>
        <div className={styles.field}>
          <label className={styles.label}>Nav Order</label>
          <input
            type="number"
            name="navOrder"
            value={objForm.navOrder}
            onChange={onChange}
            className={styles.input}
            min={0}
          />
        </div>

        {/* Kanban Settings */}
        <div className={`${styles.field} ${styles.fullWidth}`}>
          <div style={{
            padding: '16px 14px',
            background: 'var(--color-gray-50)',
            borderRadius: 'var(--border-radius)',
            border: '1px solid var(--border-color)'
          }}>
            <div style={{ marginBottom: '12px' }}>
              <label className={styles.label} style={{ fontSize: '13px', marginBottom: '8px', display: 'block' }}>
                Kanban View
              </label>
              <label className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  name="enabled"
                  checked={objForm.kanbanConfig?.enabled || false}
                  onChange={handleKanbanChange}
                />
                Enable kanban view for this object
              </label>
              <p style={{ fontSize: '11px', color: 'var(--color-gray-500)', marginTop: '4px' }}>
                Kanban view allows viewing records on a board organized by a picklist field
              </p>
            </div>

            {objForm.kanbanConfig?.enabled && picklistFields.length > 0 && (
              <div>
                <label className={styles.label} style={{ fontSize: '12px' }}>
                  Group By Field *
                </label>
                <select
                  value={objForm.kanbanConfig?.fieldApiName || ''}
                  onChange={handleKanbanFieldChange}
                  className={styles.select}
                  style={{ marginTop: '6px' }}
                >
                  <option value="">Select a picklist field...</option>
                  {picklistFields.map(field => (
                    <option key={field.apiName} value={field.apiName}>
                      {field.label}
                    </option>
                  ))}
                </select>
                <p style={{ fontSize: '11px', color: 'var(--color-gray-500)', marginTop: '4px' }}>
                  Choose which picklist field to use for organizing cards into columns
                </p>
              </div>
            )}

            {objForm.kanbanConfig?.enabled && picklistFields.length === 0 && (
              <p style={{ fontSize: '12px', color: 'var(--color-orange-600)', margin: '8px 0 0 0' }}>
                ⚠️ No picklist fields available. Create at least one picklist field to enable kanban view.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default DetailsTab;
