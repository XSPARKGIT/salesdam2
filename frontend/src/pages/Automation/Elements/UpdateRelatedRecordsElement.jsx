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
  const [relatedFields, setRelatedFields] = useState([]);
  const [relatedLookupFields, setRelatedLookupFields] = useState([]);

  const isParent = config.lookupDirection === 'parent';
  const set = (key, val) => onChange({ ...config, [key]: val });

  useEffect(() => {
    if (!config.objectApiName) {
      setRelatedFields([]);
      setRelatedLookupFields([]);
      return;
    }
    api.get(`/objects/${config.objectApiName}`)
      .then((r) => {
        const all = (r.data.data?.fields || []).sort((a, b) => a.displayOrder - b.displayOrder);
        setRelatedFields(all.filter((f) => !['formula', 'rollup_summary', 'master_detail'].includes(f.type)));
        setRelatedLookupFields(all.filter((f) => f.type === 'lookup'));
      })
      .catch(() => { setRelatedFields([]); setRelatedLookupFields([]); });
  }, [config.objectApiName]);

  // Lookup fields on the triggering record (for parent direction)
  const triggerLookupFields = fields.filter((f) => f.type === 'lookup');

  return (
    <div className={styles.wrapper}>
      <Row label="Direction" hint="Update child records that reference this record, or update the parent this record links to">
        <Sel
          value={config.lookupDirection || 'children'}
          onChange={(v) => onChange({ ...config, lookupDirection: v, objectApiName: '', lookupField: '', fields: {} })}
          options={[
            { value: 'children', label: 'Child records (lookup on child)' },
            { value: 'parent', label: 'Parent record (lookup on this record)' },
          ]}
        />
      </Row>

      <Row
        label={isParent ? 'Parent object' : 'Child object'}
        hint={isParent ? 'Object type of the parent record to update' : 'Object whose records will be updated'}
      >
        <Sel
          value={config.objectApiName || ''}
          onChange={(v) => onChange({ ...config, objectApiName: v, lookupField: '', fields: {} })}
          placeholder="— Select object —"
          options={objects.map((o) => ({ value: o.apiName, label: o.label }))}
        />
      </Row>

      {config.objectApiName && (
        <Row
          label="Lookup field"
          hint={isParent
            ? 'Field on this (triggering) record that points to the parent'
            : 'Field on the child that references the trigger record'}
        >
          <Sel
            value={config.lookupField || ''}
            onChange={(v) => set('lookupField', v)}
            placeholder="— Select lookup field —"
            options={isParent
              ? triggerLookupFields.map((f) => ({ value: f.apiName, label: f.label }))
              : relatedLookupFields.map((f) => ({ value: f.apiName, label: f.label }))}
          />
        </Row>
      )}

      {config.objectApiName && config.lookupField && (
        <Row
          label="Fields to update"
          hint={isParent ? 'Values to set on the parent record' : 'Values to set on every matching child record'}
        >
          <FieldMapping
            externalFields={isParent ? relatedFields : relatedFields}
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
