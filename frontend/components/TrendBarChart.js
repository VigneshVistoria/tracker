import styles from '../styles/issues.module.css';

// A small, dependency-free bar chart: thin bars, rounded data-ends, a
// single sequential hue for magnitude (completions), direct value labels
// since the point count here is always low (<=8 buckets).
export default function TrendBarChart({ points }) {
  const max = Math.max(1, ...points.map((p) => p.completed));

  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--space-2)', height: '160px', paddingTop: 'var(--space-5)' }}>
      {points.map((p, i) => (
        <div
          key={i}
          style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-1)', height: '100%', justifyContent: 'flex-end' }}
        >
          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-ink-soft)' }}>{p.completed}</span>
          <div
            title={`${p.label}: ${p.completed} completed`}
            style={{
              width: '100%',
              maxWidth: '32px',
              height: `${Math.max(4, (p.completed / max) * 100)}%`,
              background: 'var(--color-amber)',
              borderRadius: '4px 4px 0 0',
            }}
          />
          <span className={styles.issueMeta} style={{ fontSize: '0.7rem', whiteSpace: 'nowrap' }}>{p.label}</span>
        </div>
      ))}
    </div>
  );
}
