import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import {
  ArrowLeft,
  Plus,
  Save,
  Trash2,
  GripVertical,
  Eye,
  Columns,
  Maximize2,
  Minimize2,
  LayoutGrid,
  Zap,
  Filter,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../services/api';
import Button from '../../components/common/Button/Button';
import Layout from '../../layout/Layout';
import { withoutHelperFields } from '../../utils/fieldVisibility';
import styles from './LayoutBuilder.module.css';

const SYSTEM_SECTION = 'Information';

export default function LayoutBuilder() {
  const { apiName } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  // Back destination: where we came from, or fall back to object settings
  const backTo = location.state?.from || `/setup/objects/${apiName}?tab=fields`;

  const [objectMeta, setObjectMeta] = useState(null);
  const [allFields, setAllFields] = useState([]);
  const [layout, setLayout] = useState(null);
  const [sections, setSections] = useState([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [screenFlows, setScreenFlows] = useState([]);
  const [leftTab, setLeftTab] = useState('fields'); // 'fields' | 'flows'
  // Index of the section whose condition editor is open, or null
  const [conditionEditorIdx, setConditionEditorIdx] = useState(null);

  useEffect(() => {
    const fetchAll = async () => {
      try {
        const [objRes, layoutRes, flowsRes] = await Promise.all([
          api.get(`/objects/${apiName}`),
          api.get(`/layouts/${apiName}?t=${Date.now()}`), // bypass browser cache
          api
            .get('/automations?type=screen_flow&limit=200')
            .catch(() => ({ data: { data: [] } })),
        ]);
        setScreenFlows(flowsRes.data.data || []);
        const obj = objRes.data.data;
        setObjectMeta(obj);
        // Helper fields exist only to feed formulas / rollups, so they are not
        // offered to the layout at all.
        const fields = withoutHelperFields(obj.fields).sort(
          (a, b) => a.displayOrder - b.displayOrder,
        );
        setAllFields(fields);

        const layouts = layoutRes.data.data;
        const defaultLayout = layouts.find((l) => l.isDefault) || layouts[0];

        if (defaultLayout) {
          setLayout(defaultLayout);
          setSections(
            defaultLayout.sections?.length > 0
              ? defaultLayout.sections
              : buildDefaultSections(fields),
          );
        } else {
          setSections(buildDefaultSections(fields));
        }
      } catch (err) {
        toast.error('Failed to load layout.');
        navigate(`/setup/objects`);
      } finally {
        setLoading(false);
      }
    };
    fetchAll();
  }, [apiName, navigate]);

  const buildDefaultSections = (fields) => {
    const grouped = {};
    fields.forEach((f) => {
      if (f.type === 'auto_number' || f.type === 'formula' || f.isReadOnly) return;
      const sec = f.section || SYSTEM_SECTION;
      if (!grouped[sec]) grouped[sec] = [];
      grouped[sec].push(f);
    });

    return Object.entries(grouped).map(([name, sFields], i) => ({
      id: `section_${i}`,
      label: name,
      columns: 2,
      collapsible: false,
      collapsed: false,
      columnData: [
        {
          fields: sFields
            .filter((_, idx) => idx % 2 === 0)
            .map((f) => ({ fieldApiName: f.apiName, label: f.label })),
        },
        {
          fields: sFields
            .filter((_, idx) => idx % 2 !== 0)
            .map((f) => ({ fieldApiName: f.apiName, label: f.label })),
        },
      ],
    }));
  };

  // Fields not yet placed in any section
  const placedApiNames = new Set(
    sections.flatMap((s) =>
      (s.columnData || []).flatMap((col) =>
        (col.fields || []).map((f) => f.fieldApiName),
      ),
    ),
  );
  const unplacedFields = allFields.filter(
    (f) => !placedApiNames.has(f.apiName) && f.type !== 'auto_number' && f.type !== 'formula' && !f.isReadOnly,
  );

  const handleDragEnd = (result) => {
    const { source, destination, draggableId, type } = result;
    if (!destination) return;
    if (
      source.droppableId === destination.droppableId &&
      source.index === destination.index
    )
      return;

    // ── Section reordering ────────────────────────────────────────────────────
    if (type === 'SECTION') {
      const next = [...sections];
      const [moved] = next.splice(source.index, 1);
      next.splice(destination.index, 0, moved);
      setSections(next);
      return;
    }

    // ── Flow drop onto canvas (creates a new flow section) ───────────────────
    if (
      type === 'FLOW' &&
      (destination.droppableId === 'sections' ||
        destination.droppableId === 'flow-drop-zone')
    ) {
      const flowId = draggableId.replace('flow-', '');
      const flow = screenFlows.find((f) => f._id === flowId);
      if (!flow) return;
      const newSection = {
        id: `flow_section_${Date.now()}`,
        label: flow.name,
        columns: 1,
        collapsible: false,
        collapsed: false,
        columnData: [{ fields: [] }],
        type: 'flow',
        flowId,
      };
      setSections((prev) => [...prev, newSection]);
      return;
    }

    // ── Field placement ───────────────────────────────────────────────────────
    const srcId = source.droppableId;
    const dstId = destination.droppableId;

    const newSections = sections.map((s) => ({
      ...s,
      columnData: (s.columnData || []).map((col) => ({
        ...col,
        fields: [...(col.fields || [])],
      })),
    }));

    const getColRef = (droppableId) => {
      if (droppableId === 'unplaced') return null;
      const [, secIdx, , colIdx] = droppableId.split('-');
      return newSections[parseInt(secIdx)]?.columnData[parseInt(colIdx)];
    };

    const fieldDef = draggableId.startsWith('unplaced-')
      ? (() => {
          const name = draggableId.replace('unplaced-', '');
          const f = allFields.find((f) => f.apiName === name);
          return f ? { fieldApiName: f.apiName, label: f.label } : null;
        })()
      : (() => {
          const srcCol = getColRef(srcId);
          if (!srcCol) return null;
          const [item] = srcCol.fields.splice(source.index, 1);
          return item;
        })();

    if (!fieldDef) return;

    const dstCol = getColRef(dstId);
    if (dstCol) dstCol.fields.splice(destination.index, 0, fieldDef);

    setSections(newSections);
  };

  const addSection = () => {
    const id = `section_${Date.now()}`;
    setSections((prev) => [
      ...prev,
      {
        id,
        label: 'New Section',
        columns: 2,
        collapsible: false,
        collapsed: false,
        columnData: [{ fields: [] }, { fields: [] }],
      },
    ]);
  };

  const removeSection = (idx) => {
    setSections((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateSectionLabel = (idx, label) => {
    setSections((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, label } : s)),
    );
  };

  const toggleColumns = (idx) => {
    setSections((prev) =>
      prev.map((s, i) => {
        if (i !== idx) return s;
        const newCols = s.columns === 2 ? 1 : 2;
        const all = (s.columnData || []).flatMap((c) => c.fields || []);
        return {
          ...s,
          columns: newCols,
          columnData:
            newCols === 1
              ? [{ fields: all }]
              : [
                  { fields: all.filter((_, i) => i % 2 === 0) },
                  { fields: all.filter((_, i) => i % 2 !== 0) },
                ],
        };
      }),
    );
  };

  const updateSectionVisibilityRule = (secIdx, rule) => {
    setSections((prev) =>
      prev.map((s, i) => (i === secIdx ? { ...s, visibilityRule: rule } : s))
    );
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const layoutData = {
        objectApiName: apiName,
        name: 'Default Layout',
        isDefault: true,
        type: 'detail',
        useTabs: false,
        sections,
      };
      if (layout?._id) {
        await api.put(`/layouts/${layout._id}`, layoutData);
      } else {
        const res = await api.post('/layouts', layoutData);
        setLayout(res.data.data);
      }
      toast.success('Layout saved.');
    } catch (err) {
      toast.error(err.message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  // Exit fullscreen on Escape
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && isFullscreen) setIsFullscreen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isFullscreen]);

  if (loading)
    return (
      <Layout
        title="Layout Builder"
        description="Customise record page layouts and field arrangement"
      >
        <div className={styles.loading}>
          <div className={styles.spinner} />
        </div>
      </Layout>
    );

  return (
    <Layout
      title="Layout Builder"
      description="Customise record page layouts and field arrangement"
    >
      <div
        className={`${styles.page} ${isFullscreen ? styles.fullscreen : ''}`}
      >
        {/* ── Header (flex-shrink: 0) ──────────────────────────────────────── */}
        <div className={styles.header}>
          <button onClick={() => navigate(backTo)} className={styles.backLink}>
            <ArrowLeft size={16} /> Back
          </button>
          <div className={styles.headerRow}>
            <div>
              <h1 className={styles.title}>
                Page Layout — {objectMeta?.label}
              </h1>
              <p className={styles.subtitle}>
                Drag fields to arrange the record detail view
              </p>
            </div>
            <div className={styles.headerActions}>
              <Link to={`/o/${apiName}`}>
                <Button variant="secondary" size="sm" icon={<Eye size={14} />}>
                  Preview
                </Button>
              </Link>
              <Button
                size="sm"
                icon={<Save size={14} />}
                loading={saving}
                onClick={handleSave}
              >
                Save Layout
              </Button>
              <button
                className={styles.fsBtn}
                onClick={() => setIsFullscreen((f) => !f)}
                title={
                  isFullscreen
                    ? 'Exit fullscreen (Esc)'
                    : 'Expand to fullscreen'
                }
              >
                {isFullscreen ? (
                  <Minimize2 size={16} />
                ) : (
                  <Maximize2 size={16} />
                )}
              </button>
            </div>
          </div>
        </div>

        {/* ── Builder (flex: 1, both panels scroll independently) ─────────── */}
        <DragDropContext onDragEnd={handleDragEnd}>
          <div className={styles.builder}>
            {/* Left panel: available fields / flows */}
            <div className={styles.fieldPanel}>
              <div className={styles.panelTabs}>
                <button
                  className={`${styles.panelTab} ${leftTab === 'fields' ? styles.panelTabActive : ''}`}
                  onClick={() => setLeftTab('fields')}
                >
                  Fields
                </button>
                <button
                  className={`${styles.panelTab} ${leftTab === 'flows' ? styles.panelTabActive : ''}`}
                  onClick={() => setLeftTab('flows')}
                >
                  <Zap size={11} style={{ marginRight: 3 }} />
                  Flows
                </button>
              </div>

              {leftTab === 'fields' && (
                <>
                  <p className={styles.panelHint}>
                    Drag fields onto the layout
                  </p>
                  <Droppable droppableId="unplaced" type="FIELD">
                    {(provided, snapshot) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                        className={`${styles.fieldList} ${snapshot.isDraggingOver ? styles.dragOver : ''}`}
                      >
                        {unplacedFields.length === 0 && (
                          <div className={styles.emptyPanel}>
                            All fields placed
                          </div>
                        )}
                        {unplacedFields.map((field, i) => (
                          <Draggable
                            key={`unplaced-${field.apiName}`}
                            draggableId={`unplaced-${field.apiName}`}
                            index={i}
                          >
                            {(prov, snap) => (
                              <div
                                ref={prov.innerRef}
                                {...prov.draggableProps}
                                {...prov.dragHandleProps}
                                className={`${styles.fieldChip} ${snap.isDragging ? styles.dragging : ''}`}
                              >
                                <GripVertical
                                  size={12}
                                  className={styles.grip}
                                />
                                <div>
                                  <span className={styles.chipLabel}>
                                    {field.label}
                                  </span>
                                  <span className={styles.chipType}>
                                    {field.type}
                                  </span>
                                </div>
                              </div>
                            )}
                          </Draggable>
                        ))}
                        {provided.placeholder}
                      </div>
                    )}
                  </Droppable>
                </>
              )}

              {leftTab === 'flows' && (
                <>
                  <p className={styles.panelHint}>
                    Drag a screen flow onto the layout
                  </p>
                  <Droppable
                    droppableId="flow-panel"
                    type="FLOW"
                    isDropDisabled
                  >
                    {(provided) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                        className={styles.fieldList}
                      >
                        {screenFlows.length === 0 && (
                          <div className={styles.emptyPanel}>
                            No screen flows available
                          </div>
                        )}
                        {screenFlows.map((flow, i) => (
                          <Draggable
                            key={`flow-${flow._id}`}
                            draggableId={`flow-${flow._id}`}
                            index={i}
                          >
                            {(prov, snap) => (
                              <div
                                ref={prov.innerRef}
                                {...prov.draggableProps}
                                {...prov.dragHandleProps}
                                className={`${styles.fieldChip} ${snap.isDragging ? styles.dragging : ''}`}
                              >
                                <Zap size={12} className={styles.grip} />
                                <div>
                                  <span className={styles.chipLabel}>
                                    {flow.name}
                                  </span>
                                  <span className={styles.chipType}>
                                    screen flow
                                  </span>
                                </div>
                              </div>
                            )}
                          </Draggable>
                        ))}
                        {provided.placeholder}
                      </div>
                    )}
                  </Droppable>
                </>
              )}
            </div>

            {/* Right panel: layout canvas */}
            <div className={styles.canvas}>
              {/* Flow drop zone — shown at the top when in flows tab so it's easy to find */}
              {leftTab === 'flows' && (
                <Droppable droppableId="flow-drop-zone" type="FLOW">
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className={`${styles.flowDropZone} ${snapshot.isDraggingOver ? styles.flowDropZoneOver : ''}`}
                    >
                      <Zap size={18} style={{ opacity: 0.5 }} />
                      <span>
                        Drop a screen flow here to embed it in the layout
                      </span>
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              )}

              {/* Sections — droppable for both SECTION reorder and FLOW drop */}
              <Droppable droppableId="sections" type="SECTION">
                {(sectProv, sectSnap) => (
                  <div
                    ref={sectProv.innerRef}
                    {...sectProv.droppableProps}
                    className={`${styles.sectionsContainer} ${sectSnap.isDraggingOver ? styles.sectionsOver : ''}`}
                  >
                    {sections.map((section, secIdx) => (
                      <Draggable
                        key={section.id}
                        draggableId={`section-${section.id}`}
                        index={secIdx}
                      >
                        {(sectDragProv, sectDragSnap) => (
                          <div
                            ref={sectDragProv.innerRef}
                            {...sectDragProv.draggableProps}
                            className={`${styles.section} ${sectDragSnap.isDragging ? styles.sectionDragging : ''}`}
                          >
                            <div className={styles.sectionHeader}>
                              {/* Drag handle — only this element moves the section */}
                              <span
                                {...sectDragProv.dragHandleProps}
                                className={styles.sectionGrip}
                                title="Drag to reorder section"
                              >
                                <GripVertical size={16} />
                              </span>
                              {section.type === 'flow' && (
                                <Zap
                                  size={13}
                                  style={{
                                    color: 'var(--color-primary)',
                                    flexShrink: 0,
                                  }}
                                />
                              )}
                              <input
                                className={styles.sectionLabel}
                                value={section.label}
                                onChange={(e) =>
                                  updateSectionLabel(secIdx, e.target.value)
                                }
                              />
                              <div className={styles.sectionActions}>
                                {section.type !== 'flow' && (
                                  <button
                                    className={styles.sectionBtn}
                                    onClick={() => toggleColumns(secIdx)}
                                    title={
                                      section.columns === 2
                                        ? 'Switch to 1 column'
                                        : 'Switch to 2 columns'
                                    }
                                  >
                                    <Columns size={14} />
                                    {section.columns} col
                                  </button>
                                )}
                                <button
                                  className={`${styles.sectionBtn} ${section.visibilityRule?.field ? styles.sectionBtnActive : ''}`}
                                  onClick={() => setConditionEditorIdx(conditionEditorIdx === secIdx ? null : secIdx)}
                                  title="Set visibility condition"
                                >
                                  <Filter size={14} />
                                  {section.visibilityRule?.field ? 'Condition set' : 'Condition'}
                                </button>
                                <button
                                  className={`${styles.sectionBtn} ${styles.danger}`}
                                  onClick={() => removeSection(secIdx)}
                                  title="Remove section"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </div>

                            {/* Inline condition editor */}
                            {conditionEditorIdx === secIdx && (
                              <div className={styles.conditionEditor}>
                                <span className={styles.conditionLabel}>Show this section only when</span>
                                <select
                                  className={styles.conditionSelect}
                                  value={section.visibilityRule?.field || ''}
                                  onChange={(e) => {
                                    const field = e.target.value;
                                    if (!field) {
                                      updateSectionVisibilityRule(secIdx, null);
                                    } else {
                                      updateSectionVisibilityRule(secIdx, {
                                        field,
                                        operator: section.visibilityRule?.operator || 'eq',
                                        value: section.visibilityRule?.value || '',
                                      });
                                    }
                                  }}
                                >
                                  <option value="">— always show —</option>
                                  {allFields.map((f) => (
                                    <option key={f.apiName} value={f.apiName}>{f.label}</option>
                                  ))}
                                </select>
                                {section.visibilityRule?.field && (
                                  <>
                                    <select
                                      className={styles.conditionSelect}
                                      value={section.visibilityRule?.operator || 'eq'}
                                      onChange={(e) => updateSectionVisibilityRule(secIdx, {
                                        ...section.visibilityRule,
                                        operator: e.target.value,
                                      })}
                                    >
                                      <option value="eq">equals</option>
                                      <option value="neq">does not equal</option>
                                      <option value="is_set">is set</option>
                                      <option value="is_blank">is blank</option>
                                    </select>
                                    {(section.visibilityRule?.operator === 'eq' || section.visibilityRule?.operator === 'neq') && (
                                      <input
                                        className={styles.conditionInput}
                                        placeholder="value"
                                        value={section.visibilityRule?.value || ''}
                                        onChange={(e) => updateSectionVisibilityRule(secIdx, {
                                          ...section.visibilityRule,
                                          value: e.target.value,
                                        })}
                                      />
                                    )}
                                  </>
                                )}
                                <button
                                  className={styles.conditionClose}
                                  onClick={() => setConditionEditorIdx(null)}
                                  title="Close"
                                >
                                  <X size={13} />
                                </button>
                              </div>
                            )}

                            {section.type === 'flow' ? (
                              <div className={styles.flowPreviewTile}>
                                <Zap
                                  size={18}
                                  style={{ color: 'var(--color-primary)' }}
                                />
                                <div>
                                  <span className={styles.flowPreviewName}>
                                    {section.label}
                                  </span>
                                  <span className={styles.flowPreviewSub}>
                                    Screen flow will render here on the record
                                    page
                                  </span>
                                </div>
                              </div>
                            ) : (
                              <div
                                className={styles.columns}
                                style={{
                                  gridTemplateColumns: `repeat(${section.columns}, 1fr)`,
                                }}
                              >
                                {(section.columnData || []).map(
                                  (col, colIdx) => (
                                    <Droppable
                                      key={colIdx}
                                      droppableId={`sec-${secIdx}-col-${colIdx}`}
                                      type="FIELD"
                                    >
                                      {(provided, snapshot) => (
                                        <div
                                          ref={provided.innerRef}
                                          {...provided.droppableProps}
                                          className={`${styles.column} ${snapshot.isDraggingOver ? styles.dragOver : ''}`}
                                        >
                                          <div className={styles.columnHeader}>
                                            <LayoutGrid size={11} />
                                            Column {colIdx + 1}
                                          </div>
                                          {(col.fields || []).map(
                                            (fieldItem, fieldIdx) => {
                                              const fieldMeta = allFields.find(
                                                (f) =>
                                                  f.apiName ===
                                                  fieldItem.fieldApiName,
                                              );
                                              return (
                                                <Draggable
                                                  key={`${section.id}-${colIdx}-${fieldItem.fieldApiName}`}
                                                  draggableId={`placed-${section.id}-${colIdx}-${fieldItem.fieldApiName}`}
                                                  index={fieldIdx}
                                                >
                                                  {(prov, snap) => (
                                                    <div
                                                      ref={prov.innerRef}
                                                      {...prov.draggableProps}
                                                      className={`${styles.placedField} ${snap.isDragging ? styles.dragging : ''}`}
                                                    >
                                                      <span
                                                        {...prov.dragHandleProps}
                                                        className={
                                                          styles.placedGrip
                                                        }
                                                      >
                                                        <GripVertical
                                                          size={12}
                                                        />
                                                      </span>
                                                      <div
                                                        className={
                                                          styles.placedInfo
                                                        }
                                                      >
                                                        <span
                                                          className={
                                                            styles.placedLabel
                                                          }
                                                        >
                                                          {fieldItem.label ||
                                                            fieldMeta?.label}
                                                        </span>
                                                        <span
                                                          className={
                                                            styles.placedType
                                                          }
                                                        >
                                                          {fieldMeta?.type ||
                                                            ''}
                                                        </span>
                                                      </div>
                                                      {fieldMeta?.isRequired && (
                                                        <span
                                                          className={
                                                            styles.required
                                                          }
                                                        >
                                                          *
                                                        </span>
                                                      )}
                                                    </div>
                                                  )}
                                                </Draggable>
                                              );
                                            },
                                          )}
                                          {col.fields?.length === 0 && (
                                            <div className={styles.dropHint}>
                                              Drop fields here
                                            </div>
                                          )}
                                          {provided.placeholder}
                                        </div>
                                      )}
                                    </Droppable>
                                  ),
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {sectProv.placeholder}
                  </div>
                )}
              </Droppable>

              <button className={styles.addSection} onClick={addSection}>
                <Plus size={16} /> Add Section
              </button>
            </div>
          </div>
        </DragDropContext>
      </div>
    </Layout>
  );
}
