import { useState } from 'react';
import styles from '../../styles/projectTimeline.module.css';
import { formatDate } from '../../lib/formatDate';
import { formatSlip } from '../../lib/projectTimelineSummary';

const PREVIEW = 6;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const slipClass = (d) => (d > 0 ? styles.slipLater : d < 0 ? styles.slipEarlier : '');

function reasonText(reason, row, rowById) {
  switch (reason.code) {
    case 'late_start':
      return row.status === 'On Hold' ? 'On Hold past its start date, so it restarts today at the earliest' : `not started yet (planned start ${formatDate(row.startDate || row.endDate)})`;
    case 'ticket_pace':
      return `tickets ${reason.percent}% done after ${plural(reason.elapsedDays, 'day')}`;
    case 'overdue':
      return `end date passed, still ${row.status}`;
    case 'waits_on': {
      const p = rowById.get(reason.rowId);
      return p ? `waits for ${p.phase} (${p.module})` : 'waits for another phase';
    }
    default:
      return '';
  }
}

// "Forecast" (Stage D): the likely finish of each phase and of the
// project, worked out from today, statuses, dependencies and ticket pace
// (lib/projectTimelineForecast.js). Read-only - it never moves a date.
export default function ForecastPanel({ forecast, rowById, onJump }) {
  const [showAll, setShowAll] = useState(false);
  if (!forecast || !forecast.likelyEnd) return null;
  const late = forecast.rows.filter((f) => !f.done && f.slipDays > 0 && rowById.has(f.id)).sort((a, b) => b.slipDays - a.slipDays || (a.end < b.end ? -1 : 1));
  const shown = showAll ? late : late.slice(0, PREVIEW);
  const drivers = forecast.drivers.map((id) => ({ f: forecast.rows.find((x) => x.id === id), row: rowById.get(id) })).filter((d) => d.f && d.row);
  const why = (f, row) => f.reasons.map((r) => reasonText(r, row, rowById)).filter(Boolean).join('; ');

  return (
    <>
      <h3 className={styles.subTitle} style={{ marginTop: 'var(--ds-space-5)' }}>
        Forecast
      </h3>
      <p className={styles.cardLine}>
        <strong>Likely finish:</strong> {formatDate(forecast.likelyEnd)}
        {forecast.slipDays > 0 ? (
          <>
            {' '}
            – <span className={slipClass(forecast.slipDays)}>{plural(forecast.slipDays, 'day')} after</span> the planned {formatDate(forecast.plannedEnd)}
          </>
        ) : (
          <> – on plan</>
        )}
      </p>
      {forecast.slipDays > 0 && drivers.length > 0 && (
        <p className={styles.cardLine}>
          <strong>What sets it:</strong>{' '}
          {drivers.map(({ f, row }, i) => (
            <span key={f.id}>
              {i > 0 && ', then '}
              <button type="button" className={styles.linkButton} onClick={() => onJump(row.key)} aria-label={`Go to ${row.module} – ${row.phase} in the table`}>
                {row.phase} ({row.module})
              </button>
              {f.reasons.some((r) => r.code !== 'waits_on') && ` – ${f.reasons.filter((r) => r.code !== 'waits_on').map((r) => reasonText(r, row, rowById)).join('; ')}`}
            </span>
          ))}
          .
        </p>
      )}
      {late.length > 0 ? (
        <>
          <h4 className={styles.subTitle}>Likely to finish late ({late.length})</h4>
          <ol className={styles.attention}>
            {shown.map((f) => {
              const row = rowById.get(f.id);
              return (
                <li key={f.id}>
                  <span className={styles.chipSlip}>{formatSlip(f.slipDays)}</span>
                  <span>
                    <strong>{row.module}</strong> – {row.phase} · planned {formatDate(f.plannedEnd)}, likely {formatDate(f.end)} · {why(f, row)}
                  </span>
                  <button type="button" className={styles.linkButton} onClick={() => onJump(row.key)} aria-label={`Go to ${row.module} – ${row.phase} in the table`}>
                    Go to row
                  </button>
                </li>
              );
            })}
          </ol>
          {late.length > PREVIEW && (
            <button type="button" className={styles.linkButton} onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>
              {showAll ? 'Show fewer' : `Show all ${late.length}`}
            </button>
          )}
        </>
      ) : (
        <p className={styles.totals}>Every phase is likely to finish on its planned date.</p>
      )}
      <p className={styles.muted}>
        How it’s worked out: completed phases stay as planned; a phase that should have started but hasn’t starts today at the earliest; a started phase finishes
        no earlier than today, and later if its linked tickets’ pace says so; a phase that hasn’t started waits for the phases it depends on. Nothing is changed.
      </p>
    </>
  );
}
