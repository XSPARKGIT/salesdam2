import { Link } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { interleaveColumns } from '../../utils/layoutUtils';
import { resolveDisplayType } from '../../../../utils/fieldDisplayType';
import styles from '../RecordDetail.module.css';

const formatDate = (date) => {
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
};

const formatDateTime = (date) => {
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

const RecordFieldValue = ({ field, value, lookupLabels }) => {
  if (value === null || value === undefined || value === '') {
    return <span className={styles.empty}>{''}</span>;
  }

  // Lookup fields — show resolved name, link to related record
  if (field.type === 'lookup' || field.type === 'master_detail') {
    const resolved = lookupLabels[field.apiName];
    if (!resolved) return <span className={styles.resolving}>…</span>;
    return resolved.link ? (
      <Link to={resolved.link} className={styles.lookupLink}>
        <ExternalLink size={12} />
        {resolved.label}
      </Link>
    ) : (
      <span>{resolved.label}</span>
    );
  }

  // Formula fields render as their declared return type — see resolveDisplayType.
  switch (resolveDisplayType(field)) {
    case 'boolean':
      return (
        <label className={styles.checkboxDisplay}>
          <input type="checkbox" checked={!!value} readOnly />
          <span>{value ? 'true' : 'false'}</span>
        </label>
      );
    case 'date':
      return formatDate(value);
    case 'datetime':
      return formatDateTime(value);
    case 'currency':
      return `R${parseFloat(value).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
    case 'percent':
      return `${value}%`;
    case 'email':
      return <a href={`mailto:${value}`}>{value}</a>;
    case 'phone':
      return <a href={`tel:${value}`}>{value}</a>;
    case 'url':
      return (
        <a href={value} target="_blank" rel="noopener noreferrer">
          {value}
        </a>
      );
    case 'picklist': {
      const pv = field.picklistValues?.find((p) => p.value === value);
      return (
        <span
          className={styles.badge}
          style={
            pv?.color ? { background: `${pv.color}20`, color: pv.color } : {}
          }
        >
          {pv?.label || value}
        </span>
      );
    }
    case 'textarea':
    case 'richtext':
      return <span className={styles.multiline}>{value}</span>;
    case 'time':
      return <span>{value}</span>;
    case 'address': {
      if (typeof value === 'object' && value !== null) {
        const parts = [value.street, value.city, value.state, value.postalCode, value.country].filter(Boolean);
        return <span className={styles.multiline}>{parts.join(', ')}</span>;
      }
      return <span>{String(value)}</span>;
    }
    default:
      return String(value);
  }
};

const RecordFields = ({ sections, fields, record, lookupLabels, perms }) => {
  return (
    <div className={styles.mainPanel}>
      {sections.map((section) => {
        if (section.type === 'flow' && section.flowId) {
          return null;
        }
        return (
          <div key={section.id} className={styles.section}>
            <h3 className={styles.sectionTitle}>{section.label}</h3>
            <div
              className={styles.fieldGrid}
              style={{
                gridTemplateColumns: `repeat(${section.columns || 2}, 1fr)`,
              }}
            >
              {interleaveColumns(section.columnData).map(
                ({ fieldItem, colIdx, row }) => {
                  if (!fieldItem) {
                    return <div key={`empty-${row}-${colIdx}`} />;
                  }
                  const meta = fields.find(
                    (f) => f.apiName === fieldItem.fieldApiName,
                  );
                  if (!meta)
                    return (
                      <div key={`missing-${fieldItem.fieldApiName}`} />
                    );
                  // Hide fields the user cannot view — keep placeholder for grid alignment
                  if (!perms.canViewField(meta.apiName)) {
                    return (
                      <div key={`hidden-${fieldItem.fieldApiName}`} />
                    );
                  }
                  return (
                    <div
                      key={`${colIdx}-${fieldItem.fieldApiName}`}
                      className={styles.fieldItem}
                    >
                      <label className={styles.fieldLabel}>
                        {fieldItem.label || meta.label}
                      </label>
                      <div className={styles.fieldValue}>
                        <RecordFieldValue
                          field={meta}
                          value={record[meta.apiName]}
                          lookupLabels={lookupLabels}
                        />
                      </div>
                    </div>
                  );
                },
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default RecordFields;
