import { useId } from 'react';
import { ChevronDown } from 'lucide-react';
import styles from './Field.module.css';

export default function Select({
  label,
  hint,
  error,
  className = '',
  id,
  required,
  children,
  ...rest
}) {
  const generatedId = useId();
  const selectId = id || generatedId;
  const hintId = hint ? `${selectId}-hint` : undefined;
  const errorId = error ? `${selectId}-error` : undefined;

  return (
    <div className={`${styles.field} ${className}`}>
      {label && (
        <label className={styles.label} htmlFor={selectId}>
          {label}
          {required && <span className={styles.required} aria-hidden="true"> *</span>}
        </label>
      )}
      <div className={styles.selectWrap}>
        <select
          id={selectId}
          className={`${styles.input} ${styles.select} ${error ? styles.inputError : ''}`}
          aria-invalid={Boolean(error)}
          aria-describedby={[hintId, errorId].filter(Boolean).join(' ') || undefined}
          required={required}
          {...rest}
        >
          {children}
        </select>
        <ChevronDown size={16} className={styles.selectChevron} aria-hidden="true" />
      </div>
      {hint && !error && <p id={hintId} className={styles.hint}>{hint}</p>}
      {error && <p id={errorId} className={styles.error} role="alert">{error}</p>}
    </div>
  );
}
