import styles from './NewBusiness.module.css';

/**
 * Inputs for one person. The server matches existing clients by ID number,
 * passport, email, then phone, and creates a client when none match.
 */
const PersonFields = ({ value, onChange, idPrefix, showAge = true, ageHint, requireAge = false, contact = true }) => {
  const set = (key) => (e) => onChange({ ...value, [key]: e.target.value });
  return (
    <div className={styles.grid}>
      <label className={styles.field}>
        <span className={styles.label}>Full name</span>
        <input id={`${idPrefix}-name`} className={styles.input} value={value.name} onChange={set('name')} autoComplete="off" />
      </label>
      <label className={styles.field}>
        <span className={styles.label}>ID number</span>
        <input className={styles.input} value={value.id_number} onChange={set('id_number')} inputMode="numeric" autoComplete="off" />
      </label>
      {showAge && (
        <label className={styles.field}>
          <span className={styles.label}>Age{requireAge ? '' : ' (optional)'}</span>
          <input
            className={styles.input}
            type="number"
            min={0}
            max={120}
            value={value.age}
            onChange={set('age')}
          />
          {ageHint && <span className={styles.help}>{ageHint}</span>}
        </label>
      )}
      {contact && (
        <>
          <label className={styles.field}>
            <span className={styles.label}>Email (optional)</span>
            <input className={styles.input} type="email" value={value.email} onChange={set('email')} autoComplete="off" />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Phone (optional)</span>
            <input className={styles.input} type="tel" value={value.phone} onChange={set('phone')} autoComplete="off" />
          </label>
        </>
      )}
    </div>
  );
};

export default PersonFields;
