import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play, X } from 'lucide-react';
import Badge from '../ui/Badge';
import styles from '../../styles/timelinePresent.module.css';
import ov from '../../styles/timelineOverview.module.css';
import { ProgressRing } from './TimelineHero';
import { RiskBadge, TeamLoad } from './RiskCards';
import { HEALTH_TONE } from './TimelineSummary';
import { formatDate } from '../../lib/formatDate';
import { addDaysIso, dateRange, isOverdue } from '../../lib/projectTimeline';
import { daysBetween, formatSlip } from '../../lib/projectTimelineSummary';

const AUTO_MS = 15000;
const SOON = 14;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const STATUS_COLOR = {
  'To Do': 'var(--ds-text-secondary)',
  'In Progress': 'var(--ds-color-info)',
  Completed: 'var(--ds-color-success)',
  Delayed: 'var(--ds-color-error)',
  'On Hold': 'var(--ds-color-warning)',
};

function Big({ label, value, sub, tone }) {
  return (
    <div className={styles.big}>
      <span className={styles.bigLabel}>{label}</span>
      <span className={`${styles.bigValue} ${tone || ''}`}>{value}</span>
      {sub && <span className={styles.bigSub}>{sub}</span>}
    </div>
  );
}

// A large, read-only timeline of one module's phases for the slides.
function ModuleTimeline({ rows, today, teamName }) {
  const dated = rows.filter((r) => r.startDate || r.endDate);
  if (!dated.length) return <p className={styles.note}>No dates in this module yet.</p>;
  const starts = dated.map((r) => r.startDate || r.endDate).sort();
  const ends = dated.map((r) => r.endDate || r.startDate).sort();
  const first = starts[0] < today ? starts[0] : today;
  const last = ends[ends.length - 1] > today ? ends[ends.length - 1] : today;
  const total = Math.max(1, daysBetween(first, last) + 1);
  const pos = (iso) => (daysBetween(first, iso) / total) * 100;
  const months = [];
  for (let d = `${first.slice(0, 7)}-01`; d <= last; d = addDaysIso(`${d.slice(0, 7)}-28`, 4).slice(0, 7) + '-01') if (d >= first) months.push(d);
  return (
    <div className={styles.mt}>
      <div className={styles.mtRow} aria-hidden="true">
        <span />
        <span className={styles.mtAxis}>
          {months.map((m) => (
            <span key={m} className={styles.mtMonth} style={{ left: `${pos(m)}%` }}>
              {new Date(`${m}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })}
            </span>
          ))}
          <span className={styles.mtTodayLabel} style={{ left: `${pos(today)}%` }}>
            Today
          </span>
        </span>
      </div>
      {rows.map((r) => {
        const s = r.startDate || r.endDate;
        const e = r.endDate || r.startDate;
        return (
          <div key={r.key} className={styles.mtRow}>
            <span className={styles.mtName}>
              <span className={styles.mtPhase}>{r.phase || 'New phase'}</span>
              <span className={styles.mtMeta}>
                {r.status}
                {isOverdue(r, today) ? ' · overdue' : ''} · {r.teamId != null ? teamName.get(r.teamId) || '' : 'No team'}
              </span>
            </span>
            <span className={styles.mtTrack}>
              {s ? (
                <span
                  className={`${styles.mtBar} ${isOverdue(r, today) ? styles.mtOverdue : ''}`}
                  style={{ left: `${pos(s)}%`, width: `${Math.max(0.8, ((daysBetween(s, e) + 1) / total) * 100)}%`, background: STATUS_COLOR[r.status] }}
                  title={`${r.phase}: ${dateRange(r.startDate, r.endDate)}`}
                />
              ) : (
                <span className={styles.note}>No dates</span>
              )}
              <span className={styles.mtToday} style={{ left: `${pos(today)}%` }} />
            </span>
            <span className={styles.mtDates}>{dateRange(r.startDate, r.endDate)}</span>
          </div>
        );
      })}
    </div>
  );
}

// Presentation mode (2026-10-17): the plan as a slideshow for steering
// meetings - full screen, big type, read-only. Slides come from the same
// page data as the Overview, unsaved edits included (the title slide says
// so). Arrow keys / Space / PageUp/PageDown move, Home/End jump, Esc or
// leaving browser full screen closes.
export default function PresentationMode({ projectName, today, timeZone, summary, forecast, forecastRowById, slip, critical, risk, load, changes, rows, teamName, unsaved, onClose }) {
  const [index, setIndex] = useState(0);
  const [auto, setAuto] = useState(false);
  const rootRef = useRef(null);
  const backTo = useRef(null);

  const slides = useMemo(() => {
    const o = summary.overall;
    const late = forecast?.slipDays > 0;
    const list = [];
    list.push({
      key: 'title',
      title: projectName,
      render: () => (
        <div className={styles.titleSlide}>
          <p className={styles.eyebrow}>Project status · {formatDate(today)}</p>
          <h1 className={styles.titleBig}>{projectName}</h1>
          {unsaved && <Badge tone="warning">Includes unsaved changes</Badge>}
          <div className={styles.titleRow}>
            <ProgressRing pct={o.pct} size={200} stroke={18} label={`${o.pct}% of phases completed`} />
            <div className={styles.bigGrid}>
              <Big label="Completed" value={`${o.completed} of ${o.total}`} sub="phases" />
              <Big
                label="Likely finish"
                value={forecast?.likelyEnd ? formatDate(forecast.likelyEnd) : '—'}
                sub={forecast?.likelyEnd ? (late ? `${plural(forecast.slipDays, 'day')} after plan` : 'on plan') : ''}
                tone={late ? ov.toneError : ov.toneSuccess}
              />
              <Big label="Slip since plan" value={slip ? formatSlip(slip.overall?.slip ?? 0) : '—'} sub={slip ? `${plural(slip.overall?.later || 0, 'phase')} later` : ''} tone={slip?.overall?.slip > 0 ? ov.toneError : ''} />
              <Big label="Overdue" value={o.overdue} sub={`${o.delayed} delayed`} tone={o.overdue ? ov.toneError : ov.toneSuccess} />
            </div>
          </div>
        </div>
      ),
    });
    if (forecast?.likelyEnd) {
      const drivers = forecast.drivers.map((id) => forecastRowById.get(id)).filter(Boolean);
      const lateRows = forecast.rows
        .filter((f) => !f.done && f.slipDays > 0 && forecastRowById.has(f.id))
        .sort((a, b) => b.slipDays - a.slipDays)
        .slice(0, 5);
      list.push({
        key: 'forecast',
        title: 'Forecast',
        render: () => (
          <>
            <div className={styles.forecastHead}>
              <span className={styles.bigValue}>{formatDate(forecast.likelyEnd)}</span>
              <Badge tone={late ? 'error' : 'success'}>{late ? `${plural(forecast.slipDays, 'day')} after plan` : 'On plan'}</Badge>
              <span className={styles.bigSub}>likely finish · planned {formatDate(forecast.plannedEnd)}</span>
            </div>
            {late && drivers.length > 0 && (
              <p className={styles.lead}>
                What sets it: {drivers.map((r) => `${r.phase} (${r.module})`).join(', then ')}.
              </p>
            )}
            {lateRows.length > 0 && (
              <ol className={styles.list}>
                {lateRows.map((f) => {
                  const r = forecastRowById.get(f.id);
                  return (
                    <li key={f.id}>
                      <span className={styles.slipChip}>{formatSlip(f.slipDays)}</span>
                      <span>
                        <strong>{r.module}</strong> – {r.phase} · planned {formatDate(f.plannedEnd)}, likely {formatDate(f.end)}
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
            {critical?.projectEnd && <p className={styles.note}>Critical path: {plural(critical.chain.length, 'phase')}, ending {formatDate(critical.projectEnd)}.</p>}
          </>
        ),
      });
    }
    list.push({
      key: 'modules',
      title: 'Modules',
      render: () => (
        <div className={styles.moduleGrid}>
          {summary.modules.map((m) => (
            <div key={m.key} className={styles.moduleCard}>
              <ProgressRing pct={m.pct} size={96} stroke={9} label={`${m.name}: ${m.pct}% completed`} />
              <div className={styles.moduleBody}>
                <div className={styles.moduleName}>{m.name}</div>
                <Badge tone={HEALTH_TONE[m.health]}>{m.health}</Badge>
                <div className={styles.note}>
                  {m.completed} of {m.total} completed · {m.overdue} overdue · {dateRange(m.start, m.end)}
                </div>
                <div className={styles.note}>{m.status.text}</div>
              </div>
            </div>
          ))}
        </div>
      ),
    });
    for (const m of summary.modules) {
      list.push({ key: `m-${m.key}`, title: `${m.name} timeline`, render: () => <ModuleTimeline rows={m.rows} today={today} teamName={teamName} /> });
    }
    list.push({
      key: 'risks',
      title: 'Top risks',
      render: () =>
        risk.top.length ? (
          <ol className={styles.list}>
            {risk.top.slice(0, 5).map((t) => (
              <li key={t.row.key}>
                <RiskBadge risk={t} />
                <span>
                  <strong>{t.row.module}</strong> – {t.row.phase}
                  <span className={styles.why}>{t.reasons.map((x) => x.text).join(' · ')}</span>
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className={styles.lead}>No phase carries any risk right now.</p>
        ),
    });
    if (load?.teams.length) list.push({ key: 'load', title: 'Team load', render: () => <TeamLoad load={load} readOnly onFilter={() => {}} /> });
    const horizon = addDaysIso(today, SOON);
    const starting = rows.filter((r) => r.status !== 'Completed' && r.startDate && r.startDate > today && r.startDate <= horizon).sort((a, b) => a.startDate.localeCompare(b.startDate));
    const ending = rows.filter((r) => r.status !== 'Completed' && r.endDate && r.endDate >= today && r.endDate <= horizon).sort((a, b) => a.endDate.localeCompare(b.endDate));
    list.push({
      key: 'soon',
      title: `Coming up: next ${SOON} days`,
      render: () => (
        <div className={styles.twoCol}>
          <div>
            <h3 className={styles.colTitle}>Starting ({starting.length})</h3>
            {starting.length ? (
              <ul className={styles.list}>
                {starting.slice(0, 8).map((r) => (
                  <li key={r.key}>
                    <span className={styles.dateChip}>{formatDate(r.startDate)}</span>
                    <span>
                      <strong>{r.module}</strong> – {r.phase}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.note}>Nothing starts in the next {SOON} days.</p>
            )}
          </div>
          <div>
            <h3 className={styles.colTitle}>Due ({ending.length})</h3>
            {ending.length ? (
              <ul className={styles.list}>
                {ending.slice(0, 8).map((r) => (
                  <li key={r.key}>
                    <span className={styles.dateChip}>{formatDate(r.endDate)}</span>
                    <span>
                      <strong>{r.module}</strong> – {r.phase} <span className={styles.why}>{r.status}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.note}>Nothing is due in the next {SOON} days.</p>
            )}
          </div>
        </div>
      ),
    });
    if (changes) {
      const t = changes.totals;
      list.push({
        key: 'changes',
        title: `What changed: last ${changes.days} days`,
        render: () => (
          <>
            <div className={styles.bigGrid}>
              <Big label="End dates later" value={t.endLater} tone={t.endLater ? ov.toneError : ''} />
              <Big label="End dates earlier" value={t.endEarlier} tone={t.endEarlier ? ov.toneSuccess : ''} />
              <Big label="Status changes" value={t.statusChanged} sub={t.completed ? `${t.completed} completed` : ''} />
              <Big label="Added / removed" value={`${t.added} / ${t.removed}`} />
            </div>
            {changes.phases.length > 0 ? (
              <ul className={styles.list}>
                {changes.phases.slice(0, 6).map((p) => (
                  <li key={p.rowId}>
                    <span className={styles.slipChip}>{p.kind === 'changed' ? (p.endShiftDays ? formatSlip(p.endShiftDays) : 'Edited') : p.kind === 'added' ? 'Added' : 'Removed'}</span>
                    <span>
                      <strong>{p.module}</strong> – {p.phase}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.lead}>No changes to the plan in this period.</p>
            )}
          </>
        ),
      });
    }
    return list;
  }, [projectName, today, summary, forecast, forecastRowById, slip, critical, risk, load, changes, rows, teamName, unsaved]);

  const count = slides.length;
  const go = useCallback((i) => setIndex(Math.max(0, Math.min(count - 1, i))), [count]);

  // Open: remember focus, go browser full screen, focus the deck. Close:
  // leave full screen, give focus back.
  useEffect(() => {
    backTo.current = document.activeElement;
    rootRef.current?.focus();
    const el = document.documentElement;
    if (el.requestFullscreen && !document.fullscreenElement) el.requestFullscreen().catch(() => {});
    const onFs = () => {
      if (!document.fullscreenElement) onClose();
    };
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      document.removeEventListener('fullscreenchange', onFs);
      if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
      backTo.current?.focus?.();
    };
  }, [onClose]);

  useEffect(() => {
    const onKey = (e) => {
      if (['ArrowRight', 'PageDown', ' '].includes(e.key)) {
        e.preventDefault();
        go(index + 1);
      } else if (['ArrowLeft', 'PageUp'].includes(e.key)) {
        e.preventDefault();
        go(index - 1);
      } else if (e.key === 'Home') go(0);
      else if (e.key === 'End') go(count - 1);
      else if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, count, go, onClose]);

  // Auto-advance; stops on the last slide.
  useEffect(() => {
    if (!auto) return undefined;
    if (index >= count - 1) {
      setAuto(false);
      return undefined;
    }
    const t = setTimeout(() => go(index + 1), AUTO_MS);
    return () => clearTimeout(t);
  }, [auto, index, count, go]);

  const slide = slides[Math.min(index, count - 1)];

  return (
    <div ref={rootRef} className={styles.deck} role="dialog" aria-modal="true" aria-label={`Presentation: ${projectName}`} tabIndex={-1}>
      <header className={styles.top}>
        <span className={styles.brand}>
          {projectName} · Project Timeline · {formatDate(today)} ({timeZone})
        </span>
        <button type="button" className={styles.iconButton} onClick={onClose} aria-label="Close presentation (Esc)">
          <X size={20} aria-hidden="true" />
        </button>
      </header>

      <section key={slide.key} className={styles.slide} aria-roledescription="slide" aria-label={`${index + 1} of ${count}: ${slide.title}`}>
        {slide.key !== 'title' && <h2 className={styles.slideTitle}>{slide.title}</h2>}
        <div className={styles.slideBody}>{slide.render()}</div>
      </section>
      <p className="sr-only" aria-live="polite">
        Slide {index + 1} of {count}: {slide.title}
      </p>

      <footer className={styles.bottom}>
        <button type="button" className={styles.iconButton} onClick={() => go(index - 1)} disabled={index === 0} aria-label="Previous slide">
          <ChevronLeft size={22} aria-hidden="true" />
        </button>
        <div className={styles.dots} role="group" aria-label="Slides">
          {slides.map((s, i) => (
            <button key={s.key} type="button" className={`${styles.dot} ${i === index ? styles.dotOn : ''}`} onClick={() => go(i)} aria-label={`Slide ${i + 1}: ${s.title}`} aria-current={i === index ? 'step' : undefined} />
          ))}
        </div>
        <span className={styles.counter}>
          {index + 1} / {count}
        </span>
        <button type="button" className={styles.iconButton} onClick={() => go(index + 1)} disabled={index === count - 1} aria-label="Next slide">
          <ChevronRight size={22} aria-hidden="true" />
        </button>
        <button type="button" className={`${styles.autoButton} ${auto ? styles.autoOn : ''}`} onClick={() => setAuto((a) => !a)} aria-pressed={auto}>
          {auto ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />} Auto {AUTO_MS / 1000}s
        </button>
      </footer>
    </div>
  );
}
