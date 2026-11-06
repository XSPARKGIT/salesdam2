import React, { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Plus,
  FileText,
  Edit2,
  Trash2,
  Search,
  Copy,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../services/api';
import Button from '../../components/common/Button/Button';
import Layout from '../../layout/Layout';
import styles from './PdfTemplateList.module.css';

export default function PdfTemplateList() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [tmplRes, catRes] = await Promise.all([
        api.get('/pdf-templates', {
          params: {
            search: search || undefined,
            category: activeCategory || undefined,
          },
        }),
        api.get('/pdf-templates/categories'),
      ]);
      setTemplates(tmplRes.data.data || []);
      setCategories(catRes.data.data || []);
    } catch {
      toast.error('Failed to load PDF templates');
    } finally {
      setLoading(false);
    }
  }, [search, activeCategory]);

  useEffect(() => {
    load();
  }, [load]);

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this PDF template?')) return;
    try {
      await api.delete(`/pdf-templates/${id}`);
      toast.success('Deleted');
      load();
    } catch {
      toast.error('Delete failed');
    }
  };

  const handleToggle = async (tmpl) => {
    try {
      await api.put(`/pdf-templates/${tmpl._id}`, { isActive: !tmpl.isActive });
      setTemplates((prev) =>
        prev.map((t) =>
          t._id === tmpl._id ? { ...t, isActive: !t.isActive } : t,
        ),
      );
    } catch {
      toast.error('Failed to update');
    }
  };

  const handleDuplicate = async (tmpl) => {
    try {
      const res = await api.post(`/pdf-templates/${tmpl._id}/duplicate`);
      toast.success('Template duplicated');
      navigate(`/setup/pdf-templates/${res.data.data._id}`);
    } catch {
      toast.error('Duplicate failed');
    }
  };

  const handleRender = async (tmpl) => {
    const recordId = window.prompt('Enter record ID to generate PDF:');
    if (!recordId) return;
    try {
      const res = await api.get(`/pdf-templates/${tmpl._id}/render`, {
        params: { recordId },
        responseType: 'blob',
      });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${tmpl.apiName || 'document'}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('PDF generated and downloaded');
    } catch (err) {
      toast.error(err?.response?.data?.message || 'PDF generation failed');
    }
  };

  const grouped = templates.reduce((acc, t) => {
    const cat = t.category || 'General';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(t);
    return acc;
  }, {});

  return (
    <Layout
      title="PDF Templates"
      description="Drag-and-drop PDF document templates for flows"
    >
      <div className={styles.page}>
        <div className={styles.header}>
          <div>
            <h1 className={styles.title}>PDF Templates</h1>
            <p className={styles.subtitle}>
              Design reusable PDF documents for invoices, policies, reports, and
              more
            </p>
          </div>
          <Link to="/setup/pdf-templates/new">
            <Button icon={<Plus size={14} />}>New Template</Button>
          </Link>
        </div>

        <div className={styles.filters}>
          <div className={styles.searchWrap}>
            <Search size={14} className={styles.searchIcon} />
            <input
              className={styles.searchInput}
              placeholder="Search templates…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className={styles.catFilters}>
            <button
              className={`${styles.catBtn} ${activeCategory === '' ? styles.catActive : ''}`}
              onClick={() => setActiveCategory('')}
            >
              All
            </button>
            {categories.map((c) => (
              <button
                key={c}
                className={`${styles.catBtn} ${activeCategory === c ? styles.catActive : ''}`}
                onClick={() => setActiveCategory(c)}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className={styles.loading}>Loading…</div>
        ) : templates.length === 0 ? (
          <div className={styles.empty}>
            <FileText size={40} className={styles.emptyIcon} />
            <p>No PDF templates yet. Create one to get started.</p>
            <Link to="/setup/pdf-templates/new">
              <Button>New Template</Button>
            </Link>
          </div>
        ) : (
          Object.entries(grouped).map(([cat, list]) => (
            <div key={cat} className={styles.group}>
              <div className={styles.groupHeader}>{cat}</div>
              <div className={styles.grid}>
                {list.map((tmpl) => (
                  <div
                    key={tmpl._id}
                    className={`${styles.card} ${!tmpl.isActive ? styles.cardInactive : ''}`}
                  >
                    <div className={styles.cardIcon}>
                      <FileText size={24} />
                    </div>
                    <div className={styles.cardBody}>
                      <div className={styles.cardName}>{tmpl.name}</div>
                      {tmpl.description && (
                        <div className={styles.cardDesc}>
                          {tmpl.description}
                        </div>
                      )}
                      <div className={styles.cardMeta}>
                        <span className={styles.metaTag}>
                          {tmpl.pageSettings?.size || 'A4'}
                        </span>
                        <span className={styles.metaTag}>
                          {tmpl.pageSettings?.orientation || 'portrait'}
                        </span>
                        <span
                          className={`${styles.metaTag} ${tmpl.isActive ? styles.tagActive : styles.tagInactive}`}
                        >
                          {tmpl.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                    </div>
                    <div className={styles.cardActions}>
                      <button
                        className={styles.actionBtn}
                        title="Edit"
                        onClick={() =>
                          navigate(`/setup/pdf-templates/${tmpl._id}`)
                        }
                      >
                        <Edit2 size={14} />
                      </button>
                      <button
                        className={styles.actionBtn}
                        title="Generate PDF"
                        onClick={() => handleRender(tmpl)}
                      >
                        <FileText size={14} />
                      </button>
                      <button
                        className={styles.actionBtn}
                        title="Duplicate"
                        onClick={() => handleDuplicate(tmpl)}
                      >
                        <Copy size={14} />
                      </button>
                      <button
                        className={styles.actionBtn}
                        title={tmpl.isActive ? 'Deactivate' : 'Activate'}
                        onClick={() => handleToggle(tmpl)}
                      >
                        {tmpl.isActive ? (
                          <ToggleRight size={14} />
                        ) : (
                          <ToggleLeft size={14} />
                        )}
                      </button>
                      <button
                        className={`${styles.actionBtn} ${styles.deleteBtn}`}
                        title="Delete"
                        onClick={() => handleDelete(tmpl._id)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </Layout>
  );
}
