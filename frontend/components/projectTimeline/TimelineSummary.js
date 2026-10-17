import { useState } from 'react';
import { CheckCircle2, ClipboardCopy, AlertTriangle, ArrowRight, Boxes, CalendarRange, Flame, Gauge, LayoutGrid, Telescope, Users } from 'lucide-react';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import StatusCheck from './StatusCheck';
import SlipPanel from './SlipPanel';
import ForecastPanel from './ForecastPanel';
import ChangesPanel from './ChangesPanel';
import styles from '../../styles/projectTimeline.module.css';
import ov from '../../styles/timelineOverview.module.css';
import { ProgressRing } from './TimelineHero';
import { formatDate } from '../../lib/formatDate';
import { dateRange } from '../../lib/projectTimeline';
import { ATTENTION_PREVIEW, EMPTY_FILTERS, HEALTH_RULES, SOON_DAYS, daysBetween, formatSlip } from '../../lib/projectTimelineSummary';

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

const HEALTH_ACCENT = { Done: ov.accentSuccess, 'On track': ov.accentInfo, 'At risk': ov.accentWarning, Late: ov.accentError };

function Card({ span, title, icon: Icon, actions, children, id, label }) {
  return (
    <section id={id} className={`${ov.card} ${ov[`span${span}`]}`} aria-label={label || (typeof title === 'string' ? title : undefined)}>
      {title && (
        <div className={ov.cardHeader}>
          <h3 className={ov.cardTitle}>
            {Icon && <Icon size={18} aria-hidden="true" />}
            {title}
          </h3>
          {actions && <div className={ov.cardActions}>{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

// Planned vs likely finish, on one scale from the project's first date.
function FinishCompare({ start, plannedEnd, likelyEnd, today }) {
  if (!start || !plannedEnd || !likelyEnd) return null;
  const last = likelyEnd > plannedEnd ? likelyEnd : plannedEnd;
  const total = Math.max(1, daysBetween(start, last) + 1);
  const pct = (iso) => `${Math.max(0, Math.min(100, ((daysBetween(start, iso) + 1) / total) * 100))}%`;
  const late = likelyEnd > plannedEnd;
  const todayIn = today >= start && today <= last;
  return (
    <div className={ov.compare} role="img" aria-label={`Planned finish ${formatDate(plannedEnd)}, likely finish ${formatDate(likelyEnd)}`}>
      {[
        ['Planned', plannedEnd, ov.comparePlan],
        ['Likely', likelyEnd, late ? ov.compareLikely : ov.compareLikelyOk],
      ].map(([label, end, cls]) => (
        <div key={label} className={ov.compareRow} aria-hidden="true">
          <span>{label}</span>
          <span className={ov.compareTrack}>
            <span className={`${ov.compareFill} ${cls}`} style={{ width: pct(end) }} />
            {todayIn && <span className={ov.compareToday} style={{ left: pct(today) }} title="Today" />}
          </span>
          <span className={ov.compareDate}>{formatDate(end)}</span>
        </div>
      ))}
    </div>
  );
}

function SlipBars({ modules }) {
  const moved = modules.filter((m) => m.slip != null);
  if (!moved.length) return null;
  const max = Math.max(1, ...moved.map((m) => Math.abs(m.slip)));
  return (
    <div className={ov.slipBars} role="img" aria-label={`Slip by module: ${moved.map((m) => `${m.name} ${formatSlip(m.slip)}`).join(', ')}`}>
      {moved.map((m) => (
        <div key={m.key} className={ov.slipBarRow} aria-hidden="true">
          <span className={ov.slipBarName} title={m.name}>
            {m.name}
          </span>
          <span className={ov.slipBarTrack}>
            {m.slip > 0 && <span className={ov.slipBarLater} style={{ width: `${(m.slip / max) * 50}%` }} />}
            {m.slip < 0 && <span className={ov.slipBarEarlier} style={{ width: `${(-m.slip / max) * 50}%` }} />}
          </span>
          <span className={`${ov.slipBarValue} ${m.slip > 0 ? ov.toneError : m.slip < 0 ? ov.toneSuccess : ''}`}>{formatSlip(m.slip)}</span>
        </div>
      ))}
    </div>
  );
}

const STATUS_FILTERS = [
  ['completed', 'Completed', 'Completed', 'var(--ds-color-success)'],
  ['inProgress', 'In Progress', 'In Progress', 'var(--ds-color-info)'],
  ['toDo', 'To Do', 'To Do', 'var(--ds-text-secondary)'],
  ['delayed', 'Delayed', 'Delayed', 'var(--ds-color-error)'],
  ['onHold', 'On Hold', 'On Hold', 'var(--ds-color-warning)'],
  ['overdue', 'Overdue', 'overdue', 'var(--ds-color-error-dark)'],
];

// Overview (2026-10-17 redesign of the Summary): a dashboard grid of
// cards. Read-only - every card and number sets the Gantt/Table filters
// (onFilter) or jumps to a row (onJump); nothing here edits, except the
// Status check fixes, which change the page only (Save changes keeps them).
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
  forecast,
  forecastRowById,
  changes,
  changesLoading,
  changesError,
  changesDays,
  onChangesDays,
  rowKeyById,
}) {
  const [showAll, setShowAll] = useState(false);
  const { overall, modules, teams, grid, attention, runningLate, totals, today } = summary;
  const filter = (patch) => onFilter({ ...EMPTY_FILTERS, ...patch });
  const attentionShown = showAll ? attention : attention.slice(0, ATTENTION_PREVIEW);
  const late = forecast?.slipDays > 0;

  return (
    <section className={ov.overview} aria-labelledby="tl-summary-heading">
      <h2 id="tl-summary-heading" className="sr-only">
        Overview of {projectName}
      </h2>

      {/* Progress */}
      <Card
        span={5}
        title="Progress"
        icon={Gauge}
        actions={
          <Button size="sm" variant="secondary" leftIcon={ClipboardCopy} onClick={onCopy} disabled={unsaved} title={unsaved ? 'Save or discard your changes first' : undefined}>
            Copy summary
          </Button>
        }
      >
        {unsaved && <p className={styles.muted}>Copy summary is available again once your changes are saved or discarded.</p>}
        <div className={ov.progressHero}>
          <ProgressRing pct={overall.pct} size={128} stroke={12} label={`${overall.pct}% of phases completed`} />
          <div className={ov.progressFacts}>
            <p className={ov.bigLine}>
              <strong>{overall.completed}</strong> of {plural(overall.total, 'phase')} completed
            </p>
            <StatusBar c={overall} label={`${projectName} overall`} />
            <p className={styles.muted} style={{ margin: 0 }}>
              {overall.start && overall.end ? dateRange(overall.start, overall.end) : 'No dates yet'}
            </p>
          </div>
        </div>
        <div className={ov.statusChips}>
          {STATUS_FILTERS.map(([k, label, value, color]) => (
            <button key={k} type="button" className={ov.statusChip} onClick={() => filter({ status: value })} aria-label={`${label}: ${overall[k]}. Show these phases`}>
              <span className={ov.statusChipValue}>{overall[k]}</span>
              <span className={ov.statusChipLabel}>
                <span className={ov.dot} style={{ background: color }} aria-hidden="true" />
                {label}
              </span>
            </button>
          ))}
        </div>
      </Card>

      {/* Forecast */}
      <Card span={7} title="Forecast" icon={Telescope}>
        {forecast?.likelyEnd ? (
          <>
            <div className={ov.forecastBig}>
              <span className={ov.forecastDate}>{formatDate(forecast.likelyEnd)}</span>
              {late ? <Badge tone="error">{plural(forecast.slipDays, 'day')} after plan</Badge> : <Badge tone="success">On plan</Badge>}
              <span className={styles.muted}>likely finish · planned {formatDate(forecast.plannedEnd)}</span>
            </div>
            <FinishCompare start={overall.start} plannedEnd={forecast.plannedEnd} likelyEnd={forecast.likelyEnd} today={today} />
            <ForecastPanel forecast={forecast} rowById={forecastRowById} onJump={onJump} embedded />
          </>
        ) : (
          <p className={styles.muted}>Add start and end dates to see a forecast.</p>
        )}
      </Card>

      {/* Modules */}
      <Card span={12} title="Modules" icon={Boxes}>
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
        <div className={ov.moduleGrid}>
          {modules.map((m) => (
            <article key={m.key} className={`${ov.moduleCard} ${HEALTH_ACCENT[m.health] || ''}`} aria-label={`Module ${m.name}`}>
              <div className={ov.moduleCardHead}>
                <ProgressRing pct={m.pct} size={52} stroke={5} label={`${m.name}: ${m.pct}% completed`} />
                <div className={ov.moduleCardName}>
                  <button type="button" className={ov.moduleCardTitle} onClick={() => filter({ module: m.key })} title={m.name}>
                    {m.name}
                  </button>
                  <span className={ov.moduleDates}>
                    {m.completed} of {m.total} completed · {dateRange(m.start, m.end)}
                  </span>
                </div>
                <Badge tone={HEALTH_TONE[m.health]}>{m.health}</Badge>
              </div>
              <StatusBar c={m} label={m.name} />
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
      </Card>

      {/* Needs attention: status check + overdue + running late */}
      <Card span={6} id="tl-status-check" title="Needs attention" icon={Flame}>
        <StatusCheck check={check} today={today} teamName={teamName} canEdit={canEdit} onFix={onFix} onFixAll={onFixAll} onJump={onJump} />
        <h4 className={styles.subTitle}>Overdue ({attention.length})</h4>
        {attention.length === 0 ? (
          <p className={styles.totals}>
            <CheckCircle2 size={14} aria-hidden="true" /> Nothing is overdue.
          </p>
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
      </Card>

      {/* What changed */}
      <Card span={6} label="What changed">
        <ChangesPanel data={changes} loading={changesLoading} error={changesError} days={changesDays} onDays={onChangesDays} rowKeyById={rowKeyById} onJump={onJump} />
      </Card>

      {/* Slip */}
      <Card span={6} label="Slip since plan">
        <SlipPanel slip={slip} loading={slipLoading} error={slipError} canReset={canResetBaseline} unsaved={unsaved} onReset={onResetBaseline} onJump={onJump}>
          {slip?.anyMoved && <SlipBars modules={slip.modules} />}
        </SlipPanel>
      </Card>

      {/* Module by Team */}
      <Card span={6} title="Module by team" icon={LayoutGrid}>
        <p className={styles.muted} style={{ margin: 0 }}>
          Overdue / total phases. Green: nothing overdue; amber: some; red: 3 or more.
        </p>
        <div className={styles.tableWrap} style={{ border: 0 }}>
          <table className={ov.heat}>
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
                    <td key={c.team.key} className={c.total === 0 ? '' : c.overdue >= 3 ? ov.heat2 : c.overdue > 0 ? ov.heat1 : ov.heat0}>
                      {c.total > 0 ? (
                        <button
                          type="button"
                          className={ov.heatCell}
                          onClick={() => filter({ module: g.module.key, team: c.team.key })}
                          aria-label={`${g.module.name}, ${c.team.name}: ${c.overdue} overdue of ${c.total}. Show these phases`}
                        >
                          {c.overdue} / {c.total}
                        </button>
                      ) : (
                        <span className={ov.heatEmpty}>—</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Teams */}
      <Card span={12} title="Teams" icon={Users}>
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
      </Card>

      {/* Mini timeline */}
      <Card span={12} title="Timeline at a glance" icon={CalendarRange}>
        <Legend />
        <MiniTimeline summary={summary} onFilter={onFilter} />
      </Card>

      {/* Totals check */}
      <p className={`${styles.totals} ${ov.footnote} ${totals.ok ? '' : styles.issueError}`} role="status">
        {totals.ok ? <CheckCircle2 size={14} aria-hidden="true" /> : <AlertTriangle size={14} aria-hidden="true" />}{' '}
        {totals.ok ? 'Totals match' : 'Totals do not match'}: phases {totals.modules} by module = {totals.teams} by team = {totals.overall} overall; overdue{' '}
        {totals.modulesOverdue} = {totals.teamsOverdue} = {totals.overdue}.
      </p>
    </section>
  );
}
