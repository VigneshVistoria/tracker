import { useMemo, useState } from 'react';
import styles from '../../styles/requirements.module.css';
import forms from '../../styles/issues.module.css';

// Pick the SRS requirement IDs a story traces to: a filter box and a
// scrolling checkbox list (ID, priority, text).
export default function RequirementPicker({ requirements, value, onChange, idPrefix = 'req' }) {
  const [filter, setFilter] = useState('');
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? requirements.filter((r) => `${r.code} ${r.text}`.toLowerCase().includes(q)) : requirements;
  }, [requirements, filter]);
  const toggle = (id) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <fieldset className={styles.pickerBox}>
      <legend className={forms.label}>Traces to requirement IDs ({value.length} chosen)</legend>
      <input type="search" className={forms.input} value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by ID or text" aria-label="Filter requirements" />
      <div className={styles.pickerList}>
        {shown.map((r) => (
          <label key={r.id} className={styles.pickerItem} htmlFor={`${idPrefix}-${r.id}`}>
            <input id={`${idPrefix}-${r.id}`} type="checkbox" checked={value.includes(r.id)} onChange={() => toggle(r.id)} />
            <span>
              <b>{r.code}</b> {r.text} <span className={styles.muted}>· {r.priority[0].toUpperCase() + r.priority.slice(1)}</span>
            </span>
          </label>
        ))}
        {!shown.length && <p className={styles.muted}>No requirement matches.</p>}
      </div>
    </fieldset>
  );
}
