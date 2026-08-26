// Target is always 100% (see plan discussion) - the track's full width
// already IS the target, so the filled portion vs. the track is an
// honest "actual vs target" read without needing a separate marker line.
export default function CompletionVsTargetBar({ label, percent }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
      <span style={{ width: '160px', fontSize: '0.85rem', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label}
      </span>
      <div style={{ flex: 1, position: 'relative', height: '10px', background: 'var(--color-slate-tint)', borderRadius: '4px' }}>
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: `${Math.min(100, percent)}%`,
            background: 'var(--color-amber)',
            borderRadius: '4px',
          }}
        />
      </div>
      <span style={{ width: '48px', textAlign: 'right', fontSize: '0.85rem', fontWeight: 600, flexShrink: 0 }}>{percent}%</span>
    </div>
  );
}
