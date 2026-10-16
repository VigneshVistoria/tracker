import { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import styles from '../../styles/projectTimeline.module.css';
import { STATUS_TONE, dateRange } from '../../lib/projectTimeline';

// "Status check": phases whose status doesn't fit their dates, grouped by
// rule (lib/projectTimelineSummary STATUS_CHECK_RULES). Fixes change the
// page only - the PM still clicks Save changes, so each fix is audited
// like any edit. Executive sees the list without buttons.
export default function StatusCheck({ check, today, teamName, canEdit, onFix, onFixAll, onJump }) {
  const [dismissed, setDismissed] = useState(() => new Set());
  const groups = check.groups.map((g) => ({ ...g, rows: g.rows.filter((r) => !dismissed.has(r.key)) }));
  const total = groups.reduce((n, g) => n + g.rows.length, 0);

  return (
    <>
      <h3 className={styles.subTitle}>Status check ({total})</h3>
      {total === 0 ? (
        <p className={styles.totals}>
          <CheckCircle2 size={14} aria-hidden="true" /> Every status fits its dates.
        </p>
      ) : (
        <>
          <p className={styles.muted}>
            Statuses that don't fit their dates.{canEdit ? ' A fix only changes this page - click Save changes to keep it.' : ''}
          </p>
          {groups
            .filter((g) => g.rows.length > 0)
            .map(({ rule, rows }) => (
              <details key={rule.id} className={styles.checkGroup} open={rule.open}>
                <summary>
                  <strong>
                    {rule.title} ({rows.length})
                  </strong>{' '}
                  <span className={styles.muted}>– {rule.hint}</span>
                </summary>
                {canEdit && rule.bulk && rows.length > 1 && (
                  <Button size="sm" variant="secondary" onClick={() => onFixAll(rows.map((r) => r.key), rule.bulk.patch, `${rule.bulk.label} (${rows.length})`)}>
                    {rule.bulk.label} ({rows.length})
                  </Button>
                )}
                <ul className={styles.checkList}>
                  {rows.map((r) => (
                    <li key={r.key}>
                      <span>
                        <strong>{r.module}</strong> – {r.phase}
                        {r.teamId != null && teamName.get(r.teamId) ? ` · ${teamName.get(r.teamId)}` : ''} · {dateRange(r.startDate, r.endDate)}{' '}
                        <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>
                      </span>
                      <span className={styles.checkActions}>
                        {canEdit &&
                          rule.fixes.map((fix) => {
                            const patch = typeof fix.patch === 'function' ? fix.patch(r, today) : fix.patch;
                            if (fix.patch && !patch) return null;
                            const label = `${fix.label}: ${r.module} – ${r.phase}`;
                            if (fix.jump) {
                              return (
                                <button key={fix.label} type="button" className={styles.linkButton} onClick={() => onJump(r.key)} aria-label={label}>
                                  {fix.label}
                                </button>
                              );
                            }
                            if (fix.dismiss) {
                              return (
                                <button key={fix.label} type="button" className={styles.linkButton} onClick={() => setDismissed((s) => new Set(s).add(r.key))} aria-label={label}>
                                  {fix.label}
                                </button>
                              );
                            }
                            return (
                              <button key={fix.label} type="button" className={styles.linkButton} onClick={() => onFix(r.key, patch)} aria-label={label}>
                                {fix.label}
                              </button>
                            );
                          })}
                        {!canEdit && (
                          <button type="button" className={styles.linkButton} onClick={() => onJump(r.key)} aria-label={`Go to ${r.module} – ${r.phase} in the table`}>
                            Go to row
                          </button>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
        </>
      )}
    </>
  );
}
