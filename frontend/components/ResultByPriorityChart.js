import { useEffect, useRef, useState } from 'react';
import { formatPercent } from '../lib/formatNumber';
import styles from './TestCaseExecutionSummary.module.css';

// Dependency-free stacked bar chart, same approach as TrendBarChart: one
// horizontal bar per priority, split by result. Segment order is Pass ->
// Blocked -> Fail -> Not Executed so green and red never touch (they're
// indistinguishable side by side for red-green colour blindness); colours
// per theme live in TestCaseExecutionSummary.module.css (--tc-*), checked
// with the dataviz palette validator. Every segment's count is also in
// the By Priority table under the chart, which is its text alternative.
const SEGMENTS = [
  { key: 'passed', label: 'Pass', className: styles.segPass },
  { key: 'blocked', label: 'Blocked', className: styles.segBlocked },
  { key: 'failed', label: 'Fail', className: styles.segFail },
  { key: 'notExecuted', label: 'Not Executed', className: styles.segNone },
  { key: 'na', label: 'N/A', className: styles.segNa },
];

// Below this width a count no longer fits inside its segment - it's left
// to the tooltip and the table instead of being clipped.
const MIN_LABEL_PX = 24;
// Space .bar reserves after the longest bar for its total (--ds-space-10).
const TOTAL_LABEL_PX = 40;

function useWidth(ref) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return undefined;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

function describeRow(name, row, segments) {
  return `${name}: ${row.total} total. ${segments.map((s) => `${s.label} ${row[s.key]}`).join(', ')}.`;
}

// rows: ExecutionSummary.byPriority from GET /test-cases/execution-summary.
export default function ResultByPriorityChart({ rows }) {
  const trackRef = useRef(null);
  const trackWidth = useWidth(trackRef);
  // { row index, segment key | null } - null = keyboard focus on the whole
  // bar, which lists every segment.
  const [active, setActive] = useState(null);

  // N/A (Deprecated) only appears, in the bars and the legend, when there
  // are any - so each bar always adds up to its total.
  const segments = SEGMENTS.filter((s) => s.key !== 'na' || rows.some((r) => r.na > 0));
  const max = Math.max(1, ...rows.map((r) => r.total));

  return (
    <figure className={styles.chart}>
      <figcaption className={styles.caption}>Result by Priority</figcaption>
      <ul className={styles.legend} aria-label="Legend">
        {segments.map((s) => (
          <li key={s.key} className={styles.legendItem}>
            <span className={`${styles.swatch} ${s.className}`} aria-hidden="true" />
            {s.label}
          </li>
        ))}
      </ul>

      <div className={styles.chartRows}>
        {rows.map((row, rowIndex) => {
          const name = row.priority ?? 'Not set';
          const barPercent = (row.total / max) * 100;
          const isActive = active?.row === rowIndex;
          const activeSegment = isActive && active.segment ? segments.find((s) => s.key === active.segment) : null;
          return (
            <div key={name} className={styles.chartRow}>
              <span className={styles.chartLabel}>{name}</span>
              <div className={styles.track} ref={rowIndex === 0 ? trackRef : undefined}>
                <div
                  className={styles.bar}
                  style={{ '--bar-share': barPercent / 100 }}
                  role="img"
                  tabIndex={0}
                  aria-label={describeRow(name, row, segments)}
                  onFocus={() => setActive({ row: rowIndex, segment: null })}
                  onBlur={() => setActive(null)}
                  onMouseLeave={() => setActive(null)}
                >
                  {segments
                    .filter((s) => row[s.key] > 0)
                    .map((s) => {
                      const count = row[s.key];
                      const fits = (count / max) * (trackWidth - TOTAL_LABEL_PX) >= MIN_LABEL_PX;
                      return (
                        <div
                          key={s.key}
                          className={`${styles.segment} ${s.className}`}
                          style={{ flexGrow: count }}
                          onMouseEnter={() => setActive({ row: rowIndex, segment: s.key })}
                        >
                          {fits && <span aria-hidden="true">{count}</span>}
                        </div>
                      );
                    })}
                </div>
                <span className={styles.chartTotal}>{row.total}</span>
                {isActive && (
                  <div className={styles.tooltip} role="tooltip">
                    <div className={styles.tooltipTitle}>{name}</div>
                    {(activeSegment ? [activeSegment] : segments).map((s) => (
                      <div key={s.key} className={styles.tooltipRow}>
                        <span className={`${styles.swatch} ${s.className}`} aria-hidden="true" />
                        <span>{s.label}</span>
                        <span className={styles.tooltipValue}>
                          {row[s.key]} ({formatPercent(row[s.key], row.total)})
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </figure>
  );
}
