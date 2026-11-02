import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SlidersHorizontal, RotateCcw, Save, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../../services/api';
import Button from '../../../components/common/Button/Button';
import { useAuth } from '../../../hooks/useAuth';
import AdminSettingsPage from '../AdminSettingsPage';
import s from './Configuration.module.css';

const KEY_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

// Value typed in the input → the stored type.
const cast = (raw, dataType) => {
  if (dataType === 'number') return raw === '' ? null : Number(raw);
  if (dataType === 'boolean') return raw === true || raw === 'true';
  if (dataType === 'json') return JSON.parse(raw);
  return raw;
};
const withoutKey = (obj, key) => {
  const next = { ...obj };
  delete next[key];
  return next;
};
const display = (value, dataType) =>
  dataType === 'json' ? JSON.stringify(value ?? null, null, 2) : value ?? '';

/**
 * Configuration (BRD Core §14 / 6.2) — this company's values for platform
 * settings. Validation rules read them with CONFIG("key"), so a threshold such
 * as the minimum deal value can differ by company without editing the rule.
 */
export default function Configuration() {
  const queryClient = useQueryClient();
  const { isSuperuser } = useAuth();
  const [drafts, setDrafts] = useState({}); // key → raw input
  const [busyKey, setBusyKey] = useState(null);
  const [adding, setAdding] = useState(null); // null | { key, label, dataType, value, description }

  const { data: entries = [], isLoading, isError } = useQuery({
    queryKey: ['tenant-configuration'],
    queryFn: () => api.get('/configuration').then((r) => r.data.data || []),
  });
  const reload = () => queryClient.invalidateQueries({ queryKey: ['tenant-configuration'] });

  const draftOf = (e) => (e.key in drafts ? drafts[e.key] : display(e.value, e.dataType));

  const save = async (entry) => {
    let value;
    try {
      value = cast(draftOf(entry), entry.dataType);
    } catch {
      toast.error('Enter valid JSON.');
      return;
    }
    if (entry.dataType === 'number' && (value === null || Number.isNaN(value))) {
      toast.error('Enter a number.');
      return;
    }
    setBusyKey(entry.key);
    try {
      await api.put(`/configuration/${encodeURIComponent(entry.key)}`, { value });
      toast.success(`${entry.label || entry.key} saved.`);
      setDrafts((d) => withoutKey(d, entry.key));
      reload();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Save failed.');
    } finally {
      setBusyKey(null);
    }
  };

  const reset = async (entry) => {
    setBusyKey(entry.key);
    try {
      await api.delete(`/configuration/${encodeURIComponent(entry.key)}`);
      toast.success('Back to the platform default.');
      setDrafts((d) => withoutKey(d, entry.key));
      reload();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Reset failed.');
    } finally {
      setBusyKey(null);
    }
  };

  const addPlatformSetting = async () => {
    const key = adding.key.trim().toLowerCase();
    if (!KEY_PATTERN.test(key)) {
      toast.error('Use a key like deals.minimum_value — lowercase words joined by dots.');
      return;
    }
    if (entries.some((e) => e.key === key)) {
      toast.error('That setting already exists.');
      return;
    }
    let value;
    try {
      value = cast(adding.value, adding.dataType);
    } catch {
      toast.error('Enter valid JSON.');
      return;
    }
    try {
      await api.put(`/configuration/defaults/${encodeURIComponent(key)}`, {
        value,
        dataType: adding.dataType,
        label: adding.label.trim() || key,
        description: adding.description.trim(),
        category: key.split('.')[0],
        editableByTenant: true,
      });
      toast.success('Platform setting added.');
      setAdding(null);
      reload();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not add the setting.');
    }
  };

  const renderInput = (entry) => {
    const value = draftOf(entry);
    const disabled = entry.editableByTenant === false;
    const onChange = (v) => setDrafts((d) => ({ ...d, [entry.key]: v }));
    if (entry.dataType === 'boolean') {
      return (
        <select className={s.input} value={String(value)} disabled={disabled} onChange={(e) => onChange(e.target.value)} aria-label={entry.label || entry.key}>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      );
    }
    if (entry.dataType === 'json') {
      return <textarea className={s.input} rows={3} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} aria-label={entry.label || entry.key} />;
    }
    return (
      <input
        className={s.input}
        type={entry.dataType === 'number' ? 'number' : 'text'}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        aria-label={entry.label || entry.key}
      />
    );
  };

  return (
    <AdminSettingsPage
      title="Configuration"
      description='This company’s values for platform settings. Validation rules can read them with CONFIG("key").'
      icon={SlidersHorizontal}
      iconColor="#6366f1"
    >
      <p className={s.intro}>
        Each setting starts at the platform default. Change it here to set this company's own
        value — for example a minimum deal value — and any validation rule using{' '}
        <code>CONFIG("deals.minimum_value")</code> follows it without being edited.
      </p>

      {isSuperuser && (
        <div className={s.addBox}>
          {adding === null ? (
            <Button variant="secondary" size="sm" icon={<Plus size={14} />} onClick={() => setAdding({ key: '', label: '', dataType: 'number', value: '', description: '' })}>
              Add platform setting
            </Button>
          ) : (
            <div className={s.addForm} data-testid="add-platform-setting">
              <input className={s.input} placeholder="Key, e.g. claims.max_payout" value={adding.key} onChange={(e) => setAdding((a) => ({ ...a, key: e.target.value }))} aria-label="Key" />
              <input className={s.input} placeholder="Label" value={adding.label} onChange={(e) => setAdding((a) => ({ ...a, label: e.target.value }))} aria-label="Label" />
              <select className={s.input} value={adding.dataType} onChange={(e) => setAdding((a) => ({ ...a, dataType: e.target.value, value: '' }))} aria-label="Type">
                <option value="number">Number</option>
                <option value="string">Text</option>
                <option value="boolean">Yes/No</option>
              </select>
              {adding.dataType === 'boolean' ? (
                <select className={s.input} value={adding.value || 'false'} onChange={(e) => setAdding((a) => ({ ...a, value: e.target.value }))} aria-label="Default value">
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              ) : (
                <input className={s.input} type={adding.dataType === 'number' ? 'number' : 'text'} placeholder="Platform default" value={adding.value} onChange={(e) => setAdding((a) => ({ ...a, value: e.target.value }))} aria-label="Default value" />
              )}
              <input className={`${s.input} ${s.wide}`} placeholder="Description (optional)" value={adding.description} onChange={(e) => setAdding((a) => ({ ...a, description: e.target.value }))} aria-label="Description" />
              <div className={s.addActions}>
                <Button size="sm" onClick={addPlatformSetting}>Add for every company</Button>
                <Button size="sm" variant="secondary" onClick={() => setAdding(null)}>Cancel</Button>
              </div>
            </div>
          )}
        </div>
      )}

      {isLoading ? (
        <p className={s.muted}>Loading…</p>
      ) : isError ? (
        <p className={s.muted}>Couldn't load configuration. Refresh to try again.</p>
      ) : (
        <div className={s.list}>
          {entries.map((entry) => {
            const dirty = entry.key in drafts && drafts[entry.key] !== display(entry.value, entry.dataType);
            return (
              <div key={entry.key} className={s.row} data-testid={`config-${entry.key}`}>
                <div className={s.meta}>
                  <div className={s.label}>
                    {entry.label || entry.key}
                    <span className={entry.source === 'tenant' ? s.badgeTenant : s.badge}>
                      {entry.source === 'tenant' ? 'Company value' : 'Platform default'}
                    </span>
                  </div>
                  <code className={s.key}>{entry.key}</code>
                  {entry.description && <p className={s.desc}>{entry.description}</p>}
                </div>
                <div className={s.controls}>
                  {renderInput(entry)}
                  <Button size="sm" icon={<Save size={14} />} disabled={!dirty || entry.editableByTenant === false} loading={busyKey === entry.key} onClick={() => save(entry)}>
                    Save
                  </Button>
                  {entry.source === 'tenant' && (
                    <Button size="sm" variant="ghost" icon={<RotateCcw size={14} />} onClick={() => reset(entry)} title="Use the platform default again">
                      Reset
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </AdminSettingsPage>
  );
}
