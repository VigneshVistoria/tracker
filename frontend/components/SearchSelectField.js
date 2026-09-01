import { useEffect, useState } from 'react';
import styles from '../styles/issues.module.css';

// Text input + filtered dropdown over an already-fetched options array -
// no typeahead component exists anywhere else in this codebase, so this
// is new but deliberately small. Selecting is required: typing something
// that doesn't match a real option just leaves the field unset, so
// entries can't fragment into free-text variants (the caller's required
// fields, e.g. Project, must always resolve to a real one - enforced
// again on the backend regardless of what the UI allows).
export default function SearchSelectField({ label, id, value, onChange, options, disabled, placeholder, required }) {
  const [query, setQuery] = useState(value ? value.name : '');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setQuery(value ? value.name : '');
  }, [value]);

  const filtered = query
    ? options.filter((o) => o.name.toLowerCase().includes(query.toLowerCase()))
    : options;

  return (
    <div className={styles.field} style={{ position: 'relative' }}>
      <label className={styles.label} htmlFor={id}>{label}</label>
      <input
        className={styles.input}
        id={id}
        disabled={disabled}
        required={required}
        placeholder={disabled ? placeholder : 'Type to search...'}
        autoComplete="off"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          if (value) onChange(null);
        }}
        onFocus={() => setOpen(true)}
        // onMouseDown (not onClick) on the options below fires before this
        // blur, otherwise the dropdown would close before a click registers.
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && !disabled && filtered.length > 0 && (
        <div
          style={{
            position: 'absolute', zIndex: 20, top: '100%', left: 0, right: 0, marginTop: 4,
            background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8,
            maxHeight: 220, overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
          }}
        >
          {filtered.map((o) => (
            <div
              key={o.id}
              onMouseDown={() => {
                onChange(o);
                setQuery(o.name);
                setOpen(false);
              }}
              style={{ padding: 'var(--space-2) var(--space-3)', cursor: 'pointer' }}
            >
              {o.name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
