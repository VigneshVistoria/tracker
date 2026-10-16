import { History, RotateCcw } from 'lucide-react';
import Button from '../ui/Button';
import styles from '../../styles/projectTimeline.module.css';
import { formatDate, formatDateTime } from '../../lib/formatDate';
import { formatSlip } from '../../lib/projectTimelineSummary';

const slipClass = (d) => (d > 0 ? styles.slipLater : d < 0 ? styles.slipEarlier : '');

// "Slip since plan": current end dates against the baseline (the dates a
// phase had when it entered the plan, or at the last PM reset). Calendar
// days; negative = pulled earlier. Baselines come from the audit log.
export default function SlipPanel({ slip, loading, error, canReset, unsaved, onReset, onJump }) {
  const latestReset = slip?.resets?.[0];
  return (
    <>
      <div className={styles.summaryHeader} style={{ marginTop: 'var(--ds-space-5)' }}>
        <h3 className={styles.subTitle} style={{ margin: 0 }}>
          Slip since plan
        </h3>
        {canReset && slip && (
          <div className={styles.actions}>
            <Button size="sm" variant="secondary" leftIcon={RotateCcw} onClick={onReset} disabled={unsaved} title={unsaved ? 'Save or discard your changes first' : undefined}>
              Reset baseline
            </Button>
          </div>
        )}
      </div>
      {error && <p className={styles.issueError}>Slip could not be loaded: {error}</p>}
      {loading && !slip && <p className={styles.muted}>Loading slip…</p>}
      {slip && (
        <>
          <p className={styles.muted}>
            {latestReset ? (
              <>
                Baseline reset {formatDateTime(latestReset.at)} by {latestReset.by || 'unknown'} – “{latestReset.reason}”.
              </>
            ) : (
              <>Baseline: the dates each phase had when it entered the plan{slip.baselineFrom ? ` (first import ${formatDate(slip.baselineFrom)})` : ''}.</>
            )}{' '}
            Slip = current end date minus baseline end date, in calendar days.
          </p>
          {!slip.anyMoved ? (
            <p className={styles.totals}>No end dates have moved since the baseline.</p>
          ) : (
            <>
              <p className={styles.cardLine}>
                <strong>Overall finish:</strong> planned {formatDate(slip.overall.plannedEnd)} → now {formatDate(slip.overall.currentEnd)}{' '}
                <span className={slipClass(slip.overall.slip)}>({formatSlip(slip.overall.slip)})</span> · {slip.overall.later} phase{slip.overall.later === 1 ? '' : 's'} later,{' '}
                {slip.overall.earlier} earlier
              </p>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <caption className="sr-only">Planned and current end date for each module</caption>
                  <thead>
                    <tr>
                      <th scope="col">Module</th>
                      <th scope="col">Planned end</th>
                      <th scope="col">Current end</th>
                      <th scope="col">Slip</th>
                      <th scope="col">Phases moved</th>
                    </tr>
                  </thead>
                  <tbody>
                    {slip.modules.map((m) => (
                      <tr key={m.key}>
                        <th scope="row" className={styles.gridRowHead}>
                          {m.name}
                        </th>
                        <td className={styles.nowrap}>{formatDate(m.plannedEnd)}</td>
                        <td className={styles.nowrap}>{formatDate(m.currentEnd)}</td>
                        <td className={`${styles.nowrap} ${slipClass(m.slip)}`}>{formatSlip(m.slip)}</td>
                        <td>
                          {m.later} later, {m.earlier} earlier
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {slip.mostSlipped.length > 0 && (
                <>
                  <h4 className={styles.subTitle}>Most slipped phases</h4>
                  <ol className={styles.attention}>
                    {slip.mostSlipped.map((s) => (
                      <li key={s.row.key}>
                        <span className={styles.chipSlip}>{formatSlip(s.slip)}</span>
                        <span>
                          <strong>{s.row.module}</strong> – {s.row.phase} · planned {formatDate(s.baselineEnd)} → {formatDate(s.row.endDate)} · moved {s.endMoves} time
                          {s.endMoves === 1 ? '' : 's'}
                        </span>
                        <button type="button" className={styles.linkButton} onClick={() => onJump(s.row.key)} aria-label={`Go to ${s.row.module} – ${s.row.phase} in the table`}>
                          Go to row
                        </button>
                      </li>
                    ))}
                  </ol>
                </>
              )}
            </>
          )}
          {slip.resets.length > 0 && (
            <details className={styles.details}>
              <summary>
                <History size={12} aria-hidden="true" /> Baseline history ({slip.resets.length} reset{slip.resets.length === 1 ? '' : 's'})
              </summary>
              <ul>
                {slip.resets.map((r, i) => (
                  <li key={i}>
                    {formatDateTime(r.at)} – {r.by || 'unknown'}: “{r.reason}” ({r.rows} phases)
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </>
  );
}
