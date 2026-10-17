import { History } from 'lucide-react';
import styles from '../../styles/projectTimeline.module.css';
import { formatDate, formatDateTime } from '../../lib/formatDate';
import { formatSlip } from '../../lib/projectTimelineSummary';

export const CHANGE_PERIODS = [7, 14, 30];
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const FIELD_LABEL = { module: 'Module', phase: 'Phase', team: 'Team', status: 'Status', startDate: 'Start', endDate: 'End' };
const show = (field, v) => (v == null || v === '' ? 'none' : field === 'startDate' || field === 'endDate' ? formatDate(v) : v);

function changeLines(p) {
  return Object.entries(p.changes).map(([field, c]) => {
    const text = `${FIELD_LABEL[field] || field} ${show(field, c.old)} to ${show(field, c.new)}`;
    return field === 'endDate' && p.endShiftDays ? `${text} (${formatSlip(p.endShiftDays)})` : text;
  });
}

// "What changed" (Stage D): net changes to the saved plan over the last
// 7/14/30 days, from the audit log. Read-only.
export default function ChangesPanel({ data, loading, error, days, onDays, rowKeyById, onJump }) {
  const t = data?.totals;
  const parts = t
    ? [
        t.endLater && `${plural(t.endLater, 'end date')} later`,
        t.endEarlier && `${t.endEarlier} earlier`,
        t.statusChanged && `${plural(t.statusChanged, 'status change')}${t.completed ? ` (${t.completed} completed)` : ''}`,
        t.added && `${plural(t.added, 'phase')} added`,
        t.removed && `${plural(t.removed, 'phase')} removed`,
        t.otherChanged && `${plural(t.otherChanged, 'other edit')}`,
        t.planEvents && `${plural(t.planEvents, 'plan change')}`,
      ].filter(Boolean)
    : [];

  return (
    <>
      <div className={styles.summaryHeader}>
        <h3 className={styles.subTitle} style={{ margin: 0 }}>
          What changed
        </h3>
        <label className="sr-only" htmlFor="tl-changes-days">
          Period
        </label>
        <select id="tl-changes-days" className={styles.select} style={{ width: 'auto' }} value={days} onChange={(e) => onDays(Number(e.target.value))}>
          {CHANGE_PERIODS.map((d) => (
            <option key={d} value={d}>
              Last {d} days
            </option>
          ))}
        </select>
      </div>
      {error && <p className={styles.issueError}>Changes could not be loaded: {error}</p>}
      {loading && !data && <p className={styles.muted}>Loading changes…</p>}
      {data && (
        <>
          <p className={styles.muted}>
            Saved changes from {formatDateTime(data.from)} to now, from the change history. Each phase shows its net change: a date moved and moved back
            counts as no change.
          </p>
          {parts.length === 0 ? (
            <p className={styles.totals}>No changes to the plan in the last {days} days.</p>
          ) : (
            <>
              <p className={styles.cardLine}>
                <strong>{parts.join(' · ')}</strong>
                {data.people.length > 0 && <> · by {data.people.map((p) => `${p.email} (${p.changes})`).join(', ')}</>}
              </p>
              {data.phases.length > 0 && (
                <ol className={styles.attention}>
                  {data.phases.map((p) => {
                    const key = p.kind !== 'removed' ? rowKeyById.get(p.rowId) : null;
                    return (
                      <li key={p.rowId}>
                        {p.kind === 'changed' && p.endShiftDays ? (
                          <span className={styles.chipSlip}>{formatSlip(p.endShiftDays)}</span>
                        ) : (
                          <span className={styles.chipSlip}>{p.kind === 'added' ? 'Added' : p.kind === 'removed' ? 'Removed' : 'Edited'}</span>
                        )}
                        <span>
                          <strong>{p.module}</strong> – {p.phase}
                          {p.kind === 'changed' && <> · {changeLines(p).join(' · ')}</>} · {p.by.join(', ') || 'unknown'}
                        </span>
                        {key && (
                          <button type="button" className={styles.linkButton} onClick={() => onJump(key)} aria-label={`Go to ${p.module} – ${p.phase} in the table`}>
                            Go to row
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ol>
              )}
              {data.events.length > 0 && (
                <details className={styles.details} open={data.phases.length === 0}>
                  <summary>
                    <History size={12} aria-hidden="true" /> Plan changes ({data.events.length})
                  </summary>
                  <ul>
                    {data.events.map((e) => (
                      <li key={e.id}>
                        {formatDateTime(e.at)} – {e.by || 'unknown'}: {e.text}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}
