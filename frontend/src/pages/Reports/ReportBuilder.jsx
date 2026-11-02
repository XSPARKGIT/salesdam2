import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Play, Save, Plus, X,
  BarChart2, TrendingUp, PieChart as PieIcon, Table2, Hash,
} from 'lucide-react';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import toast from 'react-hot-toast';
import Layout from '../../layout/Layout';
import Button from '../../components/common/Button/Button';
import api from '../../services/api';
import { getReportById, createReport, updateReport, runReport } from '../../services/api/reports';
import styles from './Reports.module.css';

const CHART_TYPES = [
  { value: 'table', label: 'Table', icon: Table2 },
  { value: 'bar', label: 'Bar', icon: BarChart2 },
  { value: 'line', label: 'Line', icon: TrendingUp },
  { value: 'pie', label: 'Pie', icon: PieIcon },
  { value: 'metric', label: 'Metric', icon: Hash },
];

const AGG_FUNCS = [
  { value: 'count', label: 'Count' },
  { value: 'sum', label: 'Sum' },
  { value: 'avg', label: 'Average' },
  { value: 'min', label: 'Min' },
  { value: 'max', label: 'Max' },
];

const OPERATORS = [
  { value: 'eq', label: '=' },
  { value: 'neq', label: '≠' },
  { value: 'gt', label: '>' },
  { value: 'gte', label: '≥' },
  { value: 'lt', label: '<' },
  { value: 'lte', label: '≤' },
  { value: 'contains', label: 'contains' },
  { value: 'not_contains', label: 'not contains' },
  { value: 'starts_with', label: 'starts with' },
  { value: 'in', label: 'in' },
  { value: 'is_null', label: 'is empty' },
  { value: 'is_not_null', label: 'is not empty' },
  { value: 'between', label: 'between' },
];

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6'];

const NUMERIC_TYPES = new Set(['number', 'currency', 'percent', 'rollup_summary']);
const GROUPABLE_TYPES = new Set(['picklist', 'multipicklist', 'boolean', 'text', 'lookup', 'master_detail']);

export default function ReportBuilder() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isEdit = Boolean(id);

  // Object list
  const { data: objects = [] } = useQuery({
    queryKey: ['objects', 'readable'],
    queryFn: () =>
      api.get('/objects', { params: { scope: 'readable', includeFields: true } })
        .then((res) => res.data?.data || []),
  });

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [objectApiName, setObjectApiName] = useState('');
  const [groupBy, setGroupBy] = useState('');
  const [aggregations, setAggregations] = useState([{ func: 'count', field: '', alias: '' }]);
  const [filters, setFilters] = useState([]);
  const [chartType, setChartType] = useState('bar');
  const [limit, setLimit] = useState(100);
  const [crossLookupField, setCrossLookupField] = useState('');
  const [crossRelatedObject, setCrossRelatedObject] = useState('');
  const [crossRelatedGroupBy, setCrossRelatedGroupBy] = useState('');

  // Results
  const [results, setResults] = useState(null);
  const [resultFields, setResultFields] = useState([]);
  const [running, setRunning] = useState(false);

  // Load existing report
  useEffect(() => {
    if (!id) return;
    getReportById(id).then((r) => {
      setName(r.name || '');
      setDescription(r.description || '');
      setObjectApiName(r.objectApiName || '');
      setGroupBy(r.groupBy || '');
      setAggregations(r.aggregations?.length ? r.aggregations : [{ func: 'count', field: '', alias: '' }]);
      setFilters(r.filters || []);
      setChartType(r.chartType || 'bar');
      setLimit(r.limit || 100);
      setCrossLookupField(r.crossObject?.lookupField || '');
      setCrossRelatedObject(r.crossObject?.relatedObject || '');
      setCrossRelatedGroupBy(r.crossObject?.relatedGroupBy || '');
    }).catch(() => {
      toast.error('Failed to load report');
      navigate('/reports');
    });
  }, [id, navigate]);

  const selectedObj = useMemo(
    () => objects.find((o) => o.apiName === objectApiName),
    [objects, objectApiName],
  );
  const fields = useMemo(() => selectedObj?.fields || [], [selectedObj]);
  const numericFields = useMemo(() => fields.filter((f) => NUMERIC_TYPES.has(f.type)), [fields]);
  const groupableFields = useMemo(() => fields.filter((f) => GROUPABLE_TYPES.has(f.type)), [fields]);
  const lookupFields = useMemo(() => fields.filter((f) => f.type === 'lookup' || f.type === 'master_detail'), [fields]);

  // Related object fields for cross-object
  const relatedObj = useMemo(
    () => objects.find((o) => o.apiName === crossRelatedObject),
    [objects, crossRelatedObject],
  );
  const relatedFields = useMemo(() => relatedObj?.fields || [], [relatedObj]);

  const buildConfig = useCallback(() => {
    const config = { objectApiName, limit };
    if (groupBy) config.groupBy = groupBy;
    if (aggregations.some((a) => a.func)) config.aggregations = aggregations.filter((a) => a.func);
    if (filters.length > 0) config.filters = filters.filter((f) => f.field);
    if (crossLookupField && crossRelatedObject) {
      config.crossObject = {
        lookupField: crossLookupField,
        relatedObject: crossRelatedObject,
        relatedGroupBy: crossRelatedGroupBy || undefined,
      };
    }
    return config;
  }, [objectApiName, groupBy, aggregations, filters, limit, crossLookupField, crossRelatedObject, crossRelatedGroupBy]);

  const handleRun = async () => {
    if (!objectApiName) { toast.error('Select an object'); return; }
    setRunning(true);
    try {
      const data = await runReport(buildConfig());
      setResults(data.results || []);
      setResultFields(data.fields || []);
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Report failed');
    } finally {
      setRunning(false);
    }
  };

  const saveMutation = useMutation({
    mutationFn: (payload) => isEdit ? updateReport(id, payload) : createReport(payload),
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      toast.success(isEdit ? 'Report updated' : 'Report saved');
      if (!isEdit) navigate(`/reports/${saved._id}`);
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Save failed'),
  });

  const handleSave = () => {
    if (!name.trim()) { toast.error('Enter a report name'); return; }
    if (!objectApiName) { toast.error('Select an object'); return; }
    saveMutation.mutate({
      name, description, chartType, limit,
      ...buildConfig(),
      crossObject: crossLookupField && crossRelatedObject
        ? { lookupField: crossLookupField, relatedObject: crossRelatedObject, relatedGroupBy: crossRelatedGroupBy }
        : undefined,
    });
  };

  // Filter helpers
  const addFilter = () => setFilters((prev) => [...prev, { field: '', operator: 'eq', value: '' }]);
  const updateFilter = (i, key, val) => setFilters((prev) => prev.map((f, idx) => idx === i ? { ...f, [key]: val } : f));
  const removeFilter = (i) => setFilters((prev) => prev.filter((_, idx) => idx !== i));

  // Aggregation helpers
  const addAgg = () => setAggregations((prev) => [...prev, { func: 'count', field: '', alias: '' }]);
  const updateAgg = (i, key, val) => setAggregations((prev) => prev.map((a, idx) => idx === i ? { ...a, [key]: val } : a));
  const removeAgg = (i) => setAggregations((prev) => prev.filter((_, idx) => idx !== i));

  // Reset fields when object changes
  const handleObjectChange = (val) => {
    setObjectApiName(val);
    setGroupBy('');
    setFilters([]);
    setResults(null);
    setCrossLookupField('');
    setCrossRelatedObject('');
    setCrossRelatedGroupBy('');
  };

  return (
    <Layout>
      <div className={styles.page}>
        <div className={styles.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button onClick={() => navigate('/reports')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-gray-500)' }}>
              <ArrowLeft size={20} />
            </button>
            <div>
              <h1 className={styles.title}>{isEdit ? 'Edit Report' : 'New Report'}</h1>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="secondary" onClick={handleRun} disabled={running || !objectApiName}>
              <Play size={14} /> {running ? 'Running…' : 'Run'}
            </Button>
            <Button onClick={handleSave} loading={saveMutation.isPending}>
              <Save size={14} /> Save
            </Button>
          </div>
        </div>

        <div className={styles.builderLayout}>
          {/* Sidebar config */}
          <div className={styles.sidebar}>
            <div className={styles.section}>
              <div className={styles.sectionTitle}>Report Info</div>
              <div className={styles.field}>
                <label className={styles.label}>Name</label>
                <input className={styles.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="My Report" />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Description</label>
                <input className={styles.input} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
              </div>
            </div>

            <div className={styles.section}>
              <div className={styles.sectionTitle}>Data Source</div>
              <div className={styles.field}>
                <label className={styles.label}>Object</label>
                <select className={styles.select} value={objectApiName} onChange={(e) => handleObjectChange(e.target.value)}>
                  <option value="">Select object…</option>
                  {objects.map((o) => (
                    <option key={o.apiName} value={o.apiName}>{o.label || o.name}</option>
                  ))}
                </select>
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Group By</label>
                <select className={styles.select} value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
                  <option value="">None (raw records)</option>
                  {fields.map((f) => (
                    <option key={f.apiName} value={f.apiName}>{f.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className={styles.section}>
              <div className={styles.sectionTitle}>Aggregations</div>
              {aggregations.map((agg, i) => (
                <div key={i} className={styles.aggRow}>
                  <select className={styles.select} value={agg.func} onChange={(e) => updateAgg(i, 'func', e.target.value)}>
                    {AGG_FUNCS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                  </select>
                  {agg.func !== 'count' && (
                    <select className={styles.select} value={agg.field} onChange={(e) => updateAgg(i, 'field', e.target.value)}>
                      <option value="">Field…</option>
                      {numericFields.map((f) => <option key={f.apiName} value={f.apiName}>{f.label}</option>)}
                    </select>
                  )}
                  {aggregations.length > 1 && (
                    <button className={styles.removeBtn} onClick={() => removeAgg(i)}><X size={14} /></button>
                  )}
                </div>
              ))}
              <button className={styles.addBtn} onClick={addAgg}><Plus size={12} /> Add</button>
            </div>

            <div className={styles.section}>
              <div className={styles.sectionTitle}>Filters</div>
              {filters.map((f, i) => (
                <div key={i}>
                  <div className={styles.filterRow}>
                    <select className={styles.select} value={f.field} onChange={(e) => updateFilter(i, 'field', e.target.value)}>
                      <option value="">Field…</option>
                      {fields.map((fd) => <option key={fd.apiName} value={fd.apiName}>{fd.label}</option>)}
                      <option value="createdAt">Created Date</option>
                      <option value="updatedAt">Updated Date</option>
                    </select>
                    <select className={styles.select} value={f.operator} onChange={(e) => updateFilter(i, 'operator', e.target.value)}>
                      {OPERATORS.map((op) => <option key={op.value} value={op.value}>{op.label}</option>)}
                    </select>
                    <button className={styles.removeBtn} onClick={() => removeFilter(i)}><X size={14} /></button>
                  </div>
                  {!['is_null', 'is_not_null'].includes(f.operator) && (
                    <div className={styles.filterRow} style={{ marginTop: 4 }}>
                      {(() => {
                        const meta = fields.find((fd) => fd.apiName === f.field);
                        if (meta?.type === 'picklist' && meta.picklistValues?.length > 0) {
                          return (
                            <select className={styles.select} value={f.value || ''} onChange={(e) => updateFilter(i, 'value', e.target.value)}>
                              <option value="">Value…</option>
                              {meta.picklistValues.filter((pv) => pv.isActive !== false).map((pv) => (
                                <option key={pv.value} value={pv.value}>{pv.label}</option>
                              ))}
                            </select>
                          );
                        }
                        if (meta?.type === 'boolean') {
                          return (
                            <select className={styles.select} value={f.value ?? ''} onChange={(e) => updateFilter(i, 'value', e.target.value === 'true')}>
                              <option value="">Value…</option>
                              <option value="true">Yes</option>
                              <option value="false">No</option>
                            </select>
                          );
                        }
                        return (
                          <input
                            className={styles.input}
                            type={['date', 'datetime'].includes(meta?.type) || ['createdAt', 'updatedAt'].includes(f.field) ? 'date' : 'text'}
                            value={f.value || ''}
                            onChange={(e) => updateFilter(i, 'value', e.target.value)}
                            placeholder="Value"
                          />
                        );
                      })()}
                      {f.operator === 'between' && (
                        <input className={styles.input} type="text" value={f.value2 || ''} onChange={(e) => updateFilter(i, 'value2', e.target.value)} placeholder="Value 2" />
                      )}
                    </div>
                  )}
                </div>
              ))}
              <button className={styles.addBtn} onClick={addFilter}><Plus size={12} /> Add Filter</button>
            </div>

            {lookupFields.length > 0 && (
              <div className={styles.section}>
                <div className={styles.sectionTitle}>Cross-Object</div>
                <div className={styles.field}>
                  <label className={styles.label}>Lookup Field</label>
                  <select className={styles.select} value={crossLookupField} onChange={(e) => {
                    setCrossLookupField(e.target.value);
                    const lf = lookupFields.find((f) => f.apiName === e.target.value);
                    if (lf?.lookupObjectApiName) setCrossRelatedObject(lf.lookupObjectApiName);
                  }}>
                    <option value="">None</option>
                    {lookupFields.map((f) => <option key={f.apiName} value={f.apiName}>{f.label} → {f.lookupObjectApiName}</option>)}
                  </select>
                </div>
                {crossRelatedObject && (
                  <div className={styles.field}>
                    <label className={styles.label}>Group by (related)</label>
                    <select className={styles.select} value={crossRelatedGroupBy} onChange={(e) => setCrossRelatedGroupBy(e.target.value)}>
                      <option value="">None</option>
                      {relatedFields.map((f) => <option key={f.apiName} value={f.apiName}>{f.label}</option>)}
                    </select>
                  </div>
                )}
              </div>
            )}

            <div className={styles.section}>
              <div className={styles.sectionTitle}>Chart Type</div>
              <div className={styles.chartTypeRow}>
                {CHART_TYPES.map(({ value, label, icon: Icon }) => (
                  <button
                    key={value}
                    className={`${styles.chartTypeBtn} ${chartType === value ? styles.active : ''}`}
                    onClick={() => setChartType(value)}
                  >
                    <Icon size={14} /> {label}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Limit</label>
              <input className={styles.input} type="number" min={1} max={1000} value={limit} onChange={(e) => setLimit(parseInt(e.target.value) || 100)} />
            </div>
          </div>

          {/* Results area */}
          <div className={styles.mainArea}>
            <div className={styles.resultsCard}>
              {running ? (
                <div className={styles.loading}><div className={styles.spinner} /></div>
              ) : !results ? (
                <div className={styles.placeholder}>
                  <BarChart2 size={40} strokeWidth={1} />
                  <p>Select an object and click Run to see results</p>
                </div>
              ) : results.length === 0 ? (
                <div className={styles.noResults}>No data found for this configuration.</div>
              ) : (
                <ResultsRenderer
                  results={results}
                  chartType={chartType}
                  groupBy={groupBy || crossRelatedGroupBy}
                  aggregations={aggregations}
                  fields={resultFields}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}

function ResultsRenderer({ results, chartType, groupBy, aggregations, fields }) {
  const isGrouped = results.length > 0 && '_id' in results[0];

  if (chartType === 'metric') {
    const firstAgg = aggregations[0];
    const key = firstAgg?.alias || `${firstAgg?.func}_${firstAgg?.field || 'all'}`;
    const val = isGrouped ? results.reduce((s, r) => s + (r[key] || r.count || 0), 0) : (results[0]?.[key] ?? results[0]?.count ?? 0);
    return <div className={styles.metricValue}>{typeof val === 'number' ? val.toLocaleString() : val}</div>;
  }

  if (!isGrouped || chartType === 'table') {
    return <TableResult results={results} fields={fields} isGrouped={isGrouped} aggregations={aggregations} />;
  }

  const data = results.map((r) => ({
    label: r._id ?? 'Unknown',
    value: r[aggregations[0]?.alias || `${aggregations[0]?.func}_${aggregations[0]?.field || 'all'}`] ?? r.count ?? 0,
  }));

  if (chartType === 'bar') {
    return (
      <ResponsiveContainer width="100%" height={360}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="label" tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} />
          <Tooltip />
          <Bar dataKey="value" fill="#6366f1" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    );
  }

  if (chartType === 'line') {
    return (
      <ResponsiveContainer width="100%" height={360}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="label" tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} />
          <Tooltip />
          <Line type="monotone" dataKey="value" stroke="#6366f1" strokeWidth={2} dot={{ r: 4 }} />
        </LineChart>
      </ResponsiveContainer>
    );
  }

  if (chartType === 'pie' || chartType === 'donut') {
    return (
      <ResponsiveContainer width="100%" height={360}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="label"
            cx="50%" cy="50%"
            outerRadius={130}
            innerRadius={chartType === 'donut' ? 70 : 0}
            label={({ label, percent }) => `${label} (${(percent * 100).toFixed(0)}%)`}
          >
            {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
          </Pie>
          <Tooltip />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    );
  }

  return <TableResult results={results} fields={fields} isGrouped={isGrouped} aggregations={aggregations} />;
}

function TableResult({ results, fields, isGrouped, aggregations }) {
  if (isGrouped) {
    const aggKeys = aggregations.map((a) => a.alias || `${a.func}_${a.field || 'all'}`);
    const valueKeys = Object.keys(results[0] || {}).filter((k) => k !== '_id');
    const cols = valueKeys.length > 0 ? valueKeys : aggKeys;

    return (
      <div style={{ overflowX: 'auto' }}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Group</th>
              {cols.map((k) => <th key={k}>{k}</th>)}
            </tr>
          </thead>
          <tbody>
            {results.map((r, i) => (
              <tr key={i}>
                <td>{r._id ?? 'Unknown'}</td>
                {cols.map((k) => <td key={k}>{typeof r[k] === 'number' ? r[k].toLocaleString() : (r[k] ?? '—')}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // Raw records
  const dataKeys = new Set();
  results.forEach((r) => {
    const d = r.data;
    if (d instanceof Map || (d && typeof d.entries === 'function')) {
      for (const [k] of d.entries()) dataKeys.add(k);
    } else if (d && typeof d === 'object') {
      Object.keys(d).forEach((k) => dataKeys.add(k));
    }
  });
  const cols = ['name', ...Array.from(dataKeys).filter((k) => k !== 'name')].slice(0, 10);
  const fieldMap = new Map(fields.map((f) => [f.apiName, f]));

  return (
    <div style={{ overflowX: 'auto' }}>
      <table className={styles.table}>
        <thead>
          <tr>
            {cols.map((c) => <th key={c}>{fieldMap.get(c)?.label || c}</th>)}
          </tr>
        </thead>
        <tbody>
          {results.map((r, i) => {
            const d = r.data instanceof Map ? Object.fromEntries(r.data) : (r.data || {});
            return (
              <tr key={i}>
                {cols.map((c) => {
                  let val = d[c];
                  if (val && typeof val === 'object' && val.$numberDecimal) val = parseFloat(val.$numberDecimal);
                  if (typeof val === 'number') val = val.toLocaleString();
                  return <td key={c}>{val ?? '—'}</td>;
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
