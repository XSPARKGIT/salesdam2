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
  Users,
  Lock,
  Asterisk,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../services/api';
import Button from '../../components/common/Button/Button';
import Layout from '../../layout/Layout';
import { withoutHelperFields } from '../../utils/fieldVisibility';
import { isPlaceableField, isFieldRequired } from '../../utils/layoutBackfill';
import { getRelatedObjects } from '../../services/api/objects';
import RelatedListsPanel from './RelatedListsPanel';
import styles from './LayoutBuilder.module.css';

const SYSTEM_SECTION = 'Information';

/** Sections cycle 1 -> 2 -> 3 -> 1 columns (BRD 4.1.2). */
const nextColumnCount = (current) => ((current || 2) >= 3 ? 1 : (current || 2) + 1);

/**
 * One visibility condition: "<field> <operator> <value>". Used for a whole
 * section and for a single field (BRD 4.1.5), so both read the same way.
 */
function ConditionEditor({ rule, fields, label, onChange, onClose }) {
  const set = (patch) => onChange({ operator: 'eq', value: '', ...rule, ...patch });
  return (
    <div className={styles.conditionEditor}>
      <span className={styles.conditionLabel}>{label}</span>
      <select
        className={styles.conditionSelect}
        value={rule?.field || ''}
        onChange={(e) => (e.target.value ? set({ field: e.target.value }) : onChange(null))}
      >
        <option value="">— always show —</option>
        {fields.map((f) => (
          <option key={f.apiName} value={f.apiName}>{f.label}</option>
        ))}
      </select>
      {rule?.field && (
        <>
          <select
            className={styles.conditionSelect}
            value={rule.operator || 'eq'}
            onChange={(e) => set({ operator: e.target.value })}
          >
            <option value="eq">equals</option>
            <option value="neq">does not equal</option>
            <option value="is_set">is set</option>
            <option value="is_blank">is blank</option>
          </select>
          {(rule.operator === 'eq' || rule.operator === 'neq' || !rule.operator) && (
            <input
              className={styles.conditionInput}
              placeholder="value"
              value={rule.value || ''}
              onChange={(e) => set({ value: e.target.value })}
            />
          )}
        </>
      )}
      <button className={styles.conditionClose} onClick={onClose} title="Close">
        <X size={13} />
      </button>
    </div>
  );
}

export default function LayoutBuilder() {
  const { apiName } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  // Back destination: where we came from, or fall back to object settings
  const backTo = location.state?.from || `/setup/objects/${apiName}?tab=fields`;

  const [objectMeta, setObjectMeta] = useState(null);
  const [allFields, setAllFields] = useState([]);
  const [layout, setLayout] = useState(null);
  // Every layout of this object; one is the object default, others can be
  // assigned to Roles (Setup → Layout Assignment).
  const [layouts, setLayouts] = useState([]);
  const [layoutName, setLayoutName] = useState('Default Layout');
  const [makeDefault, setMakeDefault] = useState(true);
  const [newLayoutName, setNewLayoutName] = useState(null); // null = not creating
  const [sections, setSections] = useState([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [screenFlows, setScreenFlows] = useState([]);
  const [leftTab, setLeftTab] = useState('fields'); // 'fields' | 'flows'
  // Index of the section whose condition editor is open, or null
  const [conditionEditorIdx, setConditionEditorIdx] = useState(null);
  const [fieldConditionKey, setFieldConditionKey] = useState(null);
  const [relatedLists, setRelatedLists] = useState([]);
  const [relatedCandidates, setRelatedCandidates] = useState([]);

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

        const list = layoutRes.data.data || [];
        setLayouts(list);
        // ?layout=<id> opens a specific layout (e.g. from Layout Assignment).
        const wanted = new URLSearchParams(location.search).get('layout');
        const initial =
          list.find((l) => l._id === wanted) ||
          list.find((l) => l.isDefault) ||
          list[0];
        setLayout(initial || null);
        setRelatedLists(initial?.relatedLists || []);
        getRelatedObjects(apiName).then(setRelatedCandidates);
        setLayoutName(initial?.name || 'Default Layout');
        setMakeDefault(initial ? !!initial.isDefault : true);
        setSections(
          initial?.sections?.length > 0
            ? initial.sections
            : buildDefaultSections(fields),
        );
      } catch (err) {
        toast.error('Failed to load layout.');
        navigate(`/setup/objects`);
      } finally {
        setLoading(false);
      }
    };
    fetchAll();
  }, [apiName, navigate]);

  // Show a layout in the builder (or a fresh default when there is none yet).
  const openLayout = (target, fields = allFields) => {
    setLayout(target || null);
    setLayoutName(target?.name || 'Default Layout');
    setMakeDefault(target ? !!target.isDefault : true);
    setSections(
      target?.sections?.length > 0 ? target.sections : buildDefaultSections(fields),
    );
    setConditionEditorIdx(null);
    setFieldConditionKey(null);
    setRelatedLists(target?.relatedLists || []);
  };

  const nameTaken = (name, exceptId) =>
    layouts.some(
      (l) => l._id !== exceptId && l.name.trim().toLowerCase() === name.trim().toLowerCase(),
    );

  // New layouts start as a copy of the one on screen.
  const handleCreateLayout = async () => {
    const name = (newLayoutName || '').trim();
    if (!name) return toast.error('Give the new layout a name.');
    if (nameTaken(name)) return toast.error(`A layout named "${name}" already exists.`);
    try {
      const res = await api.post('/layouts', {
        objectApiName: apiName,
        name,
        isDefault: layouts.length === 0,
        type: 'detail',
        useTabs: false,
        sections,
      });
      const created = res.data.data;
      setLayouts((prev) => [...prev, created]);
      setNewLayoutName(null);
      openLayout(created);
      toast.success(`Layout "${name}" created.`);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not create the layout.');
    }
  };

  const handleDeleteLayout = async () => {
    if (!layout?._id || layout.isDefault) return;
    if (!window.confirm(`Delete the layout "${layout.name}"? Roles assigned to it will see the object's default layout instead.`)) return;
    try {
      await api.delete(`/layouts/${layout._id}`);
      const remaining = layouts.filter((l) => l._id !== layout._id);
      setLayouts(remaining);
      openLayout(remaining.find((l) => l.isDefault) || remaining[0]);
      toast.success('Layout deleted.');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not delete the layout.');
    }
  };

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
    (f) => !placedApiNames.has(f.apiName) && isPlaceableField(f),
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
        // 1 -> 2 -> 3 -> 1. Fields are re-dealt across the new columns in
        // reading order so nothing is lost when the count changes.
        const newCols = nextColumnCount(s.columns);
        const all = (s.columnData || []).flatMap((c) => c.fields || []);
        return {
          ...s,
          columns: newCols,
          columnData: Array.from({ length: newCols }, (_, col) => ({
            fields: all.filter((_, i) => i % newCols === col),
          })),
        };
      }),
    );
  };

  // Per-field settings on THIS layout only: Required, Read-only, and a
  // visibility condition (BRD 4.1.3 / 4.1.5). `undefined` removes the override
  // so the field falls back to its own definition.
  const updateFieldItem = (secIdx, colIdx, apiName, patch) => {
    setSections((prev) =>
      prev.map((s, i) =>
        i !== secIdx
          ? s
          : {
              ...s,
              columnData: (s.columnData || []).map((col, c) =>
                c !== colIdx
                  ? col
                  : {
                      ...col,
                      fields: (col.fields || []).map((f) =>
                        f.fieldApiName === apiName ? { ...f, ...patch } : f,
                      ),
                    },
              ),
            },
      ),
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
      const name = layoutName.trim() || 'Default Layout';
      if (nameTaken(name, layout?._id)) {
        toast.error(`A layout named "${name}" already exists.`);
        return;
      }
      const layoutData = {
        objectApiName: apiName,
        name,
        // The first layout is always the object default.
        isDefault: layout?._id ? makeDefault : true,
        type: 'detail',
        useTabs: false,
        sections,
        // Copied field by field so Mongo's own _id keys never round-trip.
        relatedLists: relatedLists.map((c) => ({
          objectApiName: c.objectApiName,
          relationshipField: c.relationshipField,
          through: !!c.through,
          label: c.label || '',
          columns: c.columns || [],
          sortField: c.sortField || '',
          sortOrder: c.sortOrder || 'desc',
          limit: c.limit || 5,
          filters: (c.filters || []).map((f) => ({
            field: f.field,
            operator: f.operator,
            value: f.value,
          })),
          buttons: {
            new: c.buttons?.new !== false,
            edit: c.buttons?.edit !== false,
            delete: c.buttons?.delete !== false,
          },
        })),
      };
      const res = layout?._id
        ? await api.put(`/layouts/${layout._id}`, layoutData)
        : await api.post('/layouts', layoutData);
      const saved = res.data.data;
      setLayout(saved);
      setLayouts((prev) => {
        const others = prev
          .filter((l) => l._id !== saved._id)
          .map((l) => (saved.isDefault ? { ...l, isDefault: false } : l));
        return [...others, saved];
      });
      toast.success('Layout saved.');
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Save failed.');
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

          <div className={styles.layoutBar} data-testid="layout-bar">
            <label className={styles.layoutBarField}>
              <span>Layout</span>
              <select
                value={layout?._id || ''}
                onChange={(e) => openLayout(layouts.find((l) => l._id === e.target.value))}
                disabled={layouts.length === 0}
              >
                {layouts.length === 0 && <option value="">Default Layout (not saved yet)</option>}
                {[...layouts]
                  .sort((a, b) => (b.isDefault - a.isDefault) || a.name.localeCompare(b.name))
                  .map((l) => (
                    <option key={l._id} value={l._id}>
                      {l.name}{l.isDefault ? ' (object default)' : ''}
                    </option>
                  ))}
              </select>
            </label>
            <label className={styles.layoutBarField}>
              <span>Name</span>
              <input
                value={layoutName}
                onChange={(e) => setLayoutName(e.target.value)}
                maxLength={80}
              />
            </label>
            <label
              className={styles.layoutBarCheck}
              title={layout?.isDefault ? 'To change the object default, open another layout and make it the default.' : undefined}
            >
              <input
                type="checkbox"
                checked={makeDefault}
                disabled={!layout?._id || layout.isDefault}
                onChange={(e) => setMakeDefault(e.target.checked)}
              />
              Object default
            </label>

            <div className={styles.layoutBarActions}>
              {newLayoutName === null ? (
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Plus size={14} />}
                  onClick={() => setNewLayoutName('')}
                  disabled={!layout?._id}
                  title={!layout?._id ? 'Save this layout first' : 'Create a new layout from a copy of this one'}
                >
                  New Layout
                </Button>
              ) : (
                <>
                  <input
                    className={styles.newLayoutInput}
                    autoFocus
                    placeholder="New layout name"
                    value={newLayoutName}
                    maxLength={80}
                    onChange={(e) => setNewLayoutName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleCreateLayout();
                      if (e.key === 'Escape') setNewLayoutName(null);
                    }}
                  />
                  <Button size="sm" onClick={handleCreateLayout}>Create</Button>
                  <Button variant="secondary" size="sm" onClick={() => setNewLayoutName(null)}>Cancel</Button>
                </>
              )}
              {layout?._id && !layout.isDefault && (
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Trash2 size={14} />}
                  onClick={handleDeleteLayout}
                >
                  Delete
                </Button>
              )}
              <Link
                to={`/setup/objects/${apiName}/layout-assignment`}
                state={{ from: `${location.pathname}${location.search}` }}
              >
                <Button variant="secondary" size="sm" icon={<Users size={14} />}>
                  Layout Assignment
                </Button>
              </Link>
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
                                    title={`Switch to ${nextColumnCount(section.columns)} ${
                                      nextColumnCount(section.columns) === 1 ? 'column' : 'columns'
                                    }`}
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
                              <ConditionEditor
                                rule={section.visibilityRule}
                                fields={allFields}
                                label="Show this section only when"
                                onChange={(rule) => updateSectionVisibilityRule(secIdx, rule)}
                                onClose={() => setConditionEditorIdx(null)}
                              />
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
                                                      {(isFieldRequired(fieldMeta) || fieldItem.required) && (
                                                        <span
                                                          className={
                                                            styles.required
                                                          }
                                                        >
                                                          *
                                                        </span>
                                                      )}
                                                      <div className={styles.fieldFlags}>
                                                        <button
                                                          type="button"
                                                          className={`${styles.fieldFlag} ${fieldItem.required ? styles.fieldFlagOn : ''}`}
                                                          title={
                                                            isFieldRequired(fieldMeta)
                                                              ? 'Already required on the field itself'
                                                              : 'Required on this layout'
                                                          }
                                                          disabled={isFieldRequired(fieldMeta)}
                                                          onClick={() =>
                                                            updateFieldItem(secIdx, colIdx, fieldItem.fieldApiName, {
                                                              required: fieldItem.required ? undefined : true,
                                                            })
                                                          }
                                                        >
                                                          <Asterisk size={11} />
                                                        </button>
                                                        <button
                                                          type="button"
                                                          className={`${styles.fieldFlag} ${fieldItem.readonly ? styles.fieldFlagOn : ''}`}
                                                          title="Read-only on this layout"
                                                          onClick={() =>
                                                            updateFieldItem(secIdx, colIdx, fieldItem.fieldApiName, {
                                                              readonly: fieldItem.readonly ? undefined : true,
                                                            })
                                                          }
                                                        >
                                                          <Lock size={11} />
                                                        </button>
                                                        <button
                                                          type="button"
                                                          className={`${styles.fieldFlag} ${fieldItem.visibilityRule?.field ? styles.fieldFlagOn : ''}`}
                                                          title="Show this field only when…"
                                                          onClick={() =>
                                                            setFieldConditionKey(
                                                              fieldConditionKey === `${secIdx}-${colIdx}-${fieldItem.fieldApiName}` ? null : `${secIdx}-${colIdx}-${fieldItem.fieldApiName}`,
                                                            )
                                                          }
                                                        >
                                                          <Filter size={11} />
                                                        </button>
                                                      </div>
                                                      {fieldConditionKey === `${secIdx}-${colIdx}-${fieldItem.fieldApiName}` && (
                                                        <div className={styles.fieldConditionRow}>
                                                          <ConditionEditor
                                                            rule={fieldItem.visibilityRule}
                                                            fields={allFields}
                                                            label="Show this field only when"
                                                            onChange={(rule) =>
                                                              updateFieldItem(secIdx, colIdx, fieldItem.fieldApiName, {
                                                                visibilityRule: rule || undefined,
                                                              })
                                                            }
                                                            onClose={() => setFieldConditionKey(null)}
                                                          />
                                                        </div>
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

              <RelatedListsPanel
                candidates={relatedCandidates}
                value={relatedLists}
                onChange={setRelatedLists}
              />
            </div>
          </div>
        </DragDropContext>
      </div>
    </Layout>
  );
}
