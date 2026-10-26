import styles from './RecordList.module.css';
import { useEffect, useState, useMemo } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import toast from 'react-hot-toast';
import { useTenantContext } from '../../../context/TenantContext';
import { useObjectPermissions } from '../../../hooks/useObjectPermissions';
import useTextWrap from '../../../hooks/useTextWrap';
import { getFields, getRecords } from '../../../services/api/objects';
import { getListViews } from '../../../services/api/listViews';
import { withoutHelperFields } from '../../../utils/fieldVisibility';
import Layout from '../../../layout/Layout';
import {
  MAX_COLUMNS,
  ROOT_COLUMNS,
  SYSTEM_FIELDS,
  isFilterableField,
  isRootColumn,
} from './listViewConstants';
import Pagination from './Pagination/Pagination';
import RecordHeader from './RecordHeader/RecordHeader';
import RecordToolbar from './RecordToolbar/RecordToolbar';
import RecordTable from './RecordTable/RecordTable';
import RecordKanban from './RecordKanban/RecordKanban';

const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_COLUMN_COUNT = 6;
const UNHELPFUL_COLUMN_TYPES = ['textarea', 'richtext', 'address'];
/** How long typing settles before the records query key changes. */
const SEARCH_DEBOUNCE_MS = 350;

const getSearchKey = (n) => `crm-search-${n}`;
const getSavedSearch = (n) => {
  try {
    return localStorage.getItem(getSearchKey(n)) || '';
  } catch {
    return '';
  }
};
const saveSearch = (n, q) => {
  try {
    localStorage.setItem(getSearchKey(n), q);
  } catch {
    // Private-mode / quota failures aren't worth surfacing.
  }
};

/** Statuses the shared axios interceptor already reports to the user. */
const isHandledStatus = (status) =>
  status === 401 || status === 403 || status === 429 || status >= 500;

const RecordList = () => {
  const { objectApiName } = useParams();
  const { getObject } = useTenantContext();
  const perms = useObjectPermissions(objectApiName);
  const objMeta = getObject(objectApiName);
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();

  // Query-driving state
  const [page, setPage] = useState(() =>
    parseInt(searchParams.get('page') || '1', 10),
  );
  const [pageSize, setPageSize] = useState(() =>
    parseInt(searchParams.get('limit') || String(DEFAULT_PAGE_SIZE), 10),
  );
  const [search, setSearch] = useState(
    () => searchParams.get('search') || getSavedSearch(objectApiName) || '',
  );
  // The debounced copy of `search` is what the query key sees, so typing doesn't
  // fire a request per keystroke.
  const [querySearch, setQuerySearch] = useState(search);
  // null means "sort the way the active view says"; only a click on a column
  // header pins an explicit sort.
  const [explicitSort, setExplicitSort] = useState(null);
  // null means "use the active view's columns". The Columns picker overrides it
  // for the current session without mutating the saved view.
  const [columnOverride, setColumnOverride] = useState(null);

  // Row selection
  const [selected, setSelected] = useState([]);

  // View mode (list or kanban) - check URL to determine initial mode
  const isKanbanUrl = window.location.pathname.includes('/kanban');
  const [viewMode, setViewMode] = useState(isKanbanUrl ? 'kanban' : 'list');

  // A board is only usable when it is enabled *and* configured with a group-by
  // field. If the config is cleared or disabled, fall back to the list view so a
  // stale kanban URL cannot render an unusable board.
  const kanbanConfig = objMeta?.kanbanConfig || {};
  const isKanbanEnabled = Boolean(kanbanConfig.enabled && kanbanConfig.fieldApiName);
  const effectiveViewMode = viewMode === 'kanban' && !isKanbanEnabled ? 'list' : viewMode;

  // Cell text: 'clip' truncates with an ellipsis, 'wrap' flows onto more lines.
  // Lives in the URL (?wrap=), so it survives a reload and can be shared.
  const [textWrap, setTextWrap] = useTextWrap();

  // ── Data ──────────────────────────────────────────────────────────────────
  const fieldsQuery = useQuery({
    queryKey: ['object-fields', objectApiName],
    queryFn: () => getFields(objectApiName),
    enabled: !!objectApiName,
    retry: false,
  });

  const viewsQuery = useQuery({
    queryKey: ['list-views', objectApiName],
    queryFn: () => getListViews(objectApiName),
    enabled: !!objectApiName,
    retry: false,
  });

  // Memoised so the column memos below don't see a new array every render.
  const fields = useMemo(() => fieldsQuery.data || [], [fieldsQuery.data]);
  const views = viewsQuery.data || [];

  // The active view lives in the URL (?view=<key>), the same way ObjectBuilder
  // keeps its tab there. With nothing in the URL the first server-provided
  // default wins.
  const urlViewKey = searchParams.get('view');
  const activeViewKey = urlViewKey || views[0]?.key || null;
  const activeViewMeta = views.find((v) => v.key === activeViewKey) || null;

  // Wait for the views request to settle either way, so the records request is
  // made once with the right view instead of firing twice.
  const viewsSettled = viewsQuery.isSuccess || viewsQuery.isError;

  const sortParam = explicitSort
    ? explicitSort.order === 'desc'
      ? `-${explicitSort.field}`
      : explicitSort.field
    : undefined;

  const recordsQueryKey = useMemo(
    () => [
      'records',
      objectApiName,
      activeViewKey || '',
      page,
      pageSize,
      sortParam || '',
      querySearch,
    ],
    [objectApiName, activeViewKey, page, pageSize, sortParam, querySearch],
  );

  const recordsQuery = useQuery({
    queryKey: recordsQueryKey,
    queryFn: () =>
      getRecords(objectApiName, {
        page,
        limit: pageSize,
        search: querySearch || undefined,
        sort: sortParam,
        view: activeViewKey || undefined,
      }),
    enabled: !!objectApiName && viewsSettled,
    placeholderData: (prev) => prev,
    // The list refetches when the key above changes — a different object, view,
    // page, sort or search — or when a create/update/delete invalidates
    // ['records', objectApiName]. Nothing else: no focus, reconnect or remount
    // refetch, which is what made it reload constantly. `invalidateQueries`
    // ignores staleTime, so mutations still refresh it.
    staleTime: Infinity,
    retry: false,
  });

  // ── Derived state, adjusted during render rather than effect + setState ────
  const [syncedObject, setSyncedObject] = useState(objectApiName);
  if (objectApiName !== syncedObject) {
    const nextSearch = getSavedSearch(objectApiName) || '';
    setSyncedObject(objectApiName);
    setSearch(nextSearch);
    // Moved in lockstep with `search` so switching objects costs one request
    // rather than one now and another when the debounce catches up.
    setQuerySearch(nextSearch);
    setPageSize(DEFAULT_PAGE_SIZE);
    setPage(1);
    setSelected([]);
    setColumnOverride(null);
    setExplicitSort(null);
  }

  const [syncedViewKey, setSyncedViewKey] = useState(activeViewKey);
  if (activeViewKey !== syncedViewKey) {
    // On the first resolve there's nothing to reset, and doing so would clobber
    // a deep link such as ?view=x&page=3.
    const hadPreviousView = syncedViewKey !== null;
    setSyncedViewKey(activeViewKey);
    setColumnOverride(null);
    setExplicitSort(null);
    if (hadPreviousView) {
      setPage(1);
      setSelected([]);
    }
  }

  // Let typing settle before the query key — and therefore the request — moves.
  useEffect(() => {
    if (search === querySearch) return;
    const timer = setTimeout(() => setQuerySearch(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search, querySearch]);

  // Persist search
  useEffect(() => {
    saveSearch(objectApiName, search);
  }, [objectApiName, search]);

  // Sync the URL. Patches the existing params so ?view= survives paging and
  // searching.
  const searchParamsString = searchParams.toString();
  useEffect(() => {
    const next = new URLSearchParams(searchParamsString);
    if (page > 1) next.set('page', String(page));
    else next.delete('page');
    if (pageSize !== DEFAULT_PAGE_SIZE) next.set('limit', String(pageSize));
    else next.delete('limit');
    if (search) next.set('search', search);
    else next.delete('search');
    // Navigating to the URL we're already on still produces a new location, and
    // `setSearchParams` is re-created from it — so skip the no-op rather than
    // re-running this effect for nothing.
    if (next.toString() === searchParamsString) return;
    setSearchParams(next, { replace: true });
  }, [page, pageSize, search, searchParamsString, setSearchParams]);

  const recordsError = recordsQuery.error;
  useEffect(() => {
    if (recordsError && !isHandledStatus(recordsError.status)) {
      toast.error(recordsError.message || 'Failed to load records.');
    }
  }, [recordsError]);

  const fieldsError = fieldsQuery.error;
  useEffect(() => {
    if (fieldsError && !isHandledStatus(fieldsError.status)) {
      toast.error(fieldsError.message || 'Failed to load fields.');
    }
  }, [fieldsError]);

  // ── Columns ───────────────────────────────────────────────────────────────
  // Root document columns are addressable alongside real fields.
  // Helper fields feed formulas / rollups and are not user-facing, so they are
  // offered neither as columns nor as filter targets.
  const columnCatalog = useMemo(
    () => [
      ...withoutHelperFields(fields).filter(
        (f) => !SYSTEM_FIELDS.includes(f.apiName) && !isRootColumn(f.apiName),
      ),
      ...ROOT_COLUMNS,
    ],
    [fields],
  );

  // Only used when there is no view at all — e.g. the views request failed.
  const fallbackColumns = useMemo(
    () =>
      fields
        .filter(
          (f) =>
            !SYSTEM_FIELDS.includes(f.apiName) &&
            !UNHELPFUL_COLUMN_TYPES.includes(f.type),
        )
        .slice(0, DEFAULT_COLUMN_COUNT)
        .map((f) => f.apiName),
    [fields],
  );

  const records = recordsQuery.data?.records || [];
  const pagination = recordsQuery.data?.pagination || {};
  // The records response carries the resolved view; its columns are the
  // authoritative, ordered set for the active view.
  const resolvedView = recordsQuery.data?.view || null;

  const viewColumns =
    (resolvedView?.columns?.length && resolvedView.columns) ||
    (activeViewMeta?.columns?.length && activeViewMeta.columns) ||
    null;

  const selectedCols = (columnOverride || viewColumns || fallbackColumns).slice(
    0,
    MAX_COLUMNS,
  );

  const catalogByApiName = useMemo(() => {
    const map = new Map();
    columnCatalog.forEach((f) => map.set(f.apiName, f));
    return map;
  }, [columnCatalog]);

  // Walk the ordered column list and look each entry up, so the view's order is
  // the table's order. Filtering the field array instead would silently fall
  // back to the field definitions' displayOrder.
  const displayFields = selectedCols
    .map((apiName) => catalogByApiName.get(apiName))
    .filter(Boolean)
    .filter((f) => perms.canViewField(f.apiName));

  const filterableFields = useMemo(
    () => columnCatalog.filter(isFilterableField),
    [columnCatalog],
  );

  // ── Sort ──────────────────────────────────────────────────────────────────
  const viewSortField = resolvedView?.sortField || activeViewMeta?.sortField;
  const viewSortOrder = resolvedView?.sortOrder || activeViewMeta?.sortOrder;
  const effectiveSort =
    explicitSort ||
    (viewSortField
      ? { field: viewSortField, order: viewSortOrder === 'asc' ? 'asc' : 'desc' }
      : { field: 'createdAt', order: 'desc' });

  // ── Handlers ──────────────────────────────────────────────────────────────
  const selectViewKey = (key) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (key) next.set('view', key);
        else next.delete('view');
        next.delete('page');
        return next;
      },
      { replace: true },
    );

  // Fall back to the first default view when the active one disappears.
  const handleViewDeleted = (key) => {
    if (key === activeViewKey) selectViewKey(null);
  };

  const refetch = () => {
    queryClient.invalidateQueries({ queryKey: ['records', objectApiName] });
    queryClient.invalidateQueries({
      queryKey: ['object-fields', objectApiName],
    });
  };

  const objectLabel = objMeta?.pluralLabel || objectApiName;
  // Only the very first load gets a skeleton. Later fetches keep the previous
  // rows on screen (via placeholderData) and show a thin progress bar instead,
  // so the list never blanks out mid-use. `!viewsSettled` counts as loading too,
  // otherwise the empty state flashes while the records query is still disabled.
  const loading =
    perms.loading ||
    fieldsQuery.isLoading ||
    (!recordsQuery.data && (recordsQuery.isFetching || !viewsSettled));
  const refreshing = !loading && recordsQuery.isFetching;
  const activeView = activeViewMeta || resolvedView;

  return (
    <Layout
      title={objectLabel}
      description={`Manage and view all ${objectLabel.toLowerCase()} records`}
    >
      <div className={styles.page}>
        <RecordHeader
          objectApiName={objectApiName}
          objMeta={objMeta}
          pagination={pagination}
          activeView={activeView}
          selected={selected}
          setSelected={setSelected}
          allFields={fields}
          perms={perms}
          refetch={refetch}
        />

        <RecordToolbar
          objectApiName={objectApiName}
          objectLabel={objectLabel}
          search={search}
          setSearch={setSearch}
          onPageReset={() => setPage(1)}
          columnCatalog={columnCatalog}
          filterableFields={filterableFields}
          selectedCols={selectedCols}
          viewColumns={viewColumns}
          onColumnsChange={setColumnOverride}
          views={views}
          viewsError={viewsQuery.isError}
          activeViewKey={activeViewKey}
          activeView={activeView}
          onSelectView={(view) => selectViewKey(view.key)}
          onViewSaved={(key) => key && selectViewKey(key)}
          onViewDeleted={handleViewDeleted}
          currentSort={effectiveSort}
          viewMode={effectiveViewMode}
          setViewMode={setViewMode}
          textWrap={textWrap}
          onTextWrapChange={setTextWrap}
          objMeta={objMeta}
        />

        {effectiveViewMode === 'list' ? (
          <>
            {displayFields.length > 0 && (
              <div className={styles.editHint}>
                <Pencil size={12} /> Click any cell to edit inline · Click the row
                to open the record
              </div>
            )}

            <RecordTable
              objectApiName={objectApiName}
              records={records}
              loading={loading}
              refreshing={refreshing}
              textWrap={textWrap}
              objectLabel={objectLabel}
              displayFields={displayFields}
              sort={effectiveSort}
              setSort={setExplicitSort}
              setPage={setPage}
              selected={selected}
              setSelected={setSelected}
              queryClient={queryClient}
              recordsQueryKey={recordsQueryKey}
            />

            <Pagination
              page={page}
              totalPages={pagination.totalPages}
              total={pagination.total}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
            />
          </>
        ) : (
          <div className={styles.kanbanWrapper}>
            <RecordKanban
              records={records}
              objectMeta={objMeta}
              objectApiName={objectApiName}
              onRecordUpdate={refetch}
              fields={fields}
            />
          </div>
        )}
      </div>
    </Layout>
  );
};

export default RecordList;
