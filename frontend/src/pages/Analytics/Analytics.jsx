import React, { useEffect, useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
} from 'recharts';
import { BarChart2, TrendingUp, RefreshCw } from 'lucide-react';
import api from '../../services/api';
import { useTenantContext } from '../../context/TenantContext';
import Button from '../../components/common/Button/Button';
import Layout from '../../layout/Layout';
import styles from './Analytics.module.css';

const COLORS = [
  '#6366f1',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#3b82f6',
  '#8b5cf6',
];

export default function Analytics() {
  const { objects } = useTenantContext();
  const [overview, setOverview] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [selectedObject, setSelectedObject] = useState('');
  const [reportData, setReportData] = useState([]);
  const [loading, setLoading] = useState(true);
  // Cross-object reporting inputs
  const [relatedLookupField, setRelatedLookupField] = useState('');
  const [relatedObject, setRelatedObject] = useState('');
  const [relatedGroupBy, setRelatedGroupBy] = useState('');

  const fetchData = async () => {
    setLoading(true);
    try {
      const [overviewRes, timelineRes] = await Promise.all([
        api.get('/analytics/overview'),
        api.get('/analytics/records-over-time?interval=day&days=30'),
      ]);
      setOverview(overviewRes.data.data);
      setTimeline(timelineRes.data.data || []);
    } catch (err) {
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const runObjectReport = async (objectApiName) => {
    if (!objectApiName) return;
    try {
      const payload = {
        objectApiName,
        aggregations: [{ field: 'id', func: 'count', alias: 'count' }],
      };
      if (relatedLookupField && relatedObject && relatedGroupBy) {
        payload.relatedLookup = { field: relatedLookupField, object: relatedObject };
        payload.relatedGroupBy = relatedGroupBy;
      } else {
        payload.groupBy = 'status';
      }
      const res = await api.post('/analytics/report', payload);
      setReportData(res.data.data.results || []);
    } catch (err) {}
  };

  useEffect(() => {
    if (selectedObject) runObjectReport(selectedObject);
  }, [selectedObject, relatedLookupField, relatedObject, relatedGroupBy]);

  if (loading)
    return (
      <Layout
        title="Analytics"
        description="Reports, charts, and data insights for your CRM"
      >
        <div className={styles.loading}>
          <div className={styles.spinner} />
        </div>
      </Layout>
    );

  return (
    <Layout
      title="Analytics"
      description="Reports, charts, and data insights for your CRM"
    >
      <div className={styles.page}>
        <div className={styles.header}>
          <div>
            <h1 className={styles.title}>Analytics</h1>
            <p className={styles.subtitle}>Insights across your CRM data</p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            icon={<RefreshCw size={14} />}
            onClick={fetchData}
          >
            Refresh
          </Button>
        </div>

        {/* Overview Stats */}
        {overview && (
          <div className={styles.statsRow}>
            <div className={styles.stat}>
              <span className={styles.statVal}>{overview.objects}</span>
              <span className={styles.statLabel}>Objects</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statVal}>{overview.users}</span>
              <span className={styles.statLabel}>Users</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statVal}>
                {overview.totalRecords?.toLocaleString()}
              </span>
              <span className={styles.statLabel}>Total Records</span>
            </div>
          </div>
        )}

        {/* Timeline chart */}
        {timeline.length > 0 && (
          <div className={styles.chartCard}>
            <h3 className={styles.chartTitle}>
              Records Created - Last 30 Days
            </h3>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={timeline}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--color-gray-200)"
                />
                <XAxis dataKey="_id" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Line
                  type="monotone"
                  dataKey="count"
                  stroke={COLORS[0]}
                  strokeWidth={2}
                  dot={false}
                  name="Records"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Records by object */}
        {overview?.recordsByObject?.length > 0 && (
          <div className={styles.chartsRow}>
            <div className={styles.chartCard}>
              <h3 className={styles.chartTitle}>Records by Object</h3>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={overview.recordsByObject}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="var(--color-gray-200)"
                  />
                  <XAxis dataKey="_id" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Bar
                    dataKey="count"
                    fill={COLORS[0]}
                    radius={[4, 4, 0, 0]}
                    name="Records"
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className={styles.chartCard}>
              <h3 className={styles.chartTitle}>Distribution</h3>
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={overview.recordsByObject}
                    dataKey="count"
                    nameKey="_id"
                    cx="50%"
                    cy="50%"
                    outerRadius={90}
                    label={({ _id, percent }) =>
                      `${_id} ${(percent * 100).toFixed(0)}%`
                    }
                  >
                    {overview.recordsByObject.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Custom report */}
        <div className={styles.reportCard}>
          <h3 className={styles.chartTitle}>Quick Report</h3>
          <div className={styles.reportControls}>
            <select
              className={styles.select}
              value={selectedObject}
              onChange={(e) => setSelectedObject(e.target.value)}
            >
              <option value="">Select an object...</option>
              {objects.map((o) => (
                <option key={o.apiName} value={o.apiName}>
                  {o.label}
                </option>
              ))}
            </select>
            {/* Cross-object reporting inputs */}
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              <input
                className={styles.select}
                placeholder="Lookup field (e.g. deal)"
                value={relatedLookupField}
                onChange={(e) => setRelatedLookupField(e.target.value)}
              />
              <select
                className={styles.select}
                value={relatedObject}
                onChange={(e) => setRelatedObject(e.target.value)}
              >
                <option value="">Related object...</option>
                {objects.map((o) => (
                  <option key={o.apiName} value={o.apiName}>
                    {o.label}
                  </option>
                ))}
              </select>
              <input
                className={styles.select}
                placeholder="Group by related field (e.g. stage)"
                value={relatedGroupBy}
                onChange={(e) => setRelatedGroupBy(e.target.value)}
              />
            </div>
          </div>
          {reportData.length > 0 && (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={reportData}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--color-gray-200)"
                />
                <XAxis dataKey="_id" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" fill={COLORS[1]} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </Layout>
  );
}
