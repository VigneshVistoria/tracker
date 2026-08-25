import styles from './Skeleton.module.css';

export default function Skeleton({ width, height = '1em', radius, className = '' }) {
  return (
    <span
      className={`${styles.skeleton} ${className}`}
      style={{ width, height, borderRadius: radius }}
      aria-hidden="true"
    />
  );
}

export function SkeletonTable({ rows = 5, columns = 4 }) {
  return (
    <div className={styles.tableSkeleton} aria-hidden="true">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className={styles.tableRow}>
          {Array.from({ length: columns }).map((__, c) => (
            <Skeleton key={c} height="14px" />
          ))}
        </div>
      ))}
    </div>
  );
}
