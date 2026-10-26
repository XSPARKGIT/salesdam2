import { useQuery } from '@tanstack/react-query';
import api from '../../../../services/api';
import { Clock, PlusCircle } from 'lucide-react';

const fmt = (val, field, lookupMap) => {
  if (val === null || val === undefined || val === '')
    return <em style={{ color: 'var(--color-gray-300)' }}>—</em>;
  if (typeof val === 'boolean') return val ? 'Yes' : 'No';
  if (typeof val === 'object') return JSON.stringify(val);
  if (field?.type === 'lookup' || field?.type === 'master_detail') {
    return lookupMap[val] || val;
  }
  return String(val);
};

const COL_WIDTHS = ['18%', '16%', '20%', '20%', '14%', '12%'];

const FieldHistoryTab = ({ objectApiName, recordId, fields }) => {
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['field-history', objectApiName, recordId],
    queryFn: async () => {
      const res = await api.get(`/records/${objectApiName}/${recordId}/history`, {
        params: { limit: 500, page: 1 },
      });
      return { entries: res.data.data || [], total: res.data.total || 0 };
    },
    staleTime: 0,
  });

  const { data: lookupMap = {} } = useQuery({
    queryKey: ['field-history-lookups', objectApiName, recordId, data?.entries?.length],
    enabled: !!data?.entries?.length,
    queryFn: async () => {
      const lookupFields = (fields || []).filter(
        (f) => f.type === 'lookup' || f.type === 'master_detail',
      );
      if (!lookupFields.length) return {};
      const idSet = new Set();
      (data?.entries || []).forEach((e) => {
        const f = lookupFields.find((lf) => lf.apiName === e.fieldApiName);
        if (!f) return;
        if (e.oldValue) idSet.add({ id: String(e.oldValue), obj: f.lookupObjectApiName });
        if (e.newValue) idSet.add({ id: String(e.newValue), obj: f.lookupObjectApiName });
      });
      const map = {};
      await Promise.all(
        [...idSet].map(async ({ id, obj }) => {
          if (!obj || map[id]) return;
          try {
            const res = await api.get(`/records/${obj}/${id}`);
            const rec = res.data.data;
            map[id] = rec?.name || rec?.title || rec?.label || id;
          } catch {
            map[id] = id;
          }
        }),
      );
      return map;
    },
  });

  const entries = data?.entries || [];
  const total = data?.total || 0;

  const fieldMeta = (apiName) => fields?.find((f) => f.apiName === apiName);
  const fieldLabel = (apiName) => fieldMeta(apiName)?.label || apiName;

  const userName = (changedBy) => {
    if (!changedBy) return '—';
    const name = `${changedBy.firstName || ''} ${changedBy.lastName || ''}`.trim();
    return name || changedBy.email || '—';
  };

  const creationEntries = entries.filter((e) => e.isCreation);
  const editEntries = entries.filter((e) => !e.isCreation);

  const headers = ['Date & Time', 'Field', 'Old Value', 'New Value', 'Changed By', 'Event'];

  return (
    <div style={{ marginTop: 4 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Clock size={14} style={{ color: 'var(--color-gray-400)' }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-gray-700)' }}>Field History</span>
          {!isLoading && (
            <span style={{ fontSize: 11, background: 'var(--color-gray-100)', color: 'var(--color-gray-500)', borderRadius: 20, padding: '2px 8px', fontWeight: 500 }}>
              {total} {total === 1 ? 'entry' : 'entries'}
            </span>
          )}
        </div>
        {isFetching && !isLoading && (
          <span style={{ fontSize: 11, color: 'var(--color-gray-400)' }}>Refreshing…</span>
        )}
      </div>

      {/* Single table with sticky thead — keeps column widths in sync */}
      <div style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--border-radius)', overflow: 'hidden' }}>
        <div style={{ maxHeight: 440, overflowY: 'auto' }}>
          {isLoading ? (
            <div style={{ padding: '24px 14px', color: 'var(--color-gray-400)', fontSize: 13 }}>Loading history…</div>
          ) : entries.length === 0 ? (
            <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--color-gray-400)' }}>
              <Clock size={28} style={{ marginBottom: 8, opacity: 0.3 }} />
              <p style={{ fontSize: 13, margin: 0 }}>No field history yet.</p>
              <p style={{ fontSize: 12, marginTop: 4, color: 'var(--color-gray-300)' }}>Create or edit a record to start tracking.</p>
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, tableLayout: 'fixed' }}>
              <colgroup>
                {COL_WIDTHS.map((w, i) => <col key={i} style={{ width: w }} />)}
              </colgroup>
              <thead>
                <tr style={{ background: 'var(--color-gray-50)', borderBottom: '2px solid var(--border-color)', position: 'sticky', top: 0, zIndex: 1 }}>
                  {headers.map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '9px 14px', color: 'var(--color-gray-500)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, i) => {
                  const fMeta = fieldMeta(entry.fieldApiName);
                  const isCreate = entry.isCreation;
                  return (
                    <tr
                      key={entry._id}
                      style={{
                        borderBottom: i < entries.length - 1 ? '1px solid var(--border-color)' : 'none',
                        background: isCreate
                          ? 'rgba(99,102,241,0.04)'
                          : i % 2 === 0 ? 'transparent' : 'var(--color-gray-50)',
                      }}
                    >
                      <td style={{ padding: '9px 14px', color: 'var(--color-gray-400)', whiteSpace: 'nowrap', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {new Date(entry.createdAt).toLocaleString()}
                      </td>
                      <td style={{ padding: '9px 14px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {fieldLabel(entry.fieldApiName)}
                      </td>
                      <td style={{ padding: '9px 14px', color: 'var(--color-gray-400)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {fmt(entry.oldValue, fMeta, lookupMap)}
                      </td>
                      <td style={{ padding: '9px 14px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {fmt(entry.newValue, fMeta, lookupMap)}
                      </td>
                      <td style={{ padding: '9px 14px', color: 'var(--color-gray-500)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {userName(entry.changedBy)}
                      </td>
                      <td style={{ padding: '9px 14px' }}>
                        {isCreate ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: 'var(--color-primary)', background: 'rgba(99,102,241,0.08)', borderRadius: 20, padding: '2px 8px', whiteSpace: 'nowrap' }}>
                            <PlusCircle size={10} /> Created
                          </span>
                        ) : (
                          <span style={{ fontSize: 11, color: 'var(--color-gray-400)' }}>Edited</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        {!isLoading && entries.length > 0 && (
          <div style={{ padding: '8px 14px', borderTop: '1px solid var(--border-color)', background: 'var(--color-gray-50)', fontSize: 11, color: 'var(--color-gray-400)', display: 'flex', justifyContent: 'space-between' }}>
            <span>
              {creationEntries.length > 0 && `${creationEntries.length} creation field${creationEntries.length > 1 ? 's' : ''} · `}
              {editEntries.length} edit{editEntries.length !== 1 ? 's' : ''} · newest first
            </span>
            <span>FieldHistory collection · MongoDB</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default FieldHistoryTab;
