import styles from './WorkspaceObjects.module.css';
import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import * as LucideIcons from 'lucide-react';
import { ArrowDown, ArrowUp, Box, Check } from 'lucide-react';
import toast from 'react-hot-toast';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getWorkspace,
  updateWorkspaceObjects,
} from '../../../services/api/workspaces';
import { getObjects } from '../../../services/api/objects';
import WorkspaceObjectsSkeleton from './WorkspaceObjectsSkeleton';

const WorkspaceObjects = () => {
  const { id } = useParams();
  const queryClient = useQueryClient();

  const [selectedObjects, setSelectedObjects] = useState(new Set());
  const [isSaving, setIsSaving] = useState(false);

  /* ── Fetch workspace ───────────────────────────── */
  const { data: workspace, isLoading: wsLoading } = useQuery({
    queryKey: ['workspace', id],
    queryFn: () => getWorkspace(id),
    enabled: !!id,
  });

  /* ── Fetch available objects ───────────────────── */
  const { data: objects = [], isLoading: objLoading } = useQuery({
    queryKey: ['objects'],
    queryFn: () => getObjects({ scope: 'all' }),
  });

  /* ── Sync selected objects ─────────────────────── */
  useEffect(() => {
    if (workspace?.allowedObjects) {
      setSelectedObjects(new Set(workspace.allowedObjects));
    }
  }, [workspace]);

  /* ── Toggle ───────────────────────────────────── */
  const toggleObject = (apiName) => {
    setSelectedObjects((prev) => {
      const newSet = new Set(prev);
      newSet.has(apiName) ? newSet.delete(apiName) : newSet.add(apiName);
      return newSet;
    });
  };

  /* ── Tab order ────────────────────────────────── */
  // The selection is kept in insertion order, and that order is the App's
  // navigation order, so moving a tab means rebuilding the set.
  const moveObject = (apiName, dir) => {
    setSelectedObjects((prev) => {
      const list = Array.from(prev);
      const i = list.indexOf(apiName);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= list.length) return prev;
      [list[i], list[j]] = [list[j], list[i]];
      return new Set(list);
    });
  };

  /* ── Save ─────────────────────────────────────── */
  const handleSave = async () => {
    setIsSaving(true);
    try {
      await updateWorkspaceObjects(id, Array.from(selectedObjects));
      toast.success('Workspace updated.');
      queryClient.invalidateQueries({ queryKey: ['workspace', id] }); // refresh this workspace
    } catch (err) {
      toast.error(
        err?.response?.data?.message || err.message || 'Save failed.',
      );
    } finally {
      setIsSaving(false);
    }
  };

  /* ── Loading states ───────────────────────────── */
  if (wsLoading || objLoading) {
    return <WorkspaceObjectsSkeleton />;
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h3 className={styles.title}>Workspace Objects</h3>
          <p className={styles.description}>
            Select which CRM objects are available in this workspace
          </p>
        </div>

        <button
          className={styles.saveBtn}
          onClick={handleSave}
          disabled={isSaving}
        >
          {isSaving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>

      <div className={styles.objectGrid}>
        {objects.map((obj) => {
          const isSelected = selectedObjects.has(obj.apiName);

          // Dynamically resolve icon
          const Icon = LucideIcons[obj.icon] || Box;

          return (
            <div
              key={obj.apiName}
              className={`${styles.objectCard} ${
                isSelected ? styles.selected : ''
              }`}
              onClick={() => toggleObject(obj.apiName)}
            >
              <div className={styles.objectIcon}>
                <Icon size={20} />
              </div>

              <div className={styles.objectInfo}>
                <div className={styles.objectName}>{obj.name}</div>
                <div className={styles.objectApi}>{obj.apiName}</div>
              </div>

              {isSelected && (
                <div className={styles.checkIcon}>
                  <Check size={16} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {selectedObjects.size > 0 && (
        <div className={styles.order}>
          <h4 className={styles.orderTitle}>Tab order</h4>
          <p className={styles.description}>
            The order these appear in this workspace&apos;s navigation. Another workspace can
            order the same objects differently.
          </p>
          <ol className={styles.orderList}>
            {Array.from(selectedObjects).map((apiName, i, all) => {
              const obj = objects.find((o) => o.apiName === apiName);
              return (
                <li key={apiName} className={styles.orderRow}>
                  <span className={styles.orderName}>{obj?.pluralLabel || obj?.name || apiName}</span>
                  <span className={styles.orderTools}>
                    <button
                      type="button"
                      className={styles.orderBtn}
                      title="Move up"
                      disabled={i === 0}
                      onClick={() => moveObject(apiName, -1)}
                    >
                      <ArrowUp size={14} />
                    </button>
                    <button
                      type="button"
                      className={styles.orderBtn}
                      title="Move down"
                      disabled={i === all.length - 1}
                      onClick={() => moveObject(apiName, 1)}
                    >
                      <ArrowDown size={14} />
                    </button>
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      <div className={styles.footer}>
        <div className={styles.footerInfo}>
          <Box size={16} />
          <span>{selectedObjects.size} objects selected</span>
        </div>
      </div>
    </div>
  );
};

export default WorkspaceObjects;
