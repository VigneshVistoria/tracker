import styles from '../styles/issues.module.css';

// Defect classification (2026-10-27) - mirrors CLASSIFICATION_FIELDS in
// backend/src/tasks/defect-triage.ts. Used on Create Defect, on each linked
// defect of a QA rejection and in the "Edit classification" dialog, when the
// project has defect triage on. `options` comes from GET
// /defect-triage/options (or the task's triage state): the editable lists and
// which fields are required. Build is free text.
export const CLASSIFICATION_FIELDS = ['severity', 'defectType', 'defectOrigin', 'foundInBuild', 'foundInEnvironment'];
export const CLASSIFICATION_LABELS = {
  severity: 'Severity',
  defectType: 'Defect type',
  defectOrigin: 'Origin (found in)',
  foundInBuild: 'Build',
  foundInEnvironment: 'Environment',
};
const LIST_KEY = { severity: 'severities', defectType: 'types', defectOrigin: 'origins', foundInEnvironment: 'environments' };
const BUILD_MAX = 100;

export const EMPTY_CLASSIFICATION = { severity: '', defectType: '', defectOrigin: '', foundInBuild: '', foundInEnvironment: '' };

// Labels of required fields that are still empty.
export function missingClassification(value, options) {
  return (options?.requiredFields || []).filter((f) => !(value?.[f] || '').trim()).map((f) => CLASSIFICATION_LABELS[f]);
}

// Only the fields with a value, trimmed - what the API takes.
export function classificationPayload(value) {
  const out = {};
  for (const f of CLASSIFICATION_FIELDS) {
    const v = (value?.[f] || '').trim();
    if (v) out[f] = v;
  }
  return out;
}

export default function DefectClassificationFields({ value, onChange, options, idPrefix, attempted = false, disabled = false }) {
  const v = value || EMPTY_CLASSIFICATION;
  const required = (f) => (options?.requiredFields || []).includes(f);
  const invalid = (f) => attempted && required(f) && !(v[f] || '').trim();
  const set = (f, next) => onChange({ ...v, [f]: next });

  const select = (f) => {
    const list = options?.[LIST_KEY[f]] || [];
    // A value no longer on the list (edited since) stays selectable so the
    // form shows what is stored; the backend asks for a current one.
    const items = v[f] && !list.includes(v[f]) ? [v[f], ...list] : list;
    return (
      <div className={styles.field} key={f}>
        <label className={styles.label} htmlFor={`${idPrefix}-${f}`}>
          {CLASSIFICATION_LABELS[f]}
          {required(f) ? '' : ' (optional)'}
        </label>
        <select
          id={`${idPrefix}-${f}`}
          className={styles.select}
          value={v[f] || ''}
          onChange={(e) => set(f, e.target.value)}
          aria-required={required(f)}
          aria-invalid={invalid(f)}
          disabled={disabled}
        >
          <option value="">— Select —</option>
          {items.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </div>
    );
  };

  return (
    <fieldset style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <legend className={styles.label} style={{ padding: 0 }}>
        Classification
      </legend>
      <div className={styles.fieldGrid3}>
        {select('severity')}
        {select('defectType')}
        {select('defectOrigin')}
      </div>
      <div className={styles.fieldGrid3}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${idPrefix}-foundInBuild`}>
            {CLASSIFICATION_LABELS.foundInBuild}
            {required('foundInBuild') ? '' : ' (optional)'}
          </label>
          <input
            id={`${idPrefix}-foundInBuild`}
            className={styles.input}
            value={v.foundInBuild || ''}
            maxLength={BUILD_MAX}
            onChange={(e) => set('foundInBuild', e.target.value)}
            placeholder="e.g. 2.4.1-rc3"
            aria-required={required('foundInBuild')}
            aria-invalid={invalid('foundInBuild')}
            disabled={disabled}
          />
        </div>
        {select('foundInEnvironment')}
      </div>
    </fieldset>
  );
}
