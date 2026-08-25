import { useId } from 'react';
import styles from './Field.module.css';

export default function Input({
  label,
  hint,
  error,
  leftIcon: LeftIcon,
  className = '',
  id,
  required,
  ...rest
}) {
  const generatedId = useId();
  const inputId = id || generatedId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;

  return (
    <div className={`${styles.field} ${className}`}>
      {label && (
        <label className={styles.label} htmlFor={inputId}>
          {label}
          {required && <span className={styles.required} aria-hidden="true"> *</span>}
        </label>
      )}
      <div className={styles.inputWrap}>
        {LeftIcon && <LeftIcon size={16} className={styles.leftIcon} aria-hidden="true" />}
        <input
          id={inputId}
          className={`${styles.input} ${LeftIcon ? styles.hasLeftIcon : ''} ${error ? styles.inputError : ''}`}
          aria-invalid={Boolean(error)}
          aria-describedby={[hintId, errorId].filter(Boolean).join(' ') || undefined}
          required={required}
          {...rest}
        />
      </div>
      {hint && !error && <p id={hintId} className={styles.hint}>{hint}</p>}
      {error && <p id={errorId} className={styles.error} role="alert">{error}</p>}
    </div>
  );
}
