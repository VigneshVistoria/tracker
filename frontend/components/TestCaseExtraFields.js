import styles from '../styles/issues.module.css';
import { FIELD_TYPE } from '../lib/testCaseFields';

// Labels + Admin/PM-defined custom field inputs for the test case
// create/edit form (pages/qa/test-cases/new.js). Controlled: `labelIds`
// is an array of label ids, `values` is { [fieldId]: string } - numbers
// are kept as strings while editing and converted on submit.
//
// Only active labels/fields are offered, except ones already set on the
// test case being edited, which stay visible so saving doesn't silently
// drop them.
export default function TestCaseExtraFields({ labels, fields, labelIds, values, originalLabelIds = [], originalValues = {}, onLabelsChange, onValueChange }) {
  const visibleLabels = labels.filter((l) => l.isActive || originalLabelIds.includes(l.id));
  const visibleFields = fields.filter((f) => f.isActive || (originalValues[f.id] ?? '') !== '');

  const toggleLabel = (id) =>
    onLabelsChange(labelIds.includes(id) ? labelIds.filter((x) => x !== id) : [...labelIds, id]);

  return (
    <>
      <fieldset className={styles.field} style={{ border: 0, padding: 0, margin: '0 0 var(--space-4)' }}>
        <legend className={styles.label}>Labels</legend>
        {visibleLabels.length === 0 && (
          <p className={styles.helpText}>No labels yet - an Admin or Program Manager can add them under Labels.</p>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', columnGap: 'var(--space-4)' }}>
          {visibleLabels.map((label) => (
            <label key={label.id} className={styles.checkboxRow}>
              <input type="checkbox" checked={labelIds.includes(label.id)} onChange={() => toggleLabel(label.id)} />
              {label.name}
              {!label.isActive && ' (inactive)'}
            </label>
          ))}
        </div>
      </fieldset>

      {visibleFields.map((field) => {
        const id = `customField-${field.id}`;
        const value = values[field.id] ?? '';
        const inactive = !field.isActive;
        const common = {
          id,
          value,
          required: field.isRequired && !inactive,
          disabled: inactive,
          onChange: (e) => onValueChange(field.id, e.target.value),
        };
        return (
          <div className={styles.field} key={field.id}>
            <label className={styles.label} htmlFor={id}>
              {field.name}
              {field.isRequired && !inactive && <span aria-hidden="true"> *</span>}
              {inactive && ' (inactive)'}
            </label>
            {field.fieldType === FIELD_TYPE.DROPDOWN && (
              <select className={styles.select} {...common}>
                <option value="">{field.isRequired ? 'Select...' : 'None'}</option>
                {/* A saved value whose option was since removed stays selectable so it isn't silently cleared. */}
                {value && !field.options.includes(value) && <option value={value}>{value}</option>}
                {field.options.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            )}
            {field.fieldType === FIELD_TYPE.TEXT && <input className={styles.input} type="text" maxLength={5000} {...common} />}
            {field.fieldType === FIELD_TYPE.NUMBER && <input className={styles.input} type="number" step="any" {...common} />}
            {field.fieldType === FIELD_TYPE.DATE && <input className={styles.input} type="date" {...common} />}
          </div>
        );
      })}
    </>
  );
}
