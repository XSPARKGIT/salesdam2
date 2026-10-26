import React, { useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { GripVertical } from 'lucide-react';
import api from '../../../../services/api';
import styles from './RecordKanban.module.css';

const SYSTEM_KEYS = new Set(['id', 'objectApiName', 'createdAt', 'updatedAt', 'createdBy', 'lastModifiedBy', 'ownerId', '_id', '__v', 'tenantId', 'isDeleted']);

function getRecordTitle(record, objectMeta, fields) {
  const nameKey = objectMeta?.nameFieldApiName || 'name';
  if (record[nameKey]) return String(record[nameKey]);
  // Fall back to first non-empty string/number field that isn't a system key
  for (const f of fields) {
    if (SYSTEM_KEYS.has(f.apiName)) continue;
    if (['text', 'email', 'phone', 'url', 'textarea', 'number', 'auto_number'].includes(f.type)) {
      const v = record[f.apiName];
      if (v !== undefined && v !== null && v !== '') return String(v);
    }
  }
  return record.id || '—';
}

function RecordKanban({ records, objectMeta, onRecordUpdate, fields = [] }) {
  const [draggedRecord, setDraggedRecord] = useState(null);
  const [dragOverColumn, setDragOverColumn] = useState(null);
  const { objectApiName } = useParams();

  // Get kanban field from object meta or provided fields array
  const kanbanField = useMemo(() => {
    if (!objectMeta?.kanbanConfig?.enabled) return null;
    const fieldApiName = objectMeta.kanbanConfig.fieldApiName;
    if (!fieldApiName) return null;
    // Try to find field in the provided fields array first (has full details with picklistValues)
    // Fall back to objectMeta.fields if not found
    return fields.find((f) => f.apiName === fieldApiName) ||
           objectMeta.fields?.find((f) => f.apiName === fieldApiName);
  }, [objectMeta, fields]);

  // Group records by kanban field value
  const groupedRecords = useMemo(() => {
    if (!kanbanField) return {};

    const grouped = {};
    (kanbanField.picklistValues || []).forEach((pv) => {
      grouped[pv.value] = [];
    });

    (records || []).forEach((record) => {
      const value = record[kanbanField.apiName];
      if (value && Object.hasOwn(grouped, value)) {
        grouped[value].push(record);
      }
    });

    return grouped;
  }, [records, kanbanField]);

  const handleDragStart = (e, record) => {
    setDraggedRecord(record);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', record._id);
  };

  const handleDragOver = (e, columnValue) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverColumn(columnValue);
  };

  const handleDragLeave = () => {
    setDragOverColumn(null);
  };

  const handleDrop = async (e, columnValue) => {
    e.preventDefault();
    setDragOverColumn(null);
    if (!draggedRecord || !kanbanField) return;

    if (draggedRecord[kanbanField.apiName] === columnValue) {
      setDraggedRecord(null);
      return;
    }

    try {
      const recordId = draggedRecord._id || draggedRecord.id;
      // Update the record. Kanban moves are partial field updates, so use PATCH;
      // the backend only skips required-field validation for PATCH requests.
      await api.patch(`/records/${objectApiName}/${recordId}`, {
        [kanbanField.apiName]: columnValue,
      });

      toast.success(`Updated ${draggedRecord.name || draggedRecord.subject}`);
      if (onRecordUpdate) {
        onRecordUpdate();
      }
    } catch (err) {
      console.error('Update error:', err);
      toast.error(err.response?.data?.message || 'Failed to update record');
    } finally {
      setDraggedRecord(null);
    }
  };

  if (!kanbanField) {
    return (
      <div className={styles.emptyState}>
        <p>Kanban view is not configured for this object</p>
      </div>
    );
  }

  return (
    <div className={styles.kanban}>
      <div className={styles.columns}>
        {(kanbanField.picklistValues || []).map((picklistValue) => (
          <div
            key={picklistValue.value}
            className={`${styles.column} ${
              dragOverColumn === picklistValue.value ? styles.dragOver : ''
            }`}
            onDragOver={(e) => handleDragOver(e, picklistValue.value)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, picklistValue.value)}
          >
            <div className={styles.columnHeader}>
              <h3 className={styles.columnTitle}>{picklistValue.label}</h3>
              <span className={styles.columnCount}>
                {(groupedRecords[picklistValue.value] || []).length}
              </span>
            </div>

            <div className={styles.cardList}>
              {(groupedRecords[picklistValue.value] || []).map((record) => (
                <div
                  key={record._id || record.id}
                  className={`${styles.card} ${
                    draggedRecord?._id === record._id || draggedRecord?.id === record.id ? styles.dragging : ''
                  }`}
                  draggable
                  onDragStart={(e) => handleDragStart(e, record)}
                >
                  <div className={styles.cardContent}>
                    <div className={styles.cardTitle}>
                      {getRecordTitle(record, objectMeta, fields)}
                    </div>
                    <div className={styles.cardMeta}>
                      {fields
                        .filter((f) => {
                          if (SYSTEM_KEYS.has(f.apiName)) return false;
                          if (f.apiName === (objectMeta?.nameFieldApiName || 'name')) return false;
                          if (f.apiName === kanbanField?.apiName) return false;
                          const v = record[f.apiName];
                          return v !== undefined && v !== null && v !== '' && v !== false;
                        })
                        .slice(0, 2)
                        .map((f) => (
                          <span key={f.apiName} className={styles.cardField}>
                            <span className={styles.cardFieldLabel}>{f.label}:</span>{' '}
                            {typeof record[f.apiName] === 'object'
                              ? record[f.apiName]?.fullName || record[f.apiName]?.firstName || String(record[f.apiName])
                              : String(record[f.apiName])}
                          </span>
                        ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default RecordKanban;
