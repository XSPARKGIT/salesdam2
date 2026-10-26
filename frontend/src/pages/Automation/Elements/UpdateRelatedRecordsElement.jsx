import React, { useState, useEffect } from 'react';
import { Sel, Row, FieldMapping } from './shared.jsx';
import api from '../../../services/api.js';
import styles from './DeleteRecordsElement.module.css';

export default function UpdateRelatedRecordsElement({
  config,
  onChange,
  objects = [],
  fields = [],
  variables = [],
  outputVariables = [],
  recordPageFields = [],
}) {
  const [childFields, setChildFields] = useState([]);
  const [lookupFields, setLookupFields] = useState([]);

  const set = (key, val) => onChange({ ...config, [key]: val });

  useEffect(() => {
    if (!config.objectApiName) {
      setChildFields([]);
      setLookupFields([]);
      return;
    }
    api.get(`/objects/${config.objectApiName}`)
      .then((r) => {
        const all = (r.data.data?.fields || []).sort((a, b) => a.displayOrder - b.displayOrder);
        setChildFields(all.filter((f) => !['formula', 'rollup_summary', 'master_detail'].includes(f.type)));
        setLookupFields(all.filter((f) => f.type === 'lookup'));
      })
      .catch(() => { setChildFields([]); setLookupFields([]); });
  }, [config.objectApiName]);

  return (
    <div className={styles.wrapper}>
      <Row label="Child object" hint="Object whose records will be updated">
        <Sel
          value={config.objectApiName || ''}
          onChange={(v) => onChange({ ...config, objectApiName: v, lookupField: '', fields: {} })}
          placeholder="— Select object —"
          options={objects.map((o) => ({ value: o.apiName, label: o.label }))}
        />
      </Row>

      {config.objectApiName && (
        <Row label="Lookup field" hint="Field on the child that references the trigger record">
          <Sel
            value={config.lookupField || ''}
            onChange={(v) => set('lookupField', v)}
            placeholder="— Select lookup field —"
            options={lookupFields.map((f) => ({ value: f.apiName, label: f.label }))}
          />
        </Row>
      )}

      {config.objectApiName && config.lookupField && (
        <Row label="Fields to update" hint="Values to set on every matching child record">
          <FieldMapping
            externalFields={childFields}
            mapping={config.fields || {}}
            onChange={(m) => set('fields', m)}
            fields={fields}
            variables={variables}
            outputVariables={outputVariables}
            recordPageFields={recordPageFields}
          />
        </Row>
      )}
    </div>
  );
}
