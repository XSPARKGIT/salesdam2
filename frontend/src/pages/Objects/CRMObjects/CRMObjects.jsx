import styles from './CRMObjects.module.css';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import * as LucideIcons from 'lucide-react';
import { Eye, Edit2, Trash2 } from 'lucide-react';
import { getObjects, deleteObject } from '../../../services/api/objects';
import { useTenantContext } from '../../../context/TenantContext';
import DeleteObjectModal from '../DeleteObjectModal/DeleteObjectModal';
import toast from 'react-hot-toast';

const CRMObjects = () => {
  const { refreshObjects } = useTenantContext();
  const [objectToDelete, setObjectToDelete] = useState(null);
  const [activeFilter, setActiveFilter] = useState('active'); // 'active' | 'inactive'

  const {
    data: allObjects,
    refetch,
    isLoading,
  } = useQuery({
    queryKey: ['objects', 'includeInactive'],
    queryFn: () => getObjects({ includeInactive: true }),
    onError: () => {
      toast.error('Failed to load objects.');
    },
  });

  const objects = (allObjects || []).filter((o) =>
    activeFilter === 'active' ? o.isActive !== false : o.isActive === false,
  );

  if (isLoading) {
    return (
      <div className={styles.grid}>
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className={styles.skeleton} />
        ))}
      </div>
    );
  }

  const activeCount = (allObjects || []).filter((o) => o.isActive !== false).length;
  const inactiveCount = (allObjects || []).filter((o) => o.isActive === false).length;

  const handleDeleteClick = (obj) => {
    if (!obj.isCustom || obj.isSystem) {
      toast.error('System objects cannot be deleted.');
      return;
    }
    setObjectToDelete(obj);
  };

  const handleConfirmDelete = async () => {
    try {
      const result = await deleteObject(objectToDelete.apiName);
      const { recordCount, fieldCount } = result || {};
      toast.success(
        typeof recordCount === 'number'
          ? `Deleted "${objectToDelete.label}" — ${recordCount} record(s) and ${fieldCount} field(s) removed.`
          : 'Object deleted.',
      );
      setObjectToDelete(null);
      refetch(); // Refresh data after update
      refreshObjects(); // Refresh objects in the tenant context
    } catch (err) {
      toast.error(err.message || 'Delete failed.');
    }
  };

  return (
    <>
      {/* Active / Inactive filter tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border-color)', marginBottom: 20 }}>
        {[
          ['active', `Active (${activeCount})`],
          ['inactive', `Inactive (${inactiveCount})`],
        ].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setActiveFilter(id)}
            style={{
              padding: '6px 16px',
              fontSize: 13,
              fontWeight: 500,
              border: 'none',
              borderBottom: `2px solid ${activeFilter === id ? 'var(--color-primary)' : 'transparent'}`,
              marginBottom: -1,
              background: 'none',
              cursor: 'pointer',
              color: activeFilter === id ? 'var(--color-primary)' : 'var(--color-gray-500)',
              transition: 'all var(--transition-fast)',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {objects.length === 0 && (
        <p style={{ color: 'var(--color-gray-400)', fontSize: 14, padding: '24px 0' }}>
          {activeFilter === 'inactive' ? 'No inactive objects.' : 'No active objects.'}
        </p>
      )}

    <div className={styles.grid}>
      {objects?.map((obj) => {
        const Icon = LucideIcons[obj.icon] || LucideIcons.Box;

        return (
          <div key={obj?._id} className={styles.card}>
            <div className={styles.top}>
              <div
                className={styles.icon}
                style={{ background: `${obj?.color}20`, color: obj?.color }}
              >
                <Icon size={22} />
              </div>

              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center' }}>
                {obj.isSystem ? (
                  <span className={styles.system}>System</span>
                ) : !obj.isCustom ? (
                  <span className={styles.standard}>Standard</span>
                ) : (
                  <span className={styles.custom}>Custom</span>
                )}
                {obj.isJunctionObject && (
                  <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 999, background: '#fff7ed', color: '#c2410c', border: '1px solid #fdba74', letterSpacing: '0.03em' }}>
                    Junction
                  </span>
                )}
              </div>
            </div>

            <h3 className={styles.name}>{obj?.label}</h3>
            <p className={styles.api}>API: {obj?.apiName}</p>

            {obj?.description && (
              <p className={styles.desc}>{obj?.description}</p>
            )}

            <div className={styles.actions}>
              <Link to={`/o/${obj?.apiName}`} className={styles.view}>
                <Eye size={14} /> View
              </Link>

              <Link
                to={`/setup/objects/${obj?.apiName}`}
                className={styles.edit}
              >
                <Edit2 size={14} /> Edit
              </Link>

              {obj?.isCustom && !obj?.isSystem && (
                <button
                  className={styles.delete}
                  onClick={() => handleDeleteClick(obj)}
                  title={`Delete ${obj.label}`}
                  aria-label={`Delete ${obj.label}`}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>
        );
      })}

      <DeleteObjectModal
        isOpen={!!objectToDelete}
        onClose={() => setObjectToDelete(null)}
        object={objectToDelete}
        onConfirm={handleConfirmDelete}
      />
    </div>
    </>
  );
};

export default CRMObjects;
