import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { ArrowLeft, Crown, GitMerge, Lock } from 'lucide-react';
import Layout from '../../../layout/Layout';
import Button from '../../../components/common/Button/Button';
import Modal from '../../../components/common/Modal/Modal';
import api from '../../../services/api';
import { getFields } from '../../../services/api/objects';
import { getRecord } from '../../../services/api/records';
import { useTenantContext } from '../../../context/TenantContext';
import { useObjectPermissions } from '../../../hooks/useObjectPermissions';
import resolveLookupLabel from '../utils/resolveLookupLabel';
import { MAX_MERGE_RECORDS } from './mergeConstants';
import styles from './RecordMerge.module.css';

// Values produced by a save; the server recomputes them on the kept record.
const COMPUTED_TYPES = new Set(['formula', 'rollup_summary', 'auto_number']);

const isBlank = (v) =>
  v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

const sameValue = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Which record's value a field takes by default: the kept record's, unless blank. */
const defaultSource = (field, masterId, records) => {
  const master = records.find((r) => r.id === masterId);
  if (!isBlank(master?.[field.apiName])) return masterId;
  const other = records.find((r) => r.id !== masterId && !isBlank(r[field.apiName]));
  return other ? other.id : masterId;
};

const recordTitle = (record, nameField) =>
  record?.[nameField] ||
  [record?.first_name, record?.last_name].filter(Boolean).join(' ') ||
  'Untitled record';

/**
 * Merge 2–3 records of one object (Core BRD §3.4). Pick the record to keep,
 * then pick, field by field, whose value survives. The other records are
 * deleted and everything linked to them moves to the kept record.
 *
 * Route: /o/:objectApiName/merge?ids=a,b[,c]
 */
export default function RecordMerge() {
  const { objectApiName } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { getObject } = useTenantContext();
  const objMeta = getObject(objectApiName);
  const perms = useObjectPermissions(objectApiName);

  const ids = useMemo(
    () => [...new Set((searchParams.get('ids') || '').split(',').map((s) => s.trim()).filter(Boolean))],
    [searchParams],
  );
  const idsValid = ids.length >= 2 && ids.length <= MAX_MERGE_RECORDS;

  const { data: fields = [], isLoading: loadingFields } = useQuery({
    queryKey: ['fields', objectApiName],
    queryFn: () => getFields(objectApiName),
    enabled: !!objectApiName && idsValid,
  });

  const {
    data: records = [],
    isLoading: loadingRecords,
    error: recordsError,
  } = useQuery({
    queryKey: ['merge-records', objectApiName, ids.join(',')],
    queryFn: () => Promise.all(ids.map((id) => getRecord(objectApiName, id))),
    enabled: !!objectApiName && idsValid,
    staleTime: 0,
    retry: false,
  });

  const nameField = objMeta?.nameFieldApiName || 'name';
  const mergeableFields = useMemo(
    () =>
      fields
        .filter((f) => !COMPUTED_TYPES.has(f.type))
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [fields],
  );

  // Lookup ids → display labels, resolved once per distinct value.
  const lookupPairs = useMemo(() => {
    const pairs = [];
    for (const f of mergeableFields) {
      if (f.type !== 'lookup' && f.type !== 'master_detail') continue;
      for (const r of records) {
        const v = r[f.apiName];
        if (!isBlank(v) && !pairs.some((p) => p.field.apiName === f.apiName && p.value === v)) {
          pairs.push({ field: f, value: v });
        }
      }
    }
    return pairs;
  }, [mergeableFields, records]);
  const { data: lookupLabels = {} } = useQuery({
    queryKey: ['merge-lookup-labels', objectApiName, lookupPairs.map((p) => `${p.field.apiName}:${p.value}`).join('|')],
    queryFn: async () => {
      const entries = await Promise.all(
        lookupPairs.map(async (p) => [`${p.field.apiName}:${p.value}`, (await resolveLookupLabel(p.field, p.value))?.label]),
      );
      return Object.fromEntries(entries);
    },
    enabled: lookupPairs.length > 0,
  });

  const [masterOverride, setMasterOverride] = useState(null);
  const [picked, setPicked] = useState({}); // fieldApiName → record id, only fields the user chose
  const [onlyDifferent, setOnlyDifferent] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [merging, setMerging] = useState(false);

  const masterId = masterOverride && ids.includes(masterOverride) ? masterOverride : ids[0];
  const sourceFor = (field) =>
    picked[field.apiName] && perms.canEditField(field.apiName)
      ? picked[field.apiName]
      : defaultSource(field, masterId, records);

  const differs = (field) => {
    const values = records.map((r) => r[field.apiName]);
    return values.some((v) => !sameValue(v, values[0]));
  };
  const visibleFields = onlyDifferent ? mergeableFields.filter(differs) : mergeableFields;
  const differingCount = mergeableFields.filter(differs).length;

  const formatValue = (field, value) => {
    if (isBlank(value)) return null;
    switch (field.type) {
      case 'lookup':
      case 'master_detail':
        return lookupLabels[`${field.apiName}:${value}`] || String(value).slice(-8);
      case 'boolean':
        return value ? 'Yes' : 'No';
      case 'picklist':
        return field.picklistValues?.find((o) => o.value === value)?.label || String(value);
      case 'multipicklist':
        return (Array.isArray(value) ? value : [value])
          .map((v) => field.picklistValues?.find((o) => o.value === v)?.label || v)
          .join(', ');
      case 'date':
        return format(new Date(value), 'd MMM yyyy');
      case 'datetime':
        return format(new Date(value), 'd MMM yyyy, HH:mm');
      case 'currency':
      case 'number':
      case 'percent':
        return Number(value).toLocaleString();
      default:
        return typeof value === 'object' ? JSON.stringify(value) : String(value);
    }
  };

  const master = records.find((r) => r.id === masterId);
  const others = records.filter((r) => r.id !== masterId);
  const takenFromOthers = mergeableFields.filter((f) => sourceFor(f) !== masterId);

  const handleMerge = async () => {
    setMerging(true);
    try {
      // Send every field the user may edit, so the server keeps exactly what
      // was shown — including a deliberately chosen blank.
      const fieldValues = {};
      for (const f of mergeableFields) {
        if (!perms.canEditField(f.apiName)) continue;
        const source = records.find((r) => r.id === sourceFor(f));
        fieldValues[f.apiName] = isBlank(source?.[f.apiName]) ? null : source[f.apiName];
      }
      const res = await api.post(`/records/${objectApiName}/merge`, {
        masterId,
        duplicateIds: others.map((r) => r.id),
        fieldValues,
      });
      const moved = (res.data.data?.repointedReferences || []).reduce((n, r) => n + r.count, 0);
      toast.success(
        `Merged ${records.length} records${moved ? ` · ${moved} linked record${moved === 1 ? '' : 's'} moved` : ''}.`,
      );
      queryClient.invalidateQueries({ queryKey: ['records', objectApiName] });
      queryClient.invalidateQueries({ queryKey: ['record-detail', objectApiName, masterId] });
      queryClient.invalidateQueries({ queryKey: ['record', objectApiName, masterId] });
      navigate(`/o/${objectApiName}/${masterId}`, { replace: true });
    } catch (err) {
      const data = err.response?.data;
      toast.error(data?.message || 'Failed to merge the records.');
      setConfirmOpen(false);
    } finally {
      setMerging(false);
    }
  };

  const pluralLabel = objMeta?.pluralLabel || objectApiName;
  const label = objMeta?.label?.toLowerCase() || 'record';
  const back = (
    <Link to={`/o/${objectApiName}`} className={styles.back}>
      <ArrowLeft size={14} /> {pluralLabel}
    </Link>
  );

  const shell = (body) => (
    <Layout title={`Merge ${pluralLabel}`} description="Merge duplicate records">
      <div className={styles.page}>{body}</div>
    </Layout>
  );

  if (!perms.canDelete || !perms.canUpdate) {
    return shell(
      <>
        {back}
        <div className={styles.notice}>You need permission to edit and delete {pluralLabel.toLowerCase()} to merge them.</div>
      </>,
    );
  }
  if (!idsValid) {
    return shell(
      <>
        {back}
        <div className={styles.notice}>
          Select between 2 and {MAX_MERGE_RECORDS} {pluralLabel.toLowerCase()} in the list, then choose Merge.
        </div>
      </>,
    );
  }
  if (loadingFields || loadingRecords) {
    return shell(<div className={styles.notice}>Loading records…</div>);
  }
  if (recordsError) {
    return shell(
      <>
        {back}
        <div className={styles.notice}>
          One of these records couldn't be loaded — it may already have been merged or deleted.
        </div>
      </>,
    );
  }

  return shell(
    <>
      <div className={styles.header}>
        <div>
          {back}
          <h1 className={styles.title}>Merge {records.length} {pluralLabel.toLowerCase()}</h1>
          <p className={styles.subtitle}>
            Choose the record to keep, then pick which value to keep for each field. The other{' '}
            {others.length === 1 ? 'record is' : `${others.length} records are`} deleted, and anything linked to{' '}
            {others.length === 1 ? 'it' : 'them'} — activities, related records, line items — moves to the record you keep.
          </p>
        </div>
        <div className={styles.headerActions}>
          <Button variant="secondary" onClick={() => navigate(-1)}>
            Cancel
          </Button>
          <Button icon={<GitMerge size={15} />} onClick={() => setConfirmOpen(true)}>
            Merge
          </Button>
        </div>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.fieldCol}>
                <label className={styles.check}>
                  <input type="checkbox" checked={onlyDifferent} onChange={(e) => setOnlyDifferent(e.target.checked)} />
                  Only fields that differ ({differingCount})
                </label>
              </th>
              {records.map((r) => (
                <th key={r.id} className={r.id === masterId ? styles.masterCol : undefined}>
                  <label className={styles.masterPick}>
                    <input
                      type="radio"
                      name="master"
                      checked={r.id === masterId}
                      onChange={() => setMasterOverride(r.id)}
                    />
                    <span className={styles.recordName}>{recordTitle(r, nameField)}</span>
                  </label>
                  <span className={styles.recordMeta}>
                    {r.id === masterId ? (
                      <span className={styles.keepBadge}>
                        <Crown size={11} /> Keep this record
                      </span>
                    ) : (
                      'Will be merged in'
                    )}
                    {r.createdAt && ` · created ${format(new Date(r.createdAt), 'd MMM yyyy')}`}
                  </span>
                  <Link to={`/o/${objectApiName}/${r.id}`} target="_blank" rel="noreferrer" className={styles.openLink}>
                    Open
                  </Link>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleFields.length === 0 && (
              <tr>
                <td colSpan={records.length + 1} className={styles.empty}>
                  These records have the same value in every field.
                </td>
              </tr>
            )}
            {visibleFields.map((f) => {
              const editable = perms.canEditField(f.apiName);
              const chosen = sourceFor(f);
              return (
                <tr key={f.apiName}>
                  <th scope="row" className={styles.fieldCol}>
                    {f.label}
                    {!editable && (
                      <span className={styles.lockNote} title="You can't edit this field, so the kept record's value stays">
                        <Lock size={11} />
                      </span>
                    )}
                  </th>
                  {records.map((r) => {
                    const display = formatValue(f, r[f.apiName]);
                    const isChosen = chosen === r.id;
                    return (
                      <td key={r.id} className={`${isChosen ? styles.chosen : ''} ${r.id === masterId ? styles.masterCol : ''}`}>
                        <label className={styles.valuePick}>
                          <input
                            type="radio"
                            name={`field-${f.apiName}`}
                            checked={isChosen}
                            disabled={!editable}
                            onChange={() => setPicked((p) => ({ ...p, [f.apiName]: r.id }))}
                          />
                          <span className={display ? styles.value : styles.blank}>{display ?? 'Empty'}</span>
                        </label>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Modal
        isOpen={confirmOpen}
        onClose={() => !merging && setConfirmOpen(false)}
        title={`Merge ${records.length} ${pluralLabel.toLowerCase()}?`}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)} disabled={merging}>
              Cancel
            </Button>
            <Button icon={<GitMerge size={15} />} loading={merging} onClick={handleMerge}>
              Merge
            </Button>
          </>
        }
      >
        <ul className={styles.summary}>
          <li>
            <strong>{recordTitle(master, nameField)}</strong> is kept, with{' '}
            {takenFromOthers.length === 0
              ? 'its own values'
              : `${takenFromOthers.length} value${takenFromOthers.length === 1 ? '' : 's'} taken from the other ${label}${others.length === 1 ? '' : 's'}`}
            .
          </li>
          <li>
            {others.map((r) => recordTitle(r, nameField)).join(', ')} {others.length === 1 ? 'is' : 'are'} deleted.
          </li>
          <li>Anything linked to {others.length === 1 ? 'it' : 'them'} moves to the kept record.</li>
        </ul>
        <p className={styles.warning}>This can't be undone from the app.</p>
      </Modal>
    </>,
  );
}
