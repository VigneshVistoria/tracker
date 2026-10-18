import { AlertCircle } from 'lucide-react';
import styles from './ReasonHint.module.css';

// The hint under a required reason box (2026-10-18). Neutral ("At least
// 10 characters. 0/1000") until the reason is too short and the user has
// typed something or tried to confirm - then red, with an icon so it isn't
// colour-only: "Write at least 10 characters (3 more needed)". Always the
// same element (aria-live), referenced by the box's aria-describedby, so
// screen readers hear the change without it re-alerting on every key.
//
// Pair with a confirm button that uses aria-disabled (not disabled), so a
// click on the greyed-out button can set `attempted` and show this.
export default function ReasonHint({ id, length, min, max, attempted, emptyMessage, style }) {
  const missing = Math.max(0, min - length);
  const showError = missing > 0 && (length > 0 || attempted);
  return (
    <p id={id} aria-live="polite" className={showError ? styles.error : styles.neutral} style={style}>
      {showError ? (
        <>
          <AlertCircle size={14} aria-hidden="true" className={styles.icon} />
          {length === 0 && emptyMessage ? emptyMessage : `Write at least ${min} characters (${missing} more needed)`}
        </>
      ) : (
        // A box that only needs to be non-empty gets no neutral text.
        min > 1 && (
          <>
            At least {min} characters.{max ? ` ${length}/${max}` : ''}
          </>
        )
      )}
    </p>
  );
}

// Same red message for a required choice (e.g. "Choose a QA"), shown only
// after a confirm attempt.
export function ChoiceHint({ id, show, children }) {
  return (
    <p id={id} aria-live="polite" className={show ? styles.error : styles.hidden}>
      {show && (
        <>
          <AlertCircle size={14} aria-hidden="true" className={styles.icon} />
          {children}
        </>
      )}
    </p>
  );
}
