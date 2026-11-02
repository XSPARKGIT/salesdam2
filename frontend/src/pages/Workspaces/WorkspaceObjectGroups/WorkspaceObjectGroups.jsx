import styles from './WorkspaceObjectGroups.module.css';
import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import * as LucideIcons from 'lucide-react';
import { Plus, Trash2, ChevronDown, Save, Box, Check } from 'lucide-react';
import toast from 'react-hot-toast';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getWorkspace,
  updateWorkspaceObjectGroups,
} from '../../../services/api/workspaces';
import { getObjects } from '../../../services/api/objects';
import Button from '../../../components/common/Button/Button';
import WorkspaceObjectGroupsSkeleton from './WorkspaceObjectGroupsSkeleton';

const WorkspaceObjectGroups = () => {
  const { id } = useParams();
  const queryClient = useQueryClient();

  const [groups, setGroups] = useState([]);
  const [isSaving, setIsSaving] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState(new Set());
  const [newGroupName, setNewGroupName] = useState('');
  const [isInitialized, setIsInitialized] = useState(false);
  const [draggedItem, setDraggedItem] = useState(null);
  const [dragOverSection, setDragOverSection] = useState(null);

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

  /* ── Sync groups on initial load only ──────────── */
  useEffect(() => {
    if (workspace?.objectGroups && !isInitialized) {
      setGroups(workspace.objectGroups);
      setExpandedGroups(new Set(workspace.objectGroups.map((_, i) => i)));
      setIsInitialized(true);
    }
  }, [workspace?._id, isInitialized]);

  /* ── Toggle group expansion ────────────────────── */
  const toggleGroupExpand = (groupIndex) => {
    setExpandedGroups((prev) => {
      const newSet = new Set(prev);
      newSet.has(groupIndex)
        ? newSet.delete(groupIndex)
        : newSet.add(groupIndex);
      return newSet;
    });
  };

  /* ── Add new group ─────────────────────────────── */
  const handleAddGroup = () => {
    if (!newGroupName.trim()) {
      toast.error('Group name cannot be empty');
      return;
    }

    const newGroup = {
      name: newGroupName,
      objectApiNames: [],
    };

    setGroups([...groups, newGroup]);
    setExpandedGroups((prev) => new Set([...prev, groups.length]));
    setNewGroupName('');
  };

  /* ── Remove group ──────────────────────────────── */
  const handleRemoveGroup = (groupIndex) => {
    if (
      window.confirm(
        `Delete group "${groups[groupIndex].name}"? Objects will not be deleted.`,
      )
    ) {
      setGroups(groups.filter((_, i) => i !== groupIndex));
      setExpandedGroups(
        (prev) =>
          new Set(
            Array.from(prev)
              .filter((i) => i !== groupIndex)
              .map((i) => (i > groupIndex ? i - 1 : i)),
          ),
      );
    }
  };

  /* ── Update group name ─────────────────────────── */
  const handleUpdateGroupName = (groupIndex, newName) => {
    const updatedGroups = [...groups];
    updatedGroups[groupIndex].name = newName;
    setGroups(updatedGroups);
  };

  /* ── Toggle object in group ────────────────────── */
  const toggleObjectInGroup = (groupIndex, objectApiName) => {
    const updatedGroups = [...groups];
    const apiNames = updatedGroups[groupIndex].objectApiNames;

    if (apiNames.includes(objectApiName)) {
      updatedGroups[groupIndex].objectApiNames = apiNames.filter(
        (name) => name !== objectApiName,
      );
    } else {
      updatedGroups[groupIndex].objectApiNames = [...apiNames, objectApiName];
    }

    setGroups(updatedGroups);
  };

  /* ── Drag and drop handlers ────────────────────────── */
  const handleDragStart = (groupIndex, objectIndex, objectApiName) => {
    setDraggedItem({ groupIndex, objectIndex, objectApiName, source: 'group' });
  };

  const handleDragStartAvailable = (objectApiName) => {
    setDraggedItem({ objectApiName, source: 'available' });
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDropOnGroup = (targetGroupIndex, targetPosition) => {
    if (!draggedItem) return;

    const updatedGroups = [...groups];

    if (draggedItem.source === 'group') {
      const { groupIndex: sourceGroupIndex, objectIndex: sourceObjectIndex, objectApiName } = draggedItem;

      if (sourceGroupIndex === targetGroupIndex) {
        // Reordering within same group
        const objectApiNames = [...updatedGroups[sourceGroupIndex].objectApiNames];
        objectApiNames.splice(sourceObjectIndex, 1);
        objectApiNames.splice(targetPosition, 0, objectApiName);
        updatedGroups[sourceGroupIndex].objectApiNames = objectApiNames;
      } else {
        // Moving from one group to another
        updatedGroups[sourceGroupIndex].objectApiNames = updatedGroups[sourceGroupIndex].objectApiNames.filter(
          name => name !== objectApiName
        );
        updatedGroups[targetGroupIndex].objectApiNames.splice(targetPosition, 0, objectApiName);
      }
    } else if (draggedItem.source === 'available') {
      // Adding from available objects
      const { objectApiName } = draggedItem;
      if (!updatedGroups[targetGroupIndex].objectApiNames.includes(objectApiName)) {
        updatedGroups[targetGroupIndex].objectApiNames.splice(targetPosition, 0, objectApiName);
      }
    }

    setGroups(updatedGroups);
    setDraggedItem(null);
    setDragOverSection(null);
  };

  const handleDropOnAvailable = () => {
    if (!draggedItem || draggedItem.source !== 'group') return;

    const updatedGroups = [...groups];
    const { groupIndex: sourceGroupIndex, objectApiName } = draggedItem;

    updatedGroups[sourceGroupIndex].objectApiNames = updatedGroups[sourceGroupIndex].objectApiNames.filter(
      name => name !== objectApiName
    );

    setGroups(updatedGroups);
    setDraggedItem(null);
    setDragOverSection(null);
  };

  /* ── Save ──────────────────────────────────────── */
  const handleSave = async () => {
    setIsSaving(true);
    try {
      await updateWorkspaceObjectGroups(id, groups);
      toast.success('Object groups updated.');
      queryClient.invalidateQueries({ queryKey: ['workspace', id] });
    } catch (err) {
      toast.error(
        err?.response?.data?.message || err.message || 'Save failed.',
      );
    } finally {
      setIsSaving(false);
    }
  };

  if (wsLoading || objLoading) {
    return <WorkspaceObjectGroupsSkeleton />;
  }

  // Filter to only show objects that are allowed in this workspace
  const allowedObjectNames = new Set(workspace?.allowedObjects || []);
  const allowedObjects = objects.filter((obj) =>
    allowedObjectNames.has(obj.apiName),
  );

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div>
          <h3 className={styles.title}>Object Groups</h3>
          <p className={styles.description}>
            Organize your CRM objects into groups that appear collapsed in the sidebar
          </p>
        </div>
      </div>

      <div className={styles.groupsList}>
        {groups.map((group, groupIndex) => (
          <div key={groupIndex} className={styles.groupCard}>
            <div className={styles.groupHeader}>
              <button
                className={styles.expandBtn}
                onClick={() => toggleGroupExpand(groupIndex)}
              >
                <ChevronDown
                  size={16}
                  style={{
                    transform: expandedGroups.has(groupIndex)
                      ? 'rotate(0deg)'
                      : 'rotate(-90deg)',
                    transition: 'transform 0.2s ease',
                  }}
                />
              </button>

              <input
                type="text"
                className={styles.groupNameInput}
                value={group.name}
                onChange={(e) =>
                  handleUpdateGroupName(groupIndex, e.target.value)
                }
                placeholder="Group name"
              />

              <span className={styles.objectCount}>
                {group.objectApiNames.length}
              </span>

              <button
                className={styles.deleteBtn}
                onClick={() => handleRemoveGroup(groupIndex)}
                title="Delete group"
              >
                <Trash2 size={14} />
              </button>
            </div>

            {expandedGroups.has(groupIndex) && (
              <div className={styles.groupContent}>
                {/* Group Objects Section */}
                <div
                  style={{
                    padding: '8px',
                    backgroundColor: dragOverSection === `group-${groupIndex}` ? '#f0f9ff' : 'transparent',
                    border: dragOverSection === `group-${groupIndex}` ? '2px dashed #0ea5e9' : '2px dashed transparent',
                    borderRadius: '6px',
                    transition: 'all 0.2s ease',
                  }}
                  onDragOver={(e) => {
                    handleDragOver(e);
                    setDragOverSection(`group-${groupIndex}`);
                  }}
                  onDragLeave={() => setDragOverSection(null)}
                  onDrop={() => handleDropOnGroup(groupIndex, group.objectApiNames.length)}
                >
                  <div style={{ fontSize: '12px', fontWeight: '600', color: '#64748b', marginBottom: '8px', marginLeft: '0' }}>
                    Group Objects (drag to reorder or remove)
                  </div>
                  <div className={styles.objectGrid} style={{ minHeight: '60px' }}>
                    {group.objectApiNames.length === 0 ? (
                      <div style={{ gridColumn: '1 / -1', textAlign: 'center', color: '#94a3b8', fontSize: '13px', padding: '20px' }}>
                        Drag objects here to add them to the group
                      </div>
                    ) : (
                      group.objectApiNames.map((apiName, objectIndex) => {
                        const obj = allowedObjects.find(o => o.apiName === apiName);
                        if (!obj) return null;

                        const Icon = LucideIcons[obj.icon] || Box;
                        const isDragging = draggedItem?.objectApiName === apiName && draggedItem?.source === 'group';

                        return (
                          <div
                            key={`${obj._id}-selected`}
                            className={`${styles.objectCard} ${styles.selected}`}
                            draggable
                            onDragStart={() => handleDragStart(groupIndex, objectIndex, apiName)}
                            onDragOver={handleDragOver}
                            onDrop={() => handleDropOnGroup(groupIndex, objectIndex)}
                            style={{
                              opacity: isDragging ? 0.5 : 1,
                              cursor: 'grab',
                              border: dragOverSection === `group-${groupIndex}` && !isDragging ? '1px solid #0ea5e9' : '',
                            }}
                            title="Drag to reorder or to remove"
                          >
                            <div className={styles.objectIcon}>
                              <Icon size={20} />
                            </div>

                            <div className={styles.objectInfo}>
                              <div className={styles.objectName}>{obj.name}</div>
                              <div className={styles.objectApi}>{obj.apiName}</div>
                            </div>

                            <div className={styles.checkIcon}>
                              <Check size={16} />
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* Available Objects Section */}
                <div
                  style={{
                    marginTop: '12px',
                    padding: '8px',
                    backgroundColor: dragOverSection === `available-${groupIndex}` ? '#fef2f2' : 'transparent',
                    border: dragOverSection === `available-${groupIndex}` ? '2px dashed #ef4444' : '2px dashed transparent',
                    borderRadius: '6px',
                    transition: 'all 0.2s ease',
                  }}
                  onDragOver={(e) => {
                    handleDragOver(e);
                    setDragOverSection(`available-${groupIndex}`);
                  }}
                  onDragLeave={() => setDragOverSection(null)}
                  onDrop={handleDropOnAvailable}
                >
                  <div style={{ fontSize: '12px', fontWeight: '600', color: '#64748b', marginBottom: '8px', marginLeft: '0' }}>
                    Available Objects (drag here to add or remove)
                  </div>
                  <div className={styles.objectGrid} style={{ minHeight: '60px' }}>
                    {allowedObjects.filter(obj => !group.objectApiNames.includes(obj.apiName)).length === 0 ? (
                      <div style={{ gridColumn: '1 / -1', textAlign: 'center', color: '#94a3b8', fontSize: '13px', padding: '20px' }}>
                        All available objects are in the group
                      </div>
                    ) : (
                      allowedObjects.map((obj) => {
                        const isSelected = group.objectApiNames.includes(obj.apiName);
                        if (isSelected) return null;

                        const Icon = LucideIcons[obj.icon] || Box;

                        return (
                          <div
                            key={obj._id}
                            className={styles.objectCard}
                            draggable
                            onDragStart={() => handleDragStartAvailable(obj.apiName)}
                            onDragOver={handleDragOver}
                            onDrop={() => handleDropOnGroup(groupIndex, group.objectApiNames.length)}
                            style={{
                              cursor: 'grab',
                              border: dragOverSection === `group-${groupIndex}` ? '1px solid #0ea5e9' : '',
                            }}
                            title="Drag to add to group"
                          >
                            <div className={styles.objectIcon}>
                              <Icon size={20} />
                            </div>

                            <div className={styles.objectInfo}>
                              <div className={styles.objectName}>{obj.name}</div>
                              <div className={styles.objectApi}>{obj.apiName}</div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className={styles.addGroupSection}>
        <input
          type="text"
          className={styles.groupNameInput}
          value={newGroupName}
          onChange={(e) => setNewGroupName(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && handleAddGroup()}
          placeholder="New group name..."
        />
        <Button
          size="lg"
          variant="secondary"
          icon={<Plus size={14} />}
          onClick={handleAddGroup}
        >
          Add Group
        </Button>
      </div>

      <div className={styles.actions}>
        <Button
          size="lg"
          variant="primary"
          icon={<Save size={14} />}
          onClick={handleSave}
          loading={isSaving}
        >
          Save Object Groups
        </Button>
      </div>
    </div>
  );
};

export default WorkspaceObjectGroups;
