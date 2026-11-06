import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Inp, Row } from './shared.jsx';
import api from '../../../services/api.js';
import styles from './PauseElement.module.css';

export default function CustomCodeElement({ config, onChange }) {
  const set = (key, val) => onChange({ ...config, [key]: val });
  const navigate = useNavigate();

  const [snippets, setSnippets] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/custom-code')
      .then(res => setSnippets(res.data?.data || []))
      .catch(() => setSnippets([]))
      .finally(() => setLoading(false));
  }, []);

  const activeSnippets = snippets.filter(
    s => s.activeVersion != null && s.versions?.some(v => v.status === 'active'),
  );

  // Parse inputs JSON for display
  const inputsStr = config.inputs
    ? (typeof config.inputs === 'string' ? config.inputs : JSON.stringify(config.inputs, null, 2))
    : '{}';

  const handleInputsChange = (val) => {
    try {
      set('inputs', JSON.parse(val));
    } catch {
      // keep raw string while user is typing; store as string temporarily
      onChange({ ...config, inputs: val });
    }
  };

  return (
    <div className={styles.wrapper}>
      <Row label="Snippet" hint="Only active snippets are shown. Manage snippets at /admin/custom-code.">
        {loading ? (
          <span style={{ fontSize: 13, color: 'var(--color-gray-400)' }}>Loading snippets…</span>
        ) : (
          <select
            value={config.name || ''}
            onChange={e => set('name', e.target.value)}
            style={{
              width: '100%',
              padding: 'var(--spacing-2) var(--spacing-3)',
              borderRadius: 'var(--border-radius)',
              border: '1px solid var(--border-color)',
              background: 'var(--color-gray-50)',
              color: 'var(--color-gray-800)',
              fontSize: 'var(--font-size-sm)',
            }}
          >
            <option value="">— select a snippet —</option>
            {activeSnippets.map(s => (
              <option key={s._id} value={s.name}>{s.name}</option>
            ))}
          </select>
        )}
        {!loading && activeSnippets.length === 0 && (
          <div className={styles.note} style={{ marginTop: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <span>No active snippets found.</span>
            <button
              type="button"
              onClick={() => navigate('/admin/custom-code')}
              style={{
                flexShrink: 0,
                padding: '4px 12px',
                borderRadius: 'var(--border-radius)',
                border: '1px solid #d97706',
                background: '#fff',
                color: '#92400e',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Manage Snippets →
            </button>
          </div>
        )}
      </Row>

      <Row label="Inputs (JSON)" hint='Pass data into the snippet, e.g. {"x": 5} or use {$variableName}'>
        <textarea
          rows={4}
          value={inputsStr}
          onChange={e => handleInputsChange(e.target.value)}
          style={{
            width: '100%',
            fontFamily: 'var(--font-family-mono, monospace)',
            fontSize: 'var(--font-size-sm)',
            padding: 'var(--spacing-2) var(--spacing-3)',
            borderRadius: 'var(--border-radius)',
            border: '1px solid var(--border-color)',
            background: 'var(--color-gray-50)',
            color: 'var(--color-gray-800)',
            resize: 'vertical',
            outline: 'none',
            boxSizing: 'border-box',
            lineHeight: 1.5,
          }}
        />
      </Row>

      <Row label="Output variable" hint="Store the snippet's return value in this variable. Use {$variableName} in later steps.">
        <Inp
          value={config.outputVariable || ''}
          onChange={v => set('outputVariable', v)}
          placeholder="e.g. codeResult"
        />
      </Row>
    </div>
  );
}
