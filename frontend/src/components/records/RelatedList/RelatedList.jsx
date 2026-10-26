import styles from './RelatedList.module.css';
import { useEffect, useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as LucideIcons from 'lucide-react';
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Columns,
  Check,
  X,
  ExternalLink,
  Save,
} from 'lucide-react';
import api from '../../../services/api';
import useCurrency from '../../../hooks/useCurrency';
import { resolveDisplayType } from '../../../utils/fieldDisplayType';
import { updateRelatedListColumns, getFormBundle } from '../../../services/api/objects';
import { createRecord, getRecord } from '../../../services/api/records';
import Button from '../../common/Button/Button';
import Modal from '../../common/Modal/Modal';
import Field from '../../common/Field/Field';
import ActionMenu from './ActionMenu';
import RelatedListSkeleton from './RelatedListSkeleton';
import toast from 'react-hot-toast';
import { useObjectPermissions } from '../../../hooks/useObjectPermissions';
import { withoutHelperFields } from '../../../utils/fieldVisibility';
import { extractServerErrors } from '../../../utils/serverErrors';

// ─── Build sections from form fields ──────────────────────────────────────
const buildModalSections = (fields) => {
  if (!fields) return [];

  const grouped = {};
  // Helper fields are computed feeds for rollups / formulas — never shown in
  // the inline create or edit modal.
  withoutHelperFields(fields)
    .filter((f) => f.apiName !== '_id' && f.apiName !== 'tenantId')
    .forEach((f) => {
      const sec = f.section || 'Information';
      if (!grouped[sec]) grouped[sec] = [];
      grouped[sec].push(f);
    });

  return Object.entries(grouped).map(([label, sFields], i) => ({
    id: `section_${i}`,
    label,
    fields: sFields,
  }));
};

// ─── Module-level lookup cache (shared with RecordList) ──────────────────────
const _lookupCache = new Map();

const resolveLookupLabel = (objectApiName, id, displayField = 'name') => {
  if (!id) return Promise.resolve('—');
  const key = `${objectApiName}:${id}`;
  if (_lookupCache.has(key)) return _lookupCache.get(key);

  const promise = (async () => {
    try {
      if (objectApiName === 'user') {
        const res = await api.get(`/users/${id}`);
        const u = res.data.data;
        return `${u.firstName} ${u.lastName}`;
      } else {
        const res = await api.get(`/records/${objectApiName}/${id}`);
        const rec = res.data.data;
        return (
          rec[displayField] ||
          (rec.first_name
            ? `${rec.first_name || ''} ${rec.last_name || ''}`.trim()
            : null) ||
          rec.name ||
          String(id).slice(-8)
        );
      }
    } catch {
      return String(id).slice(-8);
    }
  })();

  _lookupCache.set(key, promise);
  return promise;
};

// ─── Lookup cell that resolves asynchronously ─────────────────────────────────
const LookupCell = ({ field, value }) => {
  const [label, setLabel] = useState(null);
  useEffect(() => {
    if (!value || !field.lookupObjectApiName) {
      setLabel('—');
      return;
    }
    let cancelled = false;
    resolveLookupLabel(
      field.lookupObjectApiName,
      value,
      field.lookupDisplayField || 'name',
    ).then((l) => {
      if (!cancelled) setLabel(l);
    });
    return () => {
      cancelled = true;
    };
  }, [value, field.lookupObjectApiName, field.lookupDisplayField]);

  if (!value) return '—';
  if (label === null)
    return (
      <span style={{ color: 'var(--color-gray-400)', fontStyle: 'italic' }}>
        …
      </span>
    );
  return <span>{label}</span>;
};

const RELATED_COL_KEY = (parent, child) =>
  `crm-related-cols-${parent}-${child}`;

/**
 * RelatedList — Shows records from a related object (e.g., Contacts on an Account).
 * Supports inline field chooser with persistence to localStorage.
 */
const RelatedList = ({
  parentObjectApiName,
  parentId,
  relatedField,
  relatedObjectMeta,
  allRelatedFields,
  isThrough = false,
  junctionObjectMeta = null,
  junctionRelatedField = null,
}) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { symbol } = useCurrency();
  const perms = useObjectPermissions(relatedObjectMeta?.apiName);
  const [collapsed, setCollapsed] = useState(false);
  const [showColChooser, setShowColChooser] = useState(false);
  const [selectedCols, setSelectedCols] = useState(null);
  const [draftCols, setDraftCols] = useState([]);
  const [page, setPage] = useState(1);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createFormData, setCreateFormData] = useState({});
  const [createErrors, setCreateErrors] = useState({});
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [editRecord, setEditRecord] = useState(null);
  const [editFormData, setEditFormData] = useState({});
  const [editErrors, setEditErrors] = useState({});
  const [isCreating, setIsCreating] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const PAGE_SIZE = 5;

  // Default column selection: first 4 non-system fields
  const defaultCols = useMemo(() => {
    return withoutHelperFields(allRelatedFields)
      .filter(
        (f) =>
          !['_id', 'tenantId', 'description', 'richtext', 'textarea'].includes(
            f.apiName,
          ) && f.type !== 'textarea',
      )
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .slice(0, 4)
      .map((f) => f.apiName);
  }, [allRelatedFields]);

  useEffect(() => {
    if (!relatedField) return;

    const cols =
      relatedField?.relatedListConfig?.columns?.length > 0
        ? relatedField.relatedListConfig.columns
            .sort((a, b) => a.order - b.order)
            .map((c) => c.fieldApiName)
        : defaultCols;

    setSelectedCols(cols);
  }, [relatedField, defaultCols]);

  // Query key for related records
  const relatedQueryKey = [
    'related-records',
    relatedObjectMeta?.apiName,
    parentObjectApiName,
    parentId,
    relatedField?.apiName,
    isThrough ? 'through' : 'direct',
    page,
  ];

  // Fetch related records using useQuery
  const { data: relatedData, isLoading } = useQuery({
    queryKey: relatedQueryKey,
    queryFn: async () => {
      if (!relatedField?.apiName || !parentId) {
        return { data: [], pagination: { total: 0 } };
      }

      // Through-object query: A → Junction → B
      // junctionRelatedField points from junction to US (parent A)
      // relatedField points from junction to the other side (B)
      if (isThrough && junctionObjectMeta && junctionRelatedField) {
        const junctionFilter = { [junctionRelatedField.apiName]: parentId };
        const jRes = await api.get(`/records/${junctionObjectMeta.apiName}`, {
          params: {
            page: 1,
            limit: 200,
            filter: JSON.stringify(junctionFilter),
            sort: '-createdAt',
          },
        });
        const junctionRecords = jRes.data.data || [];

        // Extract IDs of the other-side (B) records
        const otherIds = junctionRecords
          .map((jr) => jr[relatedField.apiName])
          .filter(Boolean);

        if (otherIds.length === 0) return { data: [], pagination: { total: 0 } };

        // Fetch B records by their IDs
        const bRes = await api.get(`/records/${relatedObjectMeta.apiName}`, {
          params: {
            page,
            limit: PAGE_SIZE,
            filter: JSON.stringify({ _id: { $in: otherIds } }),
            sort: '-createdAt',
          },
        });
        return {
          data: bRes.data.data || [],
          pagination: bRes.data.pagination || { total: otherIds.length },
        };
      }

      // Direct relationship query
      const filter = { [relatedField.apiName]: parentId };
      const res = await api.get(`/records/${relatedObjectMeta.apiName}`, {
        params: {
          page,
          limit: PAGE_SIZE,
          filter: JSON.stringify(filter),
          sort: '-createdAt',
        },
      });
      return {
        data: res.data.data || [],
        pagination: res.data.pagination || { total: 0 },
      };
    },
    enabled: !!relatedField?.apiName && !!parentId && !!relatedObjectMeta?.apiName,
  });

  const records = relatedData?.data || [];
  const total = relatedData?.pagination?.total || 0;

  const displayFields = (allRelatedFields || []).filter((f) =>
    selectedCols?.includes(f.apiName),
  );

  const renderCellValue = (field, value) => {
    if (value === null || value === undefined || value === '') return '—';
    // Formula fields render as their declared return type — see resolveDisplayType.
    switch (resolveDisplayType(field)) {
      case 'lookup':
      case 'master_detail':
        return <LookupCell field={field} value={value} />;
      case 'date':
        return new Date(value).toLocaleDateString();
      case 'datetime':
        return new Date(value).toLocaleString();
      case 'currency':
        return `${symbol}${parseFloat(value).toLocaleString()}`;
      case 'boolean':
        return value ? 'Yes' : 'No';
      case 'picklist': {
        const pv = field.picklistValues?.find((p) => p.value === value);
        return (
          <span
            className={styles.badge}
            style={
              pv?.color ? { background: `${pv.color}20`, color: pv.color } : {}
            }
          >
            {pv?.label || value}
          </span>
        );
      }
      default:
        return String(value).length > 40
          ? String(value).slice(0, 40) + '…'
          : String(value);
    }
  };

  const saveColumns = async (cols) => {
    try {
      await updateRelatedListColumns({
        parentObjectApiName,
        childObjectApiName: relatedObjectMeta?.apiName,
        lookupFieldApiName: relatedField?.apiName,
        columns: cols,
      });

      setSelectedCols(cols);
      setShowColChooser(false);
    } catch (e) {
      console.error(e);
    }
  };

  const openColChooser = () => {
    setDraftCols(selectedCols || defaultCols);
    setShowColChooser(true);
  };

  const toggleDraftCol = (apiName) => {
    setDraftCols((prev) => {
      if (prev.includes(apiName)) {
        return prev.length > 1 ? prev.filter((c) => c !== apiName) : prev;
      }
      if (prev.length >= 6) return prev;
      return [...prev, apiName];
    });
  };

  const { data: formBundle, isLoading: formBundleLoading } = useQuery({
    queryKey: ['form-bundle', relatedObjectMeta?.apiName, showCreateModal],
    queryFn: () => getFormBundle(relatedObjectMeta?.apiName),
    enabled: showCreateModal && !!relatedObjectMeta?.apiName,
  });

  const { data: editFormBundle, isLoading: editFormBundleLoading } = useQuery({
    queryKey: ['form-bundle', relatedObjectMeta?.apiName, 'edit', editRecord],
    queryFn: () => getFormBundle(relatedObjectMeta?.apiName),
    enabled: !!editRecord && !!relatedObjectMeta?.apiName,
  });

  // Create handler - using query invalidation instead of mutations
  const handleCreate = async () => {
    setIsCreating(true);
    try {
      await createRecord(relatedObjectMeta?.apiName, createFormData);
      toast.success('Record created');
      setShowCreateModal(false);
      setCreateFormData({});
      setCreateErrors({});

      // Invalidate queries to refetch data
      queryClient.invalidateQueries({ queryKey: ['record-detail', parentObjectApiName, parentId] });
      queryClient.invalidateQueries({ queryKey: relatedQueryKey });
      setPage(1);
    } catch (err) {
      // Highlight whatever the server pinned to a field (duplicate value on a
      // unique field, bad email, failed regex) instead of only showing a toast.
      const { fieldErrors, message } = extractServerErrors(
        err,
        formBundle?.fields || [],
      );
      if (Object.keys(fieldErrors).length > 0) setCreateErrors(fieldErrors);
      toast.error(message);
    } finally {
      setIsCreating(false);
    }
  };

  // Delete handler - using query invalidation instead of mutations
  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.delete(`/records/${relatedObjectMeta?.apiName}/${deleteConfirm}`);
      toast.success('Record deleted');
      setDeleteConfirm(null);

      // Invalidate queries to refetch data
      queryClient.invalidateQueries({ queryKey: ['record-detail', parentObjectApiName, parentId] });
      queryClient.invalidateQueries({ queryKey: relatedQueryKey });
      setPage(1);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to delete record');
    } finally {
      setDeleting(false);
    }
  };

  // Update handler - using query invalidation instead of mutations
  const handleUpdate = async () => {
    setIsUpdating(true);
    try {
      await api.put(`/records/${relatedObjectMeta?.apiName}/${editRecord}`, editFormData);
      toast.success('Record updated');
      setEditRecord(null);
      setEditFormData({});
      setEditErrors({});

      // Invalidate queries to refetch data
      queryClient.invalidateQueries({ queryKey: ['record-detail', parentObjectApiName, parentId] });
      queryClient.invalidateQueries({ queryKey: relatedQueryKey });
      setPage(1);
    } catch (err) {
      const { fieldErrors, message } = extractServerErrors(
        err,
        editFormBundle?.fields || [],
      );
      if (Object.keys(fieldErrors).length > 0) setEditErrors(fieldErrors);
      toast.error(message);
    } finally {
      setIsUpdating(false);
    }
  };

  const openCreateModal = () => {
    // A policy is sold through the new business wizard (application → quote →
    // acceptance → issue), never created as a bare record.
    if (relatedObjectMeta?.apiName === 'policy') {
      const params = new URLSearchParams();
      if (parentObjectApiName === 'client') params.set('client', parentId);
      if (parentObjectApiName === 'lead') params.set('lead', parentId);
      navigate(`/insurance/new-business${params.size ? `?${params}` : ''}`);
      return;
    }
    setCreateFormData({
      [relatedField?.apiName]: parentId,
    });
    setCreateErrors({});
    setShowCreateModal(true);
  };

  const handleEditRecord = (recordId) => {
    const record = records.find((r) => (r.id || r._id) === recordId);
    if (record) {
      setEditRecord(recordId);
      setEditFormData(record);
      setEditErrors({});
    }
  };

  const handleDeleteRecord = (recordId) => {
    setDeleteConfirm(recordId);
  };

  const confirmDelete = async () => {
    handleDelete();
  };

  const handleEditFormChange = async (apiName, value) => {
    setEditFormData((prev) => ({ ...prev, [apiName]: value }));
    if (editErrors[apiName]) {
      setEditErrors((prev) => ({ ...prev, [apiName]: '' }));
    }

    // Auto-populate unit_price when product is selected in deal_line_item or order_line_item
    if (apiName === 'product' && value && (relatedObjectMeta?.apiName === 'deal_line_item' || relatedObjectMeta?.apiName === 'order_line_item')) {
      try {
        const product = await getRecord('product', value);
        if (product && product.price) {
          setEditFormData((prev) => ({ ...prev, unit_price: product.price }));
        }
      } catch (err) {
        console.error('Error fetching product:', err);
      }
    }
  };

  const handleEditSubmit = async () => {
    const fields = editFormBundle?.fields || [];
    const errs = {};

    fields.forEach((f) => {
      if ((f?.isRequired || f?.validations?.required) && !f?.isReadOnly && f?.type !== 'auto_number' && f?.type !== 'formula') {
        const val = editFormData[f.apiName];
        if (val === undefined || val === null || val === '') {
          errs[f.apiName] = `${f.label} is required`;
        }
      }
    });

    if (Object.keys(errs).length > 0) {
      setEditErrors(errs);
      toast.error('Please complete required fields');
      return;
    }

    await handleUpdate();
  };

  const handleCreateFormChange = async (apiName, value) => {
    setCreateFormData((prev) => ({ ...prev, [apiName]: value }));
    if (createErrors[apiName]) {
      setCreateErrors((prev) => ({ ...prev, [apiName]: '' }));
    }

    // Auto-populate unit_price when product is selected in deal_line_item or order_line_item
    if (apiName === 'product' && value && (relatedObjectMeta?.apiName === 'deal_line_item' || relatedObjectMeta?.apiName === 'order_line_item')) {
      try {
        const product = await getRecord('product', value);
        if (product && product.price) {
          setCreateFormData((prev) => ({ ...prev, unit_price: product.price }));
        }
      } catch (err) {
        console.error('Error fetching product:', err);
      }
    }
  };

  const handleCreateSubmit = async () => {
    const fields = formBundle?.fields || [];
    const errs = {};

    fields.forEach((f) => {
      if (f?.isRequired || f?.validations?.required) {
        const val = createFormData[f.apiName];
        if (val === undefined || val === null || val === '') {
          errs[f.apiName] = `${f.label} is required`;
        }
      }
    });

    if (Object.keys(errs).length > 0) {
      setCreateErrors(errs);
      toast.error('Please complete required fields');
      return;
    }

    // Check for duplicate products in deal_line_item and order_line_item
    const isDealLineItem = relatedObjectMeta?.apiName === 'deal_line_item';
    const isOrderLineItem = relatedObjectMeta?.apiName === 'order_line_item';

    if ((isDealLineItem || isOrderLineItem) && createFormData.product) {
      const duplicateExists = records.some((record) => record.product === createFormData.product);

      if (duplicateExists) {
        const itemType = isDealLineItem ? 'deal' : 'order';
        const message = `This product already exists on this ${itemType}. Please update the quantity of the existing line item instead.`;
        errs.product = message;
        setCreateErrors(errs);
        toast.error(message);
        return;
      }
    }

    await handleCreate();
  };

  const objLabel =
    relatedObjectMeta?.pluralLabel || relatedObjectMeta?.apiName || 'Related';

  return (
    <div className={styles.relatedList}>
      {/* Header */}
      <div className={styles.header} onClick={() => setCollapsed((c) => !c)}>
        <span className={styles.toggle}>
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </span>
        <div
          className={styles.objIcon}
          style={{
            background: `${relatedObjectMeta?.color || '#6366f1'}20`,
            color: relatedObjectMeta?.color || '#6366f1',
          }}
        >
          {(() => {
            const IconComp =
              LucideIcons[relatedObjectMeta?.icon] || LucideIcons.Box;
            return <IconComp size={14} />;
          })()}
        </div>
        <span className={styles.title}>
          {objLabel}
          {isThrough && junctionObjectMeta && (
            <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--color-gray-400)', marginLeft: 6 }}>
              via {junctionObjectMeta.label}
            </span>
          )}
        </span>
        <span className={styles.count}>{total}</span>
        <div
          className={styles.headerActions}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className={`${styles.colBtn} ${showColChooser ? styles.active : ''}`}
            onClick={openColChooser}
            title="Choose columns"
          >
            <Columns size={13} />
          </button>
          {!isThrough && !['quote', 'invoice'].includes(relatedObjectMeta?.apiName) && (
            <button
              className={styles.addBtn}
              onClick={openCreateModal}
              title={`New ${relatedObjectMeta?.label}`}
            >
              <Plus size={13} /> New
            </button>
          )}
        </div>
      </div>

      {/* Column chooser popup */}
      {showColChooser && (
        <div className={styles.colChooserPopup}>
          <div className={styles.colChooserHeader}>
            <span>Choose Columns</span>
            <button onClick={() => setShowColChooser(false)}>
              <X size={14} />
            </button>
          </div>
          <div className={styles.colChooserList}>
            {(allRelatedFields || [])
              .filter((f) => !['_id', 'tenantId'].includes(f.apiName))
              .sort((a, b) => a.displayOrder - b.displayOrder)
              .map((f) => {
                const selected = draftCols.includes(f.apiName);
                const disabled = !selected && draftCols.length >= 6;

                return (
                  <div
                    key={f.apiName}
                    className={`${styles.colChooserItem} ${
                      selected ? styles.selected : ''
                    } ${disabled ? styles.disabled : ''}`}
                    onClick={() => {
                      if (!disabled) toggleDraftCol(f.apiName);
                    }}
                  >
                    <div className={styles.colCheck}>
                      {selected && <Check size={12} />}
                    </div>

                    <span className={styles.colLabel}>{f.label}</span>

                    <span className={styles.colType}>{f.type}</span>
                  </div>
                );
              })}
          </div>
          <div className={styles.colChooserFooter}>
            <button
              className={styles.colReset}
              onClick={() => setDraftCols(defaultCols)}
            >
              Reset
            </button>
            <button
              className={styles.colApply}
              onClick={() => saveColumns(draftCols)}
            >
              <Check size={12} /> Apply
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      {!collapsed && (
        <>
          {isLoading ? (
            <RelatedListSkeleton columnCount={displayFields?.length || 4} />
          ) : (
            <div className={styles.tableWrap}>
              {records.length === 0 ? (
                <div className={styles.empty}>
                  No {objLabel.toLowerCase()} found.
                  {!isThrough && !['quote', 'invoice'].includes(relatedObjectMeta?.apiName) && (
                    <>
                      {' '}
                      <button
                        className={styles.emptyCreate}
                        onClick={openCreateModal}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--color-primary)',
                          cursor: 'pointer',
                          fontWeight: 'var(--font-weight-medium)',
                          textDecoration: 'underline',
                        }}
                      >
                        Create one
                      </button>
                    </>
                  )}
                </div>
              ) : (
                <>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th className={styles.th} style={{ width: 40 }} />
                        {displayFields?.map((f) => (
                          <th key={f.apiName} className={styles.th}>
                            {f.label}
                          </th>
                        ))}
                        <th className={styles.th} style={{ width: 40 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {records.map((row) => {
                        const rowId = row.id || row._id;
                        return (
                          <tr
                            key={rowId}
                            className={styles.tr}
                            onClick={() =>
                              navigate(`/o/${relatedObjectMeta?.apiName}/${rowId}`)
                            }
                          >
                            <td className={styles.td} onClick={(e) => e.stopPropagation()}>
                              <ActionMenu
                                onEdit={() => handleEditRecord(rowId)}
                                onDelete={() => handleDeleteRecord(rowId)}
                                canEdit={perms?.canUpdate}
                                canDelete={perms?.canDelete}
                              />
                            </td>
                            {displayFields.map((f) => (
                              <td key={f.apiName} className={styles.td}>
                                {renderCellValue(f, row[f.apiName])}
                              </td>
                            ))}
                            <td className={styles.td}>
                              <Link
                                to={`/o/${relatedObjectMeta?.apiName}/${rowId}`}
                                className={styles.openLink}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <ExternalLink size={12} />
                              </Link>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>

                  {/* Mini pagination */}
                  {total > PAGE_SIZE && (
                    <div className={styles.pagination}>
                      <button
                        className={styles.pageBtn}
                        disabled={page <= 1 || isLoading}
                        onClick={(e) => {
                          e.stopPropagation();
                          setPage(page - 1);
                        }}
                      >
                        ‹ Prev
                      </button>
                      <span className={styles.pageInfo}>
                        {page} / {Math.ceil(total / PAGE_SIZE)}
                      </span>
                      <button
                        className={styles.pageBtn}
                        disabled={page >= Math.ceil(total / PAGE_SIZE) || isLoading}
                        onClick={(e) => {
                          e.stopPropagation();
                          setPage(page + 1);
                        }}
                      >
                        Next ›
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}

      {/* Create modal */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title={`New ${relatedObjectMeta?.label}`}
        size="lg"
        footer={
          <div style={{ display: 'flex', gap: 'var(--spacing-3)', justifyContent: 'flex-end' }}>
            <Button
              variant="secondary"
              onClick={() => setShowCreateModal(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateSubmit}
              loading={isCreating}
              icon={<Save size={14} />}
            >
              Create
            </Button>
          </div>
        }
      >
        {formBundleLoading ? (
          <div style={{ textAlign: 'center', padding: '20px' }}>Loading…</div>
        ) : (
          <div>
            {buildModalSections(formBundle?.fields).map((section) => (
              <div key={section.id} style={{ marginBottom: 'var(--spacing-5)' }}>
                <h4 style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-semibold)', color: 'var(--color-gray-500)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 'var(--spacing-3)', paddingBottom: 'var(--spacing-2)', borderBottom: '1px solid var(--border-color)' }}>{section.label}</h4>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, 1fr)',
                    gap: 'var(--spacing-4) var(--spacing-6)',
                  }}
                >
                  {section.fields.map((field) => {
                    const isReadOnly =
                      field.isReadOnly ||
                      field.type === 'auto_number' ||
                      field.type === 'formula';

                    if (isReadOnly) {
                      return (
                        <div key={field.apiName} style={{ minWidth: 0 }}>
                          <label style={{ display: 'block', fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-medium)', color: 'var(--color-gray-700)', marginBottom: 'var(--spacing-1)' }}>
                            {field.label}
                          </label>
                          <div style={{ color: 'var(--color-gray-400)', fontStyle: 'italic' }}>
                            {createFormData[field.apiName]
                              ? String(createFormData[field.apiName])
                              : '—'}
                          </div>
                        </div>
                      );
                    }

                    return (
                      <Field
                        key={field.apiName}
                        field={field}
                        value={createFormData[field.apiName]}
                        onChange={handleCreateFormChange}
                        error={createErrors[field.apiName]}
                        disableCreate={field.type === 'master_detail'}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>

      {/* Edit modal */}
      <Modal
        isOpen={!!editRecord}
        onClose={() => setEditRecord(null)}
        title={`Edit ${relatedObjectMeta?.label}`}
        size="lg"
        footer={
          <div style={{ display: 'flex', gap: 'var(--spacing-3)', justifyContent: 'flex-end' }}>
            <Button
              variant="secondary"
              onClick={() => setEditRecord(null)}
              disabled={isUpdating}
            >
              Cancel
            </Button>
            <Button
              onClick={handleEditSubmit}
              loading={isUpdating}
              icon={<Save size={14} />}
            >
              Save
            </Button>
          </div>
        }
      >
        {editFormBundleLoading ? (
          <div style={{ textAlign: 'center', padding: '20px' }}>Loading…</div>
        ) : (
          <div>
            {buildModalSections(editFormBundle?.fields).map((section) => (
              <div key={section.id} style={{ marginBottom: 'var(--spacing-5)' }}>
                <h4 style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-semibold)', color: 'var(--color-gray-500)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 'var(--spacing-3)', paddingBottom: 'var(--spacing-2)', borderBottom: '1px solid var(--border-color)' }}>{section.label}</h4>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, 1fr)',
                    gap: 'var(--spacing-4) var(--spacing-6)',
                  }}
                >
                  {section.fields.map((field) => {
                    const isReadOnly =
                      field.isReadOnly ||
                      field.type === 'auto_number' ||
                      field.type === 'formula';

                    if (isReadOnly) {
                      return (
                        <div key={field.apiName} style={{ minWidth: 0 }}>
                          <label style={{ display: 'block', fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-medium)', color: 'var(--color-gray-700)', marginBottom: 'var(--spacing-1)' }}>
                            {field.label}
                          </label>
                          <div style={{ color: 'var(--color-gray-400)', fontStyle: 'italic' }}>
                            {editFormData[field.apiName]
                              ? String(editFormData[field.apiName])
                              : '—'}
                          </div>
                        </div>
                      );
                    }

                    return (
                      <Field
                        key={field.apiName}
                        field={field}
                        value={editFormData[field.apiName]}
                        onChange={handleEditFormChange}
                        error={editErrors[field.apiName]}
                        disableCreate={field.type === 'lookup' || field.type === 'master_detail'}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>

      {/* Delete confirmation modal */}
      <Modal
        isOpen={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        title="Delete Record"
        size="sm"
        footer={
          <div style={{ display: 'flex', gap: 'var(--spacing-3)', justifyContent: 'flex-end' }}>
            <Button
              variant="secondary"
              onClick={() => setDeleteConfirm(null)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={confirmDelete}
              loading={deleting}
            >
              Delete
            </Button>
          </div>
        }
      >
        <p>Are you sure you want to delete this {relatedObjectMeta?.label}? This action cannot be undone.</p>
      </Modal>
    </div>
  );
};

export default RelatedList;
