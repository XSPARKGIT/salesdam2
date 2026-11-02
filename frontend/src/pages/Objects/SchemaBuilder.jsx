import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  GitBranch,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Settings,
  ArrowLeft,
  RefreshCw,
} from 'lucide-react';
import Layout from '../../layout/Layout';
import { getObjects, listFields } from '../../services/api/objects';
import styles from './SchemaBuilder.module.css';

const CARD_WIDTH = 240;
const CARD_HEADER = 40;
const FIELD_ROW = 26;
const H_GAP = 100;
const V_GAP = 80;
const COLS = 4;

// Minimum pixel movement before a mousedown-mouseup is treated as a drag (not a click)
const DRAG_THRESHOLD = 5;

function fieldTypeColor(type) {
  const map = {
    lookup: '#6366f1',
    master_detail: '#dc2626',
    text: '#64748b',
    number: '#0ea5e9',
    currency: '#10b981',
    date: '#f59e0b',
    datetime: '#f59e0b',
    boolean: '#8b5cf6',
    picklist: '#ec4899',
    email: '#0891b2',
    phone: '#0891b2',
    formula: '#7c3aed',
    auto_number: '#059669',
    url: '#0891b2',
    richtext: '#64748b',
    textarea: '#64748b',
    percent: '#0ea5e9',
    address: '#f59e0b',
    time: '#f59e0b',
  };
  return map[type] || '#94a3b8';
}

function cardHeight(apiName, fieldMap, showFields) {
  if (!showFields[apiName]) return CARD_HEADER;
  const fields = fieldMap[apiName] || [];
  return CARD_HEADER + fields.length * FIELD_ROW + 8;
}

/**
 * Pick the best anchor side based on relative position of the two cards.
 * Returns { x1, y1, x2, y2 } — the start and end points for the connection line.
 */
function getAnchors(src, tgt, fieldMap, showFields) {
  const srcH = cardHeight(src.apiName, fieldMap, showFields);
  const tgtH = cardHeight(tgt.apiName, fieldMap, showFields);

  const srcCx = src.x + CARD_WIDTH / 2;
  const srcCy = src.y + srcH / 2;
  const tgtCx = tgt.x + CARD_WIDTH / 2;
  const tgtCy = tgt.y + tgtH / 2;

  const dx = tgtCx - srcCx;
  const dy = tgtCy - srcCy;

  // Connect horizontally if cards are mostly side-by-side
  if (Math.abs(dx) >= Math.abs(dy)) {
    if (dx >= 0) {
      // target is to the right
      return { x1: src.x + CARD_WIDTH, y1: srcCy, x2: tgt.x, y2: tgtCy };
    } else {
      // target is to the left
      return { x1: src.x, y1: srcCy, x2: tgt.x + CARD_WIDTH, y2: tgtCy };
    }
  } else {
    // Connect vertically — cards are mostly above/below
    if (dy >= 0) {
      return { x1: srcCx, y1: src.y + srcH, x2: tgtCx, y2: tgt.y };
    } else {
      return { x1: srcCx, y1: src.y, x2: tgtCx, y2: tgt.y + tgtH };
    }
  }
}

/** Cubic Bézier path between two anchor points */
function bezierPath(x1, y1, x2, y2) {
  const isHoriz = Math.abs(x2 - x1) >= Math.abs(y2 - y1);
  if (isHoriz) {
    const cx = Math.abs(x2 - x1) * 0.5;
    return `M${x1},${y1} C${x1 + cx},${y1} ${x2 - cx},${y2} ${x2},${y2}`;
  } else {
    const cy = Math.abs(y2 - y1) * 0.5;
    return `M${x1},${y1} C${x1},${y1 + cy} ${x2},${y2 - cy} ${x2},${y2}`;
  }
}

export default function SchemaBuilder() {
  const navigate = useNavigate();
  const containerRef = useRef(null);
  const dragRef = useRef(null); // { apiName, startX, startY, origX, origY, moved }

  const [objects, setObjects] = useState([]);
  const [fieldMap, setFieldMap] = useState({});
  const [positions, setPositions] = useState({});
  const [showFields, setShowFields] = useState({});
  const [relations, setRelations] = useState([]);
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0 });

  /* ── Load ────────────────────────────────────────────────── */
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const objs = (await getObjects({ limit: 200, scope: 'all' })) || [];

      const fMap = {};
      await Promise.all(
        objs.map(async (obj) => {
          try {
            const fr = await listFields(obj.apiName);
            fMap[obj.apiName] = fr.data?.data || [];
          } catch {
            fMap[obj.apiName] = [];
          }
        }),
      );

      const rels = [];
      for (const obj of objs) {
        for (const f of fMap[obj.apiName] || []) {
          if (
            (f.type === 'lookup' || f.type === 'master_detail') &&
            f.lookupObjectApiName
          ) {
            rels.push({
              from: obj.apiName,
              to: f.lookupObjectApiName,
              fieldLabel: f.label,
              type: f.type,
            });
          }
        }
      }

      const pos = {};
      const show = {};
      objs.forEach((obj, i) => {
        const col = i % COLS;
        const row = Math.floor(i / COLS);
        pos[obj.apiName] = {
          x: col * (CARD_WIDTH + H_GAP) + 40,
          y: row * (160 + V_GAP) + 40,
          apiName: obj.apiName,
        };
        show[obj.apiName] = true; // expanded by default
      });

      setObjects(objs);
      setFieldMap(fMap);
      setPositions(pos);
      setShowFields(show);
      setRelations(rels);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /* ── Card drag (with click-vs-drag distinction) ─────────── */
  const onCardMouseDown = useCallback(
    (e, apiName) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      const pos = positions[apiName];
      dragRef.current = {
        apiName,
        startX: e.clientX,
        startY: e.clientY,
        origX: pos.x,
        origY: pos.y,
        moved: false,
      };
    },
    [positions],
  );

  const onMouseMove = useCallback(
    (e) => {
      if (dragRef.current) {
        const dx = (e.clientX - dragRef.current.startX) / scale;
        const dy = (e.clientY - dragRef.current.startY) / scale;
        const distMoved = Math.sqrt(
          (e.clientX - dragRef.current.startX) ** 2 +
            (e.clientY - dragRef.current.startY) ** 2,
        );

        if (distMoved > DRAG_THRESHOLD) {
          dragRef.current.moved = true;
        }

        if (dragRef.current.moved) {
          const { apiName, origX, origY } = dragRef.current;
          setPositions((prev) => ({
            ...prev,
            [apiName]: { ...prev[apiName], x: origX + dx, y: origY + dy },
          }));
        }
        return;
      }

      if (isPanning) {
        const dx = e.clientX - panStartRef.current.x;
        const dy = e.clientY - panStartRef.current.y;
        panStartRef.current = { x: e.clientX, y: e.clientY };
        setPan((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
      }
    },
    [isPanning, scale],
  );

  const onMouseUp = useCallback((e) => {
    if (dragRef.current) {
      // If mouse didn't move much — treat as a click: select the card
      if (!dragRef.current.moved) {
        setSelected(dragRef.current.apiName);
      }
      dragRef.current = null;
    }
    setIsPanning(false);
  }, []);

  /* ── Header click: toggle fields (only on true click) ───── */
  const onHeaderClick = useCallback((e, apiName) => {
    e.stopPropagation();
    // Only toggle if this wasn't a drag
    if (dragRef.current?.moved) return;
    setShowFields((prev) => ({ ...prev, [apiName]: !prev[apiName] }));
  }, []);

  /* ── Canvas pan ──────────────────────────────────────────── */
  const onCanvasMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    setSelected(null);
    setIsPanning(true);
    panStartRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  /* ── Zoom ─────────────────────────────────────────────────── */
  const onWheel = useCallback((e) => {
    e.preventDefault();
    setScale((s) =>
      Math.min(2.5, Math.max(0.25, s + (e.deltaY > 0 ? -0.08 : 0.08))),
    );
  }, []);

  const resetView = () => {
    setScale(1);
    setPan({ x: 0, y: 0 });
  };

  /* ── Canvas dimensions ───────────────────────────────────── */
  const allX = Object.values(positions).map((p) => p.x);
  const allY = Object.values(positions).map((p) => p.y);
  const canvasW = allX.length ? Math.max(...allX) + CARD_WIDTH + 120 : 1400;
  const canvasH = allY.length ? Math.max(...allY) + 400 + 120 : 900;

  /* ── Render ──────────────────────────────────────────────── */
  return (
    <Layout>
      <div className={styles.page}>
        {/* Toolbar */}
        <div className={styles.toolbar}>
          <div className={styles.toolbarLeft}>
            <button
              className={styles.backBtn}
              onClick={() => navigate('/setup/objects')}
            >
              <ArrowLeft size={16} /> Object Settings
            </button>
            <div className={styles.titleWrap}>
              <GitBranch size={18} />
              <h1 className={styles.title}>Schema Builder</h1>
            </div>
          </div>
          <div className={styles.toolbarRight}>
            <button className={styles.iconBtn} onClick={load} title="Refresh">
              <RefreshCw size={16} />
            </button>
            <div className={styles.zoomGroup}>
              <button
                className={styles.iconBtn}
                onClick={() => setScale((s) => Math.max(0.25, s - 0.1))}
              >
                <ZoomOut size={16} />
              </button>
              <span className={styles.zoomLabel}>
                {Math.round(scale * 100)}%
              </span>
              <button
                className={styles.iconBtn}
                onClick={() => setScale((s) => Math.min(2.5, s + 0.1))}
              >
                <ZoomIn size={16} />
              </button>
            </div>
            <button
              className={styles.iconBtn}
              onClick={resetView}
              title="Reset view"
            >
              <Maximize2 size={16} />
            </button>
            <button
              className={styles.primaryBtn}
              onClick={() => navigate('/setup/objects/new')}
            >
              + New Object
            </button>
          </div>
        </div>

        {/* Legend */}
        <div className={styles.legend}>
          <span className={styles.legendItem}>
            <svg width="28" height="10">
              <line
                x1="0"
                y1="5"
                x2="28"
                y2="5"
                stroke="#6366f1"
                strokeWidth="1.5"
                strokeDasharray="5 3"
              />
              <polygon points="22,1 28,5 22,9" fill="#6366f1" />
            </svg>
            Lookup
          </span>
          <span className={styles.legendItem}>
            <svg width="28" height="10">
              <line
                x1="0"
                y1="5"
                x2="28"
                y2="5"
                stroke="#dc2626"
                strokeWidth="2"
              />
              <polygon points="22,1 28,5 22,9" fill="#dc2626" />
            </svg>
            Master-Detail
          </span>
          <span className={styles.legendHint}>
            Drag cards to reposition · Scroll to zoom · Drag canvas to pan ·
            Click header to expand/collapse fields
          </span>
        </div>

        {/* Canvas */}
        <div
          className={styles.canvas}
          ref={containerRef}
          onMouseDown={onCanvasMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          onWheel={onWheel}
          style={{ cursor: isPanning ? 'grabbing' : 'grab' }}
        >
          {loading ? (
            <div className={styles.loadingOverlay}>
              <div className={styles.spinner} />
              <span>Loading schema…</span>
            </div>
          ) : objects.length === 0 ? (
            <div className={styles.loadingOverlay}>
              <p>
                No objects found.{' '}
                <button
                  className={styles.primaryBtn}
                  onClick={() => navigate('/setup/objects')}
                >
                  Create your first object →
                </button>
              </p>
            </div>
          ) : (
            <svg
              width={canvasW}
              height={canvasH}
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
                transformOrigin: '0 0',
                overflow: 'visible',
              }}
            >
              <defs>
                <marker
                  id="arrow-lookup"
                  markerWidth="10"
                  markerHeight="8"
                  refX="9"
                  refY="4"
                  orient="auto"
                >
                  <path d="M0,0 L0,8 L10,4 z" fill="#6366f1" />
                </marker>
                <marker
                  id="arrow-master"
                  markerWidth="10"
                  markerHeight="8"
                  refX="9"
                  refY="4"
                  orient="auto"
                >
                  <path d="M0,0 L0,8 L10,4 z" fill="#dc2626" />
                </marker>
                <filter
                  id="cardShadow"
                  x="-10%"
                  y="-10%"
                  width="130%"
                  height="140%"
                >
                  <feDropShadow
                    dx="2"
                    dy="3"
                    stdDeviation="3"
                    floodColor="rgba(0,0,0,0.12)"
                  />
                </filter>
              </defs>

              {/* ── Relationship lines (drawn behind cards) ── */}
              {relations.map((rel, i) => {
                const src = positions[rel.from];
                const tgt = positions[rel.to];
                if (!src || !tgt) return null;

                const { x1, y1, x2, y2 } = getAnchors(
                  src,
                  tgt,
                  fieldMap,
                  showFields,
                );
                const path = bezierPath(x1, y1, x2, y2);
                const stroke =
                  rel.type === 'master_detail' ? '#dc2626' : '#6366f1';
                const mid = { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
                const labelW = 78;
                const labelH = 16;

                return (
                  <g key={`rel-${i}`}>
                    {/* Wider invisible hit area */}
                    <path
                      d={path}
                      fill="none"
                      stroke="transparent"
                      strokeWidth={12}
                    />
                    {/* Visible line */}
                    <path
                      d={path}
                      fill="none"
                      stroke={stroke}
                      strokeWidth={rel.type === 'master_detail' ? 2 : 1.5}
                      strokeDasharray={
                        rel.type === 'lookup' ? '6 3' : undefined
                      }
                      markerEnd={`url(#arrow-${rel.type === 'master_detail' ? 'master' : 'lookup'})`}
                      opacity={0.75}
                    />
                    {/* Field label pill */}
                    <rect
                      x={mid.x - labelW / 2}
                      y={mid.y - labelH / 2}
                      width={labelW}
                      height={labelH}
                      rx={5}
                      fill="white"
                      stroke={stroke}
                      strokeWidth={0.75}
                      opacity={0.95}
                    />
                    <text
                      x={mid.x}
                      y={mid.y + 4.5}
                      textAnchor="middle"
                      fontSize={9.5}
                      fill={stroke}
                      fontFamily="system-ui, sans-serif"
                      fontWeight="500"
                    >
                      {rel.fieldLabel.length > 11
                        ? rel.fieldLabel.slice(0, 10) + '…'
                        : rel.fieldLabel}
                    </text>
                  </g>
                );
              })}

              {/* ── Object cards ── */}
              {objects.map((obj) => {
                const pos = positions[obj.apiName];
                if (!pos) return null;
                const fields = fieldMap[obj.apiName] || [];
                const expanded = showFields[obj.apiName];
                const cardH =
                  CARD_HEADER + (expanded ? fields.length * FIELD_ROW + 8 : 0);
                const isSelected = selected === obj.apiName;
                const color = obj.color || '#6366f1';

                return (
                  <g
                    key={obj.apiName}
                    transform={`translate(${pos.x}, ${pos.y})`}
                    style={{ cursor: 'grab' }}
                    onMouseDown={(e) => onCardMouseDown(e, obj.apiName)}
                  >
                    {/* Shadow */}
                    <rect
                      x={2}
                      y={3}
                      width={CARD_WIDTH}
                      height={cardH}
                      rx={10}
                      fill="rgba(0,0,0,0.09)"
                    />

                    {/* Card background */}
                    <rect
                      width={CARD_WIDTH}
                      height={cardH}
                      rx={10}
                      fill="white"
                      stroke={isSelected ? color : '#e2e8f0'}
                      strokeWidth={isSelected ? 2.5 : 1}
                    />

                    {/* Header */}
                    <rect
                      width={CARD_WIDTH}
                      height={CARD_HEADER}
                      rx={10}
                      fill={color}
                    />
                    {/* Flatten bottom corners of header */}
                    <rect
                      y={CARD_HEADER - 10}
                      width={CARD_WIDTH}
                      height={10}
                      fill={color}
                    />

                    {/* Object label */}
                    <text
                      x={12}
                      y={26}
                      fill="white"
                      fontSize={13}
                      fontWeight="700"
                      fontFamily="system-ui, sans-serif"
                      style={{ userSelect: 'none', pointerEvents: 'none' }}
                    >
                      {obj.label}
                    </text>

                    {/* API name */}
                    <text
                      x={CARD_WIDTH - 12}
                      y={26}
                      fill="rgba(255,255,255,0.65)"
                      fontSize={9.5}
                      fontFamily="system-ui, sans-serif"
                      textAnchor="end"
                      style={{ userSelect: 'none', pointerEvents: 'none' }}
                    >
                      {obj.apiName}
                    </text>

                    {/* Expand/collapse chevron */}
                    <text
                      x={CARD_WIDTH - 8}
                      y={26}
                      fill="rgba(255,255,255,0.8)"
                      fontSize={12}
                      fontFamily="system-ui, sans-serif"
                      textAnchor="end"
                      style={{ userSelect: 'none', pointerEvents: 'none' }}
                    >
                      {expanded ? '▾' : '▸'}
                    </text>

                    {/* Field rows */}
                    {expanded &&
                      fields.map((f, fi) => {
                        const fy = CARD_HEADER + 4 + fi * FIELD_ROW;
                        const isRel =
                          f.type === 'lookup' || f.type === 'master_detail';
                        const dotColor = fieldTypeColor(f.type);
                        return (
                          <g key={f.apiName}>
                            {isRel && (
                              <rect
                                x={1}
                                y={fy}
                                width={CARD_WIDTH - 2}
                                height={FIELD_ROW - 2}
                                rx={3}
                                fill={`${dotColor}12`}
                              />
                            )}
                            <circle
                              cx={14}
                              cy={fy + FIELD_ROW / 2 - 1}
                              r={4}
                              fill={dotColor}
                            />
                            <text
                              x={24}
                              y={fy + FIELD_ROW / 2 + 4.5}
                              fontSize={11}
                              fill="#1e293b"
                              fontFamily="system-ui, sans-serif"
                              style={{
                                userSelect: 'none',
                                pointerEvents: 'none',
                              }}
                            >
                              {f.label.length > 17
                                ? f.label.slice(0, 16) + '…'
                                : f.label}
                            </text>
                            <text
                              x={CARD_WIDTH - 8}
                              y={fy + FIELD_ROW / 2 + 4.5}
                              fontSize={9}
                              fill="#94a3b8"
                              fontFamily="system-ui, sans-serif"
                              textAnchor="end"
                              style={{
                                userSelect: 'none',
                                pointerEvents: 'none',
                              }}
                            >
                              {f.type}
                              {f.referenceTo ? ` → ${f.referenceTo}` : ''}
                            </text>
                            {fi < fields.length - 1 && (
                              <line
                                x1={8}
                                y1={fy + FIELD_ROW - 1}
                                x2={CARD_WIDTH - 8}
                                y2={fy + FIELD_ROW - 1}
                                stroke="#f1f5f9"
                                strokeWidth={1}
                              />
                            )}
                          </g>
                        );
                      })}

                    {/* Clickable header overlay — toggle fields on true click only */}
                    <rect
                      width={CARD_WIDTH}
                      height={CARD_HEADER}
                      rx={10}
                      fill="transparent"
                      style={{ cursor: 'pointer' }}
                      onClick={(e) => onHeaderClick(e, obj.apiName)}
                    />
                  </g>
                );
              })}
            </svg>
          )}
        </div>

        {/* Detail panel */}
        {selected &&
          positions[selected] &&
          (() => {
            const obj = objects.find((o) => o.apiName === selected);
            const outgoing = relations.filter((r) => r.from === selected);
            const incoming = relations.filter((r) => r.to === selected);
            return (
              <div className={styles.detailPanel}>
                <div
                  className={styles.detailHeader}
                  style={{ borderBottomColor: obj?.color || '#6366f1' }}
                >
                  <span className={styles.detailTitle}>{obj?.label}</span>
                  <button
                    className={styles.detailClose}
                    onClick={() => setSelected(null)}
                  >
                    ×
                  </button>
                </div>
                <div className={styles.detailBody}>
                  <div className={styles.detailMeta}>
                    <span className={styles.detailMetaLabel}>API Name</span>
                    <code className={styles.detailCode}>{selected}</code>
                  </div>
                  <div className={styles.detailMeta}>
                    <span className={styles.detailMetaLabel}>Fields</span>
                    <span>{(fieldMap[selected] || []).length}</span>
                  </div>
                  <div className={styles.detailMeta}>
                    <span className={styles.detailMetaLabel}>
                      Relationships
                    </span>
                    <span>{outgoing.length + incoming.length}</span>
                  </div>
                  <div className={styles.detailActions}>
                    <button
                      className={styles.detailBtn}
                      onClick={() => navigate(`/setup/objects/${selected}`)}
                    >
                      <Settings size={14} /> Edit Object
                    </button>
                  </div>

                  {outgoing.length > 0 && (
                    <div className={styles.detailFields}>
                      <span className={styles.detailMetaLabel}>References</span>
                      {outgoing.map((r, i) => (
                        <div
                          key={i}
                          className={styles.relItem}
                          style={{
                            borderLeftColor:
                              r.type === 'master_detail'
                                ? '#dc2626'
                                : '#6366f1',
                          }}
                        >
                          <span className={styles.relType}>{r.type}</span>
                          <span>
                            {r.fieldLabel} →{' '}
                            <strong
                              style={{ cursor: 'pointer' }}
                              onClick={() => setSelected(r.to)}
                            >
                              {r.to}
                            </strong>
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {incoming.length > 0 && (
                    <div className={styles.detailFields}>
                      <span className={styles.detailMetaLabel}>
                        Referenced By
                      </span>
                      {incoming.map((r, i) => (
                        <div
                          key={i}
                          className={styles.relItem}
                          style={{
                            borderLeftColor:
                              r.type === 'master_detail'
                                ? '#dc2626'
                                : '#6366f1',
                          }}
                        >
                          <span className={styles.relType}>{r.type}</span>
                          <span>
                            <strong
                              style={{ cursor: 'pointer' }}
                              onClick={() => setSelected(r.from)}
                            >
                              {r.from}
                            </strong>{' '}
                            → {r.fieldLabel}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {outgoing.length === 0 && incoming.length === 0 && (
                    <div className={styles.detailFields}>
                      <span className={styles.noRels}>
                        No relationships on this object
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
      </div>
    </Layout>
  );
}
