import { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import styles from '../../styles/projectTimeline.module.css';
import ov from '../../styles/timelineOverview.module.css';
import { formatDate } from '../../lib/formatDate';
import { RISK_LEVELS, RISK_RULES } from '../../lib/projectTimelineRisk';

const LOAD_LIMIT_KEY = 'projectTimeline.loadLimit';
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const shortDate = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

export const RISK_CLASS = { low: ov.riskLow, medium: ov.riskMedium, high: ov.riskHigh, critical: ov.riskCritical };

export function RiskBadge({ risk }) {
  return (
    <span className={`${ov.riskBadge} ${RISK_CLASS[risk.level.key]}`} title={`Risk ${risk.score} of 100: ${risk.level.label}`}>
      <span className={ov.riskScore}>{risk.score}</span>
      {risk.level.label}
    </span>
  );
}

// "Top risks": the riskiest unfinished phases, with why.
export function TopRisks({ top, counts, onJump }) {
  return (
    <>
      <div className={ov.riskCounts} role="list" aria-label="Unfinished phases by risk">
        {[...RISK_LEVELS].reverse().map((l) => (
          <span key={l.key} role="listitem" className={`${ov.riskCount} ${RISK_CLASS[l.key]}`}>
            <span className={ov.riskCountValue}>{counts[l.key]}</span> {l.label}
          </span>
        ))}
      </div>
      {top.length === 0 ? (
        <p className={styles.totals}>No phase carries any risk right now.</p>
      ) : (
        <ol className={ov.riskList}>
          {top.map((t) => (
            <li key={t.row.key}>
              <RiskBadge risk={t} />
              <span className={ov.riskText}>
                <span>
                  <strong>{t.row.module}</strong> – {t.row.phase}
                </span>
                <span className={ov.riskWhy}>{t.reasons.map((x) => x.text).join(' · ')}</span>
              </span>
              <button type="button" className={styles.linkButton} onClick={() => onJump(t.row.key)} aria-label={`Go to ${t.row.module} – ${t.row.phase} in the table`}>
                Go to row <ArrowRight size={12} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ol>
      )}
      <details className={styles.details}>
        <summary>How risk works</summary>
        <ul className={styles.healthRules}>
          {RISK_RULES.map(([what, points]) => (
            <li key={what}>
              {what}: <strong>{points}</strong>
            </li>
          ))}
        </ul>
        <p className={styles.muted}>
          Capped at 100. {RISK_LEVELS.map((l, i) => `${l.label} ${l.min}${RISK_LEVELS[i + 1] ? `–${RISK_LEVELS[i + 1].min - 1}` : '+'}`).join(', ')}. Completed phases carry no risk.
          It follows your unsaved edits too.
        </p>
      </details>
    </>
  );
}

// "Team load": unfinished phases running at once, per team per week.
// Weeks above the limit (set here, remembered on this browser) are red.
export function TeamLoad({ load, onFilter, readOnly = false }) {
  const [limit, setLimit] = useState(3);
  useEffect(() => {
    const saved = Number(localStorage.getItem(LOAD_LIMIT_KEY));
    if (saved >= 1 && saved <= 20) setLimit(saved);
  }, []);
  const changeLimit = (v) => {
    const n = Math.max(1, Math.min(20, Number(v) || 1));
    setLimit(n);
    try {
      localStorage.setItem(LOAD_LIMIT_KEY, String(n));
    } catch {
      // Not remembered - fine.
    }
  };
  if (!load.teams.length) return <p className={styles.muted}>No unfinished phases with both dates in these weeks.</p>;
  const over = load.teams
    .map((t) => {
      const weeks = t.cells.map((c, i) => ({ ...c, week: load.weeks[i] })).filter((c) => c.count > limit);
      return { team: t, weeks };
    })
    .filter((x) => x.weeks.length);

  return (
    <>
      <div className={ov.loadHead}>
        {readOnly ? (
          <span className={ov.loadLimit}>Red: more than {limit} phases at once</span>
        ) : (
          <label className={ov.loadLimit} htmlFor="tl-load-limit">
            Flag weeks with more than
            <input id="tl-load-limit" type="number" min={1} max={20} value={limit} onChange={(e) => changeLimit(e.target.value)} className={styles.input} />
            phases at once
          </label>
        )}
        <span className={over.length ? ov.toneError : ov.toneSuccess}>
          {over.length
            ? over.map((x) => `${x.team.name}: ${plural(x.weeks.length, 'week')} over (peak ${x.team.peak})`).join(' · ')
            : `No team goes over ${limit} at once.`}
        </span>
      </div>
      <div className={ov.loadScroll}>
        <table className={ov.load}>
          <caption className="sr-only">Unfinished phases running at once, per team and week. Select a cell to show those phases.</caption>
          <thead>
            <tr>
              <th scope="col">Team</th>
              {load.weeks.map((w) => (
                <th key={w.start} scope="col" className={w.current ? ov.loadNow : ''} title={`Week of ${formatDate(w.start)}`}>
                  {w.current ? 'This wk' : shortDate(w.start)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {load.teams.map((t) => (
              <tr key={t.key}>
                <th scope="row">{t.name}</th>
                {t.cells.map((c, i) => {
                  const w = load.weeks[i];
                  const overLimit = c.count > limit;
                  const shade = overLimit ? undefined : c.count ? `color-mix(in srgb, var(--ds-text-primary) ${Math.round(6 + (c.count / limit) * 16)}%, var(--ds-bg-surface))` : undefined;
                  return (
                    <td key={w.start} className={`${overLimit ? ov.loadOver : ''} ${w.current ? ov.loadNowCell : ''}`} style={shade ? { background: shade } : undefined}>
                      {c.count > 0 && readOnly ? (
                        <span className={ov.loadCell} title={c.rows.map((r) => `${r.module} – ${r.phase}`).join('\n')}>
                          {c.count}
                        </span>
                      ) : c.count > 0 ? (
                        <button
                          type="button"
                          className={ov.loadCell}
                          onClick={() => onFilter({ team: t.key, from: w.start, to: w.end })}
                          aria-label={`${t.name}, week of ${formatDate(w.start)}: ${plural(c.count, 'phase')} at once${overLimit ? ', over the limit' : ''}. Show them`}
                          title={c.rows.map((r) => `${r.module} – ${r.phase}`).join('\n')}
                        >
                          {c.count}
                        </button>
                      ) : (
                        <span className={ov.loadEmpty} aria-hidden="true">
                          ·
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
