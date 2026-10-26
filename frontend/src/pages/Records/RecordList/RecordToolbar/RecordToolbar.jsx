import styles from './RecordToolbar.module.css';
import { useRef, useEffect, useState } from 'react';
import {
  Search,
  X,
  Columns2 as Columns,
  Layout,
  LayoutGrid,
} from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import Modal from '../../../../components/common/Modal/Modal';
import Button from '../../../../components/common/Button/Button';
import TextWrapToggle from '../../../../components/common/TextWrapToggle/TextWrapToggle';
import ViewSelector from '../ViewSelector/ViewSelector';
import CreateViewModal from '../CreateViewModal/CreateViewModal';
import ColumnChooser from '../ColumnChooser/ColumnChooser';
import {
  createListView,
  updateListView,
  deleteListView,
} from '../../../../services/api/listViews';

const RecordToolbar = ({
  objectApiName,
  objectLabel,
  // Search
  search,
  setSearch,
  onPageReset,
  // Columns
  columnCatalog,
  filterableFields,
  selectedCols,
  viewColumns,
  onColumnsChange,
  // Saved views — all owned by RecordList / the API
  views,
  viewsError,
  activeViewKey,
  activeView,
  onSelectView,
  onViewSaved,
  onViewDeleted,
  currentSort,
  // View mode
  viewMode,
  setViewMode,
  // Cell text: 'clip' or 'wrap'
  textWrap,
  onTextWrapChange,
  objMeta,
}) => {
  const colRef = useRef(null);
  const queryClient = useQueryClient();
  const [showColumnChooser, setShowColumnChooser] = useState(false);
  // null = closed, { view: null } = create, { view } = edit,
  // { view, readOnly: true } = inspect a standard view's filters
  const [editorState, setEditorState] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);

  useEffect(() => {
    const handler = (e) => {
      if (colRef.current && !colRef.current.contains(e.target))
        setShowColumnChooser(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['list-views', objectApiName] });
    queryClient.invalidateQueries({ queryKey: ['records', objectApiName] });
  };

  const saveMutation = useMutation({
    mutationFn: ({ view, payload }) =>
      view
        ? updateListView(objectApiName, view.key, payload)
        : createListView(objectApiName, payload),
    onSuccess: (saved, { view, payload }) => {
      invalidate();
      setEditorState(null);
      toast.success(`View "${payload.name}" ${view ? 'updated' : 'saved'}.`);
      onViewSaved?.(saved?.key || view?.key);
    },
    onError: (err) => toast.error(err.message || 'Failed to save the view.'),
  });

  const deleteMutation = useMutation({
    mutationFn: (view) => deleteListView(objectApiName, view.key),
    onSuccess: (_data, view) => {
      invalidate();
      setPendingDelete(null);
      toast.success(`View "${view.name}" deleted.`);
      onViewDeleted?.(view.key);
    },
    onError: (err) => toast.error(err.message || 'Failed to delete the view.'),
  });

  // Editing an existing view starts from that view's own saved configuration;
  // creating one captures whatever the list currently shows.
  const editorColumns = editorState?.view
    ? editorState.view.columns || []
    : selectedCols || [];
  const editorSort = editorState?.view
    ? {
        field: editorState.view.sortField,
        order: editorState.view.sortOrder,
      }
    : currentSort;

  return (
    <>
      <div className={styles.toolbar}>
        <ViewSelector
          views={views}
          viewsError={viewsError}
          activeViewKey={activeViewKey}
          activeView={activeView}
          onSelect={(view) => {
            onSelectView(view);
            onPageReset();
          }}
          onCreate={() => setEditorState({ view: null })}
          onEdit={(view) => setEditorState({ view })}
          onInspect={(view) => setEditorState({ view, readOnly: true })}
          onDelete={(view) => setPendingDelete(view)}
        />

        <div className={styles.searchWrapper}>
          <Search size={15} className={styles.searchIcon} />
          <input
            type="text"
            className={styles.searchInput}
            placeholder={`Search ${objectLabel.toLowerCase()}...`}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              onPageReset();
            }}
          />
          {search && (
            <button
              className={styles.searchClear}
              onClick={() => {
                setSearch('');
                onPageReset();
              }}
            >
              <X size={13} />
            </button>
          )}
        </div>

        {objMeta?.kanbanConfig?.enabled && objMeta?.kanbanConfig?.fieldApiName && (
          <div className={styles.viewModeToggle}>
            <button
              className={`${styles.viewBtn} ${viewMode === 'list' ? styles.active : ''}`}
              onClick={() => setViewMode('list')}
              title="List view"
            >
              <Layout size={16} />
            </button>
            <button
              className={`${styles.viewBtn} ${viewMode === 'kanban' ? styles.active : ''}`}
              onClick={() => setViewMode('kanban')}
              title="Kanban view"
            >
              <LayoutGrid size={16} />
            </button>
          </div>
        )}

        {viewMode === 'list' && (
          <TextWrapToggle value={textWrap} onChange={onTextWrapChange} />
        )}

        <div className={styles.colChooserWrap} ref={colRef}>
          <button
            className={`${styles.colBtn} ${showColumnChooser ? styles.active : ''}`}
            onClick={() => setShowColumnChooser((o) => !o)}
            title="Choose columns"
          >
            <Columns size={14} />
            <span>Columns</span>
            {selectedCols?.length > 0 && (
              <span className={styles.colCount}>{selectedCols.length}</span>
            )}
          </button>
          {showColumnChooser && columnCatalog.length > 0 && (
            <ColumnChooser
              columnCatalog={columnCatalog}
              selected={selectedCols || []}
              viewColumns={viewColumns}
              onChange={onColumnsChange}
              onClose={() => setShowColumnChooser(false)}
            />
          )}
        </div>
      </div>

      {editorState && (
        <CreateViewModal
          view={editorState.view}
          readOnly={!!editorState.readOnly}
          filterableFields={filterableFields}
          initialColumns={editorColumns}
          initialSort={editorSort}
          saving={saveMutation.isPending}
          onSubmit={(payload) =>
            saveMutation.mutate({ view: editorState.view, payload })
          }
          onClose={() => setEditorState(null)}
        />
      )}

      <Modal
        isOpen={!!pendingDelete}
        onClose={() => setPendingDelete(null)}
        title="Delete list view"
        size="sm"
        footer={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPendingDelete(null)}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              loading={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate(pendingDelete)}
            >
              Delete
            </Button>
          </>
        }
      >
        <p className={styles.confirmText}>
          Delete the view <strong>{pendingDelete?.name}</strong>?
          {pendingDelete?.isShared
            ? ' It is shared, so everyone in the workspace will lose it.'
            : ''}{' '}
          Records are not affected.
        </p>
      </Modal>
    </>
  );
};

export default RecordToolbar;
