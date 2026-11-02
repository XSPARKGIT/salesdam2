import styles from './WorkspaceObjects.module.css';
import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import * as LucideIcons from 'lucide-react';
import { Box, Check } from 'lucide-react';
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
