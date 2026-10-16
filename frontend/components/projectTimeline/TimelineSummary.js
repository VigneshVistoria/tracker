import { useState } from 'react';
import { CheckCircle2, ClipboardCopy, AlertTriangle, ArrowRight } from 'lucide-react';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import StatusCheck from './StatusCheck';
import SlipPanel from './SlipPanel';
import styles from '../../styles/projectTimeline.module.css';
import { formatDate } from '../../lib/formatDate';
import { dateRange } from '../../lib/projectTimeline';
import { ATTENTION_PREVIEW, EMPTY_FILTERS, HEALTH_RULES, SOON_DAYS, daysBetween } from '../../lib/projectTimelineSummary';

export const HEALTH_TONE = { Done: 'success', 'On track': 'info', 'At risk': 'warning', Late: 'error', 'Not started': 'neutral' };

// Segment order and colours for every status bar on the Summary.
const SEGMENTS = [
  ['completed', 'Completed', styles.segCompleted],
  ['inProgress', 'In Progress', styles.segInProgress],
  ['toDo', 'To Do', styles.segToDo],
  ['delayed', 'Delayed', styles.segDelayed],
  ['onHold', 'On Hold', styles.segOnHold],
];

// Overlapping phases: drawn so the statuses that need attention end up on top.
const DRAW_ORDER = { 'To Do': 0, Completed: 1, 'On Hold': 2, 'In Progress': 3, Delayed: 4 };
const SEGMENT_CLASS = Object.fromEntries(SEGMENTS.map(([, label, cls]) => [label, cls]));

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function StatusBar({ c, label }) {
  const parts = SEGMENTS.filter(([k]) => c[k] > 0);
  return (
    <span className={styles.segBar} role="img" aria-label={`${label}: ${parts.map(([k, l]) => `${c[k]} ${l}`).join(', ') || 'no phases'}`}>
      {parts.map(([k, l, cls]) => (
        <span key={k} className={cls} style={{ flexGrow: c[k] }} title={`${l}: ${c[k]}`} />
      ))}
    </span>
  );
}

function Legend() {
  return (
    <ul className={styles.legend} aria-label="Bar colours">
      {SEGMENTS.map(([k, l, cls]) => (
        <li key={k}>
          <span className={`${styles.legendSwatch} ${cls}`} aria-hidden="true" />
          {l}
        </li>
      ))}
    </ul>
  );
}

// A number that filters the table when clicked.
function FilterNumber({ value, label, onClick, tone }) {
  return (
    <button type="button" className={`${styles.numButton} ${tone === 'error' && value > 0 ? styles.numError : ''}`} onClick={onClick} aria-label={`${label}: ${value}. Show these phases`}>
      <span className={styles.numValue}>{value}</span>
      <span className={styles.numLabel}>{label}</span>
    </button>
  );
}

function MiniTimeline({ summary, onFilter }) {
  const { overall, modules, today } = summary;
  if (!overall.start || !overall.end) return <p className={styles.muted}>No dates to draw yet.</p>;
  const total = daysBetween(overall.start, overall.end) + 1;
  const pos = (iso) => `${(daysBetween(overall.start, iso) / total) * 100}%`;
  const months = [];
  const d = new Date(`${overall.start.slice(0, 7)}-01T00:00:00Z`);
  while (d.toISOString().slice(0, 10) <= overall.end) {
    const iso = d.toISOString().slice(0, 10);
    if (iso >= overall.start) months.push(iso);
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  const todayIn = today >= overall.start && today <= overall.end;
  return (
    <div className={styles.miniTimeline}>
      <div className={styles.mtRow} aria-hidden="true">
        <span />
        <span className={styles.mtAxis}>
          {months.map((m) => (
            <span key={m} className={styles.mtMonth} style={{ left: pos(m) }}>
              {new Date(`${m}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' })}
            </span>
          ))}
        </span>
      </div>
      {modules.map((m) => (
        <div key={m.key} className={styles.mtRow}>
          <button type="button" className={styles.mtName} onClick={() => onFilter({ ...EMPTY_FILTERS, module: m.key })} aria-label={`${m.name}: ${dateRange(m.start, m.end)}. Show this module`}>
            {m.name}
          </button>
          <span className={styles.mtTrack} role="img" aria-label={`${m.name}: ${dateRange(m.start, m.end)}, ${m.completed} of ${m.total} completed`}>
            {/* Each phase drawn at its own dates, coloured by its status (DRAW_ORDER on overlaps). */}
            {m.rows
              .filter((r) => r.startDate && r.endDate)
              .sort((a, b) => (DRAW_ORDER[a.status] ?? 0) - (DRAW_ORDER[b.status] ?? 0))
              .map((r) => (
                <span
                  key={r.key}
                  className={`${styles.mtPhase} ${SEGMENT_CLASS[r.status] || ''}`}
                  style={{ left: pos(r.startDate), width: `${((daysBetween(r.startDate, r.endDate) + 1) / total) * 100}%` }}
                  title={`${r.phase}: ${r.status}, ${dateRange(r.startDate, r.endDate)}`}
                />
              ))}
            {todayIn && <span className={styles.mtToday} style={{ left: pos(today) }} aria-hidden="true" />}
          </span>
        </div>
      ))}
      {todayIn && (
        <div className={styles.mtRow} aria-hidden="true">
          <span />
          <span className={styles.mtAxis}>
            <span className={styles.mtTodayLabel} style={{ left: pos(today) }}>
              Today
            </span>
          </span>
        </div>
      )}
      <p className="sr-only">Today is {formatDate(today)} in the team time zone.</p>
    </div>
  );
}

// Read-only Summary above the Project Timeline table. Every card and
// number sets the table's filters (onFilter) - nothing here edits.
export default function TimelineSummary({
  summary,
  projectName,
  unsaved,
  onFilter,
  onJump,
  onCopy,
  check,
  teamName,
  canEdit,
  onFix,
  onFixAll,
  slip,
  slipLoading,
  slipError,
  canResetBaseline,
  onResetBaseline,
}) {
  const [showAll, setShowAll] = useState(false);
  const { overall, modules, teams, grid, attention, runningLate, totals, today } = summary;
  const filter = (patch) => onFilter({ ...EMPTY_FILTERS, ...patch });
  const attentionShown = showAll ? attention : attention.slice(0, ATTENTION_PREVIEW);

  return (
    <section className={styles.summary} aria-labelledby="tl-summary-heading">
      <div className={styles.summaryHeader}>
        <h2 id="tl-summary-heading" className={styles.sectionTitle} style={{ margin: 0 }}>
          Summary
        </h2>
        {unsaved && <Badge tone="warning">Includes unsaved changes</Badge>}
        <div className={styles.actions}>
          <Button size="sm" variant="secondary" leftIcon={ClipboardCopy} onClick={onCopy} disabled={unsaved} title={unsaved ? 'Save or discard your changes first' : undefined}>
            Copy summary
          </Button>
        </div>
      </div>
      {unsaved && <p className={styles.muted}>Copy summary is available again once your changes are saved or discarded.</p>}

      {/* 1. Overall */}
      <div className={styles.overall}>
        <div>
          <span className={styles.overallBig}>{overall.completed}</span> of {plural(overall.total, 'phase')} completed{' '}
          <strong>({overall.pct}%)</strong>
        </div>
        <StatusBar c={overall} label={`${projectName} overall`} />
        <Legend />
      </div>

      {/* Status check + slip (2026-10-16) */}
      <StatusCheck check={check} today={today} teamName={teamName} canEdit={canEdit} onFix={onFix} onFixAll={onFixAll} onJump={onJump} />
      <SlipPanel slip={slip} loading={slipLoading} error={slipError} canReset={canResetBaseline} unsaved={unsaved} onReset={onResetBaseline} onJump={onJump} />

      {/* 2. Modules */}
      <h3 className={styles.subTitle}>Modules</h3>
      <details className={styles.details}>
        <summary>How health works</summary>
        <ul className={styles.healthRules}>
          {HEALTH_RULES.map(([name, rule]) => (
            <li key={name}>
              <Badge tone={HEALTH_TONE[name]}>{name}</Badge> {rule}.
            </li>
          ))}
        </ul>
        <p className={styles.muted}>The first rule that fits wins. Overdue means To Do with an end date before today ({formatDate(today)}, team time zone).</p>
      </details>
      <div className={styles.cardGrid}>
        {modules.map((m) => (
          <article key={m.key} className={styles.sumCard} aria-label={`Module ${m.name}`}>
            <div className={styles.cardHead}>
              <button type="button" className={styles.cardTitle} onClick={() => filter({ module: m.key })}>
                {m.name}
              </button>
              <Badge tone={HEALTH_TONE[m.health]}>{m.health}</Badge>
            </div>
            <StatusBar c={m} label={m.name} />
            <div className={styles.cardLine}>
              {m.completed} of {m.total} completed · {dateRange(m.start, m.end)}
            </div>
            <div className={styles.numRow}>
              <FilterNumber value={m.overdue} label="overdue" tone="error" onClick={() => filter({ module: m.key, status: 'overdue' })} />
              <FilterNumber value={m.delayed} label="delayed" tone="error" onClick={() => filter({ module: m.key, status: 'Delayed' })} />
              <FilterNumber value={m.inProgress} label="in progress" onClick={() => filter({ module: m.key, status: 'In Progress' })} />
            </div>
            <div className={`${styles.cardLine} ${m.status.kind === 'late' ? styles.issueWarning : ''}`}>
              {m.status.row ? (
                <button type="button" className={styles.linkButton} onClick={() => onJump(m.status.row.key)}>
                  {m.status.text}
                </button>
              ) : (
                m.status.text
              )}
            </div>
          </article>
        ))}
      </div>

      {/* 3. Teams */}
      <h3 className={styles.subTitle}>Teams</h3>
      <div className={styles.cardGrid}>
        {teams.map((t) => (
          <article key={t.key} className={styles.sumCard} aria-label={`Team ${t.name}`}>
            <div className={styles.cardHead}>
              <button type="button" className={styles.cardTitle} onClick={() => filter({ team: t.key })}>
                {t.name}
              </button>
              <span className={styles.muted}>{plural(t.total, 'phase')}</span>
            </div>
            <StatusBar c={t} label={t.name} />
            <div className={styles.numRow}>
              <FilterNumber value={t.completed} label="completed" onClick={() => filter({ team: t.key, status: 'Completed' })} />
              <FilterNumber value={t.inProgress} label="in progress" onClick={() => filter({ team: t.key, status: 'In Progress' })} />
              <FilterNumber value={t.toDo} label="to do" onClick={() => filter({ team: t.key, status: 'To Do' })} />
              <FilterNumber value={t.delayed} label="delayed" tone="error" onClick={() => filter({ team: t.key, status: 'Delayed' })} />
              <FilterNumber value={t.overdue} label="overdue" tone="error" onClick={() => filter({ team: t.key, status: 'overdue' })} />
            </div>
            <div className={styles.cardLine}>
              <button type="button" className={styles.linkButton} onClick={() => filter({ team: t.key, status: 'running' })}>
                {t.runningNow} running now
              </button>
              {t.runningNowToDo > 0 && ` (${t.runningNowToDo} still To Do)`} ·{' '}
              <button type="button" className={styles.linkButton} onClick={() => filter({ team: t.key, status: 'soon' })}>
                {t.startingSoon} starting in the next {SOON_DAYS} days
              </button>
            </div>
            <div className={styles.cardLine}>
              {t.oldestOverdue ? (
                <>
                  Oldest overdue:{' '}
                  <button type="button" className={styles.linkButton} onClick={() => onJump(t.oldestOverdue.row.key)}>
                    {t.oldestOverdue.row.module} – {t.oldestOverdue.row.phase}
                  </button>
                  , {plural(t.oldestOverdue.daysLate, 'day')} late
                </>
              ) : (
                'Nothing overdue'
              )}
            </div>
          </article>
        ))}
      </div>

      {/* 4. Module by Team */}
      <h3 className={styles.subTitle}>Module by team (overdue / total)</h3>
      <div className={styles.tableWrap}>
        <table className={`${styles.table} ${styles.gridTable}`}>
          <caption className="sr-only">Overdue phases out of all phases, for each module and team. Select a cell to show those phases.</caption>
          <thead>
            <tr>
              <th scope="col">Module</th>
              {teams.map((t) => (
                <th key={t.key} scope="col">
                  {t.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.map((g) => (
              <tr key={g.module.key}>
                <th scope="row">{g.module.name}</th>
                {g.cells.map((c) => (
                  <td key={c.team.key} className={c.overdue >= 3 ? styles.heatHigh : c.overdue > 0 ? styles.heatLow : ''}>
                    {c.total > 0 ? (
                      <button
                        type="button"
                        className={styles.gridCell}
                        onClick={() => filter({ module: g.module.key, team: c.team.key })}
                        aria-label={`${g.module.name}, ${c.team.name}: ${c.overdue} overdue of ${c.total}. Show these phases`}
                      >
                        {c.overdue} / {c.total}
                      </button>
                    ) : (
                      <span className={styles.placeholder}>—</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 5. Mini timeline */}
      <h3 className={styles.subTitle}>Timeline</h3>
      <MiniTimeline summary={summary} onFilter={onFilter} />

      {/* 6. Needs attention */}
      <h3 className={styles.subTitle}>Needs attention ({attention.length} overdue)</h3>
      {attention.length === 0 ? (
        <p className={styles.muted}>Nothing is overdue.</p>
      ) : (
        <ol className={styles.attention}>
          {attentionShown.map((a) => (
            <li key={a.row.key}>
              <span className={styles.chipOverdue}>{plural(a.daysLate, 'day')} late</span>
              <span>
                <strong>{a.row.module}</strong> – {a.row.phase}
                {a.team ? ` · ${a.team}` : ''} · ended {formatDate(a.row.endDate)}
              </span>
              <button type="button" className={styles.linkButton} onClick={() => onJump(a.row.key)} aria-label={`Go to ${a.row.module} – ${a.row.phase} in the table`}>
                Go to row <ArrowRight size={12} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ol>
      )}
      {attention.length > ATTENTION_PREVIEW && (
        <button type="button" className={styles.linkButton} onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>
          {showAll ? `Show the top ${ATTENTION_PREVIEW} only` : `Show all ${attention.length}`}
        </button>
      )}
      {runningLate.length > 0 && (
        <p className={`${styles.notice} ${styles.noticeInfo}`}>
          <AlertTriangle size={14} aria-hidden="true" /> Running late (In Progress, past end date, not counted as overdue):{' '}
          {runningLate.map((r, i) => (
            <span key={r.key}>
              {i > 0 && '; '}
              <button type="button" className={styles.linkButton} onClick={() => onJump(r.key)}>
                {r.module} – {r.phase}
              </button>{' '}
              (ended {formatDate(r.endDate)})
            </span>
          ))}
        </p>
      )}

      {/* 8. Totals check */}
      <p className={`${styles.totals} ${totals.ok ? '' : styles.issueError}`} role="status">
        {totals.ok ? <CheckCircle2 size={14} aria-hidden="true" /> : <AlertTriangle size={14} aria-hidden="true" />}{' '}
        {totals.ok ? 'Totals match' : 'Totals do not match'}: phases {totals.modules} by module = {totals.teams} by team = {totals.overall} overall; overdue{' '}
        {totals.modulesOverdue} = {totals.teamsOverdue} = {totals.overdue}.
      </p>
    </section>
  );
}
