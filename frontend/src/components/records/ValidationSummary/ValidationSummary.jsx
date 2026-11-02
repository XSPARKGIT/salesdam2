import { AlertCircle } from 'lucide-react';
import styles from './ValidationSummary.module.css';

/**
 * Every problem from a failed save, listed together so they can all be fixed
 * in one pass (BRD 6.2). Field problems name their field; the rest are the
 * rules shown at the top of the record.
 *
 * @param {Array<{ message: string, errorField?: string }>} issues
 * @param {Array} fields  FieldMeta, for field labels
 */
export default function ValidationSummary({ issues = [], fields = [] }) {
  if (!issues.length) return null;
  const labelOf = (apiName) => fields.find((f) => f.apiName === apiName)?.label || apiName;

  return (
    <div className={styles.summary} role="alert" data-testid="validation-summary">
      <div className={styles.head}>
        <AlertCircle size={16} />
        <strong>
          {issues.length === 1
            ? 'Fix this problem before saving:'
            : `Fix these ${issues.length} problems before saving:`}
        </strong>
      </div>
      <ul className={styles.list}>
        {issues.map((issue, i) => (
          <li key={i}>
            {issue.errorField && <span className={styles.field}>{labelOf(issue.errorField)}: </span>}
            {issue.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
