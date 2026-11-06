import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Edit2, Play, RefreshCw } from 'lucide-react';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import toast from 'react-hot-toast';
import Layout from '../../layout/Layout';
import Button from '../../components/common/Button/Button';
import { getReportById, runReport } from '../../services/api/reports';
import styles from './Reports.module.css';

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6'];

const getAggLabel = (agg, fieldMap) => {
  if (agg.alias) return agg.alias;
  if (agg.func === 'count') return 'Count';
  const fieldLabel = fieldMap.get(agg.field)?.label || agg.field || '';
  const funcLabels = { sum: 'Sum', avg: 'Average', min: 'Min', max: 'Max' };
  return `${funcLabels[agg.func] || agg.func} of ${fieldLabel}`.trim();
};

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className={styles.chartTooltip}>
      {label !== undefined && <div className={styles.chartTooltipLabel}>{label}</div>}
      {payload.map((p, i) => (
        <div key={i} className={styles.chartTooltipRow}>
          <span className={styles.chartTooltipDot} style={{ background: p.color || p.fill }} />
          <span className={styles.chartTooltipName}>{p.name}:</span>
          <span className={styles.chartTooltipValue}>
            {typeof p.value === 'number' ? p.value.toLocaleString() : (p.value ?? '—')}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function ReportView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [report, setReport] = useState(null);
  const [results, setResults] = useState(null);
  const [fields, setFields] = useState([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await getReportById(id);
        setReport(r);
        await executeReport(r);
      } catch {
        toast.error('Failed to load report');
        navigate('/reports');
      } finally {
        setLoading(false);
      }
    })();
  }, [id, navigate]);

  const executeReport = async (r) => {
    setRunning(true);
    try {
      const config = {
        objectApiName: r.objectApiName,
        groupBy: r.groupBy,
        aggregations: r.aggregations,
        filters: r.filters,
        dateRange: r.dateRange,
        limit: r.limit,
        sortField: r.sortField,
        sortOrder: r.sortOrder,
      };
      if (r.crossObject?.lookupField && r.crossObject?.relatedObject) {
        config.crossObject = r.crossObject;
      }
      const data = await runReport(config);
      setResults(data.results || []);
      setFields(data.fields || []);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Report execution failed');
    } finally {
      setRunning(false);
    }
  };

  if (loading) {
    return <Layout><div className={styles.loading}><div className={styles.spinner} /></div></Layout>;
  }
  if (!report) return null;

  const isGrouped = results?.length > 0 && '_id' in results[0];
  const chartType = report.chartType || 'table';

  return (
    <Layout>
      <div className={styles.page}>
        <div className={styles.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button onClick={() => navigate('/reports')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-gray-500)' }}>
              <ArrowLeft size={20} />
            </button>
            <div>
              <h1 className={styles.title}>{report.name}</h1>
              {report.description && <p className={styles.subtitle}>{report.description}</p>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="secondary" onClick={() => executeReport(report)} disabled={running}>
              <RefreshCw size={14} className={running ? styles.spinner : ''} /> Refresh
            </Button>
            <Button variant="secondary" onClick={() => navigate(`/reports/${id}/edit`)}>
              <Edit2 size={14} /> Edit
            </Button>
          </div>
        </div>

        <div className={styles.resultsCard}>
          {running ? (
            <div className={styles.loading}><div className={styles.spinner} /></div>
          ) : !results || results.length === 0 ? (
            <div className={styles.noResults}>No data found.</div>
          ) : chartType === 'metric' ? (
            <MetricView results={results} aggregations={report.aggregations} />
          ) : !isGrouped || chartType === 'table' ? (
            <TableView results={results} fields={fields} isGrouped={isGrouped} aggregations={report.aggregations} groupBy={report.groupBy} />
          ) : (
            <ChartView results={results} chartType={chartType} aggregations={report.aggregations} groupBy={report.groupBy} fields={fields} reportName={report.name} />
          )}
        </div>
      </div>
    </Layout>
  );
}

function MetricView({ results, aggregations }) {
  const firstAgg = aggregations?.[0];
  const key = firstAgg?.alias || `${firstAgg?.func}_${firstAgg?.field || 'all'}`;
  const isGrouped = results[0] && '_id' in results[0];
  const val = isGrouped
    ? results.reduce((s, r) => s + (r[key] || r.count || 0), 0)
    : (results[0]?.[key] ?? results[0]?.count ?? 0);
  return <div className={styles.metricValue}>{typeof val === 'number' ? val.toLocaleString() : val}</div>;
}

function ChartView({ results, chartType, aggregations, groupBy, fields, reportName }) {
  const fieldMap = new Map((fields || []).map((f) => [f.apiName, f]));
  const groupLabel = (groupBy && fieldMap.get(groupBy)?.label) || groupBy || 'Category';
  const aggDefs = (aggregations || []).map((a) => ({
    key: a.alias || `${a.func}_${a.field || 'all'}`,
    label: getAggLabel(a, fieldMap),
  }));
  if (!aggDefs.length) aggDefs.push({ key: 'count', label: 'Count' });

  const data = (results || []).map((r) => {
    const row = { label: String(r._id ?? 'Unknown') };
    aggDefs.forEach((a) => { row[a.key] = r[a.key] ?? r.count ?? 0; });
    return row;
  });

  if (!data.length) return <div className={styles.noResults}>No data to display.</div>;

  const hasMultiple = aggDefs.length > 1;
  const yLabel = hasMultiple ? undefined : {
    value: aggDefs[0].label,
    angle: -90,
    position: 'insideLeft',
    offset: 10,
    style: { textAnchor: 'middle', fontSize: 12, fill: '#6b7280' },
  };
  const leftMargin = hasMultiple ? 10 : 50;

  if (chartType === 'bar') {
    return (
      <div>
        <h3 className={styles.chartTitle}>{reportName}</h3>
        <ResponsiveContainer width="100%" height={400}>
          <BarChart data={data} margin={{ top: 10, right: 20, bottom: 85, left: leftMargin }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 12, fill: '#6b7280', dy: 4 }}
              tickLine={false}
              angle={-35}
              textAnchor="end"
              height={60}
              label={{ value: groupLabel, position: 'insideBottom', offset: -55, style: { textAnchor: 'middle', fontSize: 12, fill: '#6b7280' } }}
            />
            <YAxis
              tick={{ fontSize: 12, fill: '#6b7280' }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => typeof v === 'number' ? v.toLocaleString() : v}
              label={yLabel}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: 12, paddingTop: 4 }} />
            {aggDefs.map((a, i) => (
              <Bar key={a.key} dataKey={a.key} name={a.label} fill={COLORS[i % COLORS.length]} radius={[4, 4, 0, 0]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }
  if (chartType === 'line') {
    return (
      <div>
        <h3 className={styles.chartTitle}>{reportName}</h3>
        <ResponsiveContainer width="100%" height={400}>
          <LineChart data={data} margin={{ top: 10, right: 20, bottom: 85, left: leftMargin }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 12, fill: '#6b7280', dy: 4 }}
              tickLine={false}
              angle={-35}
              textAnchor="end"
              height={60}
              label={{ value: groupLabel, position: 'insideBottom', offset: -55, style: { textAnchor: 'middle', fontSize: 12, fill: '#6b7280' } }}
            />
            <YAxis
              tick={{ fontSize: 12, fill: '#6b7280' }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => typeof v === 'number' ? v.toLocaleString() : v}
              label={yLabel}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: 12, paddingTop: 4 }} />
            {aggDefs.map((a, i) => (
              <Line key={a.key} type="monotone" dataKey={a.key} name={a.label} stroke={COLORS[i % COLORS.length]} strokeWidth={2.5} dot={{ r: 4, strokeWidth: 2 }} activeDot={{ r: 6 }} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }
  if (chartType === 'pie' || chartType === 'donut') {
    const key = aggDefs[0].key;
    const pieData = data.map((d) => ({ name: d.label, value: d[key] }));
    return (
      <div>
        <h3 className={styles.chartTitle}>{reportName}</h3>
        <ResponsiveContainer width="100%" height={400}>
          <PieChart>
            <Pie
              data={pieData} dataKey="value" nameKey="name"
              cx="50%" cy="50%" outerRadius={140}
              innerRadius={chartType === 'donut' ? 70 : 0}
              paddingAngle={2}
              label={({ name, percent }) => `${name} (${(percent * 100).toFixed(1)}%)`}
              labelLine={{ strokeWidth: 1 }}
            >
              {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
          </PieChart>
        </ResponsiveContainer>
      </div>
    );
  }
  return null;
}

function TableView({ results, fields, isGrouped, aggregations, groupBy }) {
  const fieldMap = new Map((fields || []).map((f) => [f.apiName, f]));
  const groupLabel = (groupBy && fieldMap.get(groupBy)?.label) || groupBy || 'Group';
  const aggLabelMap = new Map();
  (aggregations || []).forEach((a) => {
    const key = a.alias || `${a.func}_${a.field || 'all'}`;
    aggLabelMap.set(key, getAggLabel(a, fieldMap));
  });
  aggLabelMap.set('count', 'Count');

  if (isGrouped) {
    const valueKeys = Object.keys(results[0] || {}).filter((k) => k !== '_id');
    return (
      <div style={{ overflowX: 'auto' }}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{groupLabel}</th>
              {valueKeys.map((k) => <th key={k}>{aggLabelMap.get(k) || k}</th>)}
            </tr>
          </thead>
          <tbody>
            {results.map((r, i) => (
              <tr key={i}>
                <td>{r._id ?? '—'}</td>
                {valueKeys.map((k) => <td key={k}>{typeof r[k] === 'number' ? r[k].toLocaleString() : (r[k] ?? '—')}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  const dataKeys = new Set();
  results.forEach((r) => {
    const d = r.data;
    if (d && typeof d === 'object') Object.keys(d).forEach((k) => dataKeys.add(k));
  });
  const cols = ['name', ...Array.from(dataKeys).filter((k) => k !== 'name')].slice(0, 10);

  return (
    <div style={{ overflowX: 'auto' }}>
      <table className={styles.table}>
        <thead><tr>{cols.map((c) => <th key={c}>{fieldMap.get(c)?.label || c}</th>)}</tr></thead>
        <tbody>
          {results.map((r, i) => {
            const d = r.data || {};
            return (
              <tr key={i}>
                {cols.map((c) => {
                  let val = d[c];
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
