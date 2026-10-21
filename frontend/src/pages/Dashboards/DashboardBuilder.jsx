import React, { useEffect, useState, useCallback } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Save, Share2, Eye } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../services/api';
import Button from '../../components/common/Button/Button';
import WidgetCard from '../../components/dashboard/WidgetCard';
import WidgetConfigModal from '../../components/dashboard/WidgetConfigModal';
import ShareModal from '../../components/dashboard/ShareModal';
import Layout from '../../layout/Layout';
import styles from './DashboardBuilder.module.css';

const uuid = () =>
  crypto.randomUUID?.() ??
  Math.random().toString(36).slice(2) + Date.now().toString(36);

const BLANK_WIDGET = () => ({
  widgetId: uuid(),
  type: 'metric',
  title: '',
  size: 'col-6',
  height: 'normal',
  order: 0,
  config: {},
});

export default function DashboardBuilder() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [dash, setDash] = useState(null);
  const [widgets, setWidgets] = useState([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const [configWidget, setConfigWidget] = useState(null); // widget being configured
  const [shareOpen, setShareOpen] = useState(false);

  useEffect(() => {
    api
      .get(`/dashboards/${id}`)
      .then((res) => {
        const d = res.data.data;
        if (!res.data.canEdit) {
          toast.error('No edit access');
          navigate(`/dashboards/${id}`);
          return;
        }
        setDash(d);
        const sorted = [...(d.widgets || [])].sort(
          (a, b) => (a.order || 0) - (b.order || 0),
        );
        setWidgets(sorted);
      })
      .catch(() => {
        toast.error('Failed to load');
        navigate('/dashboards');
      })
      .finally(() => setLoading(false));
  }, [id, navigate]);

  // Re-assign order values after any mutation
  const reorder = (list) => list.map((w, i) => ({ ...w, order: i }));

  const addWidget = () => {
    const w = { ...BLANK_WIDGET(), order: widgets.length };
    setWidgets((prev) => [...prev, w]);
    setConfigWidget(w); // immediately open config
  };

  const saveConfig = useCallback((updated) => {
    setWidgets((prev) =>
      reorder(prev.map((w) => (w.widgetId === updated.widgetId ? updated : w))),
    );
    setConfigWidget(null);
  }, []);

  const deleteWidget = useCallback((widgetId) => {
    setWidgets((prev) => reorder(prev.filter((w) => w.widgetId !== widgetId)));
  }, []);

  const moveWidget = useCallback((widgetId, dir) => {
    setWidgets((prev) => {
      const idx = prev.findIndex((w) => w.widgetId === widgetId);
      if (idx < 0) return prev;
      const newIdx = idx + dir;
      if (newIdx < 0 || newIdx >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
      return reorder(next);
    });
  }, []);

  const resizeWidget = useCallback((widgetId, prop, val) => {
    setWidgets((prev) =>
      prev.map((w) => (w.widgetId === widgetId ? { ...w, [prop]: val } : w)),
    );
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put(`/dashboards/${id}`, { widgets });
      toast.success('Dashboard saved');
    } catch {
      toast.error('Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleShareSave = async (sharing) => {
    await api.put(`/dashboards/${id}/sharing`, sharing);
    setDash((d) => ({ ...d, sharing }));
    toast.success('Sharing updated');
    setShareOpen(false);
  };

  if (loading)
    return (
      <Layout
        title="Dashboard Builder"
        description="Design and configure your dashboard layout and widgets"
      >
        <div className={styles.loading}>
          <div className={styles.spinner} />
        </div>
      </Layout>
    );
  if (!dash) return null;

  return (
    <Layout
      title="Dashboard Builder"
      description="Design and configure your dashboard layout and widgets"
    >
      <div className={styles.page}>
        {/* Header */}
        <div className={styles.header}>
          <Link to={`/dashboards/${id}`} className={styles.backLink}>
            <ArrowLeft size={16} /> Back to dashboard
          </Link>
          <div className={styles.headerRow}>
            <div>
              <h1 className={styles.title}>Editing — {dash.name}</h1>
              <p className={styles.subtitle}>
                {widgets.length} widget{widgets.length !== 1 ? 's' : ''}
              </p>
            </div>
            <div className={styles.actions}>
              <Button
                variant="secondary"
                size="sm"
                icon={<Share2 size={13} />}
                onClick={() => setShareOpen(true)}
              >
                Share
              </Button>
              <Link to={`/dashboards/${id}`}>
                <Button variant="secondary" size="sm" icon={<Eye size={13} />}>
                  Preview
                </Button>
              </Link>
              <Button
                size="sm"
                icon={<Save size={13} />}
                loading={saving}
                onClick={handleSave}
              >
                Save
              </Button>
            </div>
          </div>
        </div>

        {/* Canvas */}
        {widgets.length === 0 ? (
          <div className={styles.empty}>
            <p>No widgets yet. Add your first widget to get started.</p>
            <Button icon={<Plus size={14} />} onClick={addWidget}>
              Add Widget
            </Button>
          </div>
        ) : (
          <div className={styles.grid}>
            {widgets.map((w) => (
              <WidgetCard
                key={w.widgetId}
                widget={w}
                editing
                totalWidgets={widgets.length}
                onEdit={setConfigWidget}
                onDelete={deleteWidget}
                onMove={moveWidget}
                onResize={resizeWidget}
              />
            ))}
          </div>
        )}

        {/* Add widget button */}
        <button className={styles.addBtn} onClick={addWidget}>
          <Plus size={16} /> Add Widget
        </button>

        {/* Widget config modal */}
        <WidgetConfigModal
          isOpen={!!configWidget}
          widget={configWidget}
          onClose={() => setConfigWidget(null)}
          onSave={saveConfig}
        />

        {/* Share modal */}
        <ShareModal
          isOpen={shareOpen}
          onClose={() => setShareOpen(false)}
          sharing={dash.sharing}
          onSave={handleShareSave}
        />
      </div>
    </Layout>
  );
}
