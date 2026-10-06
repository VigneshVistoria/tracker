import Skeleton from './Skeleton';
import styles from './Skeleton.module.css';

// Drop-in replacement for the old "Loading..." text: a few shimmering
// rows shaped like the content that's coming, announced to screen
// readers as a single polite status.
export default function LoadingState({ rows = 3, label = 'Loading…' }) {
  return (
    <div className={styles.loadingState} role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} height="44px" className={styles.loadingRow} />
      ))}
    </div>
  );
}
