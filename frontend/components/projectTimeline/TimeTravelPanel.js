import { useEffect, useRef, useState } from 'react';
import { ChevronsLeft, ChevronsRight, History, Pause, Play, SkipBack, SkipForward, X } from 'lucide-react';
import Button from '../ui/Button';
import styles from '../../styles/timelineOverview.module.css';
import { formatDate, formatDateTime } from '../../lib/formatDate';
import { formatSlip, daysBetween } from '../../lib/projectTimelineSummary';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const FIELD = { module: 'module', phase: 'phase', team: 'team', status: 'status', startDate: 'start', endDate: 'end', order: 'order' };
const show = (f, v) => (v == null || v === '' ? 'none' : f === 'startDate' || f === 'endDate' ? formatDate(v) : v);

function eventText(e, nameOf) {
  const name = nameOf(e);
  if (e.kind === 'created') return `${name} added`;
  if (e.kind === 'deleted') return `${name} removed`;
  const parts = Object.entries(e.changes || {})
    .filter(([f]) => f !== 'order')
    .map(([f, c]) => `${FIELD[f] || f} ${show(f, c.old)} to ${show(f, c.new)}`);
  return parts.length ? `${name}: ${parts.join(', ')}` : `${name} reordered`;
}

function Then({ label, then, now, kind }) {
  let delta = null;
  if (kind === 'date' && then && now && then !== now) delta = daysBetween(then, now);
  if (kind === 'count' && then !== now) delta = now - then;
  return (
    <div className={styles.wiMetric}>
      <span className={styles.kpiLabel}>{label}</span>
      <span className={styles.wiWhat}>{kind === 'date' ? (then ? formatDate(then) : '—') : then}</span>
      <span className={styles.kpiSub}>
        {delta == null ? 'same today' : kind === 'date' ? `today ${formatSlip(delta)} (${formatDate(now)})` : `today ${now} (${delta > 0 ? '+' : ''}${delta})`}
      </span>
    </div>
  );
}

// Time travel (2026-10-17): pick a past day and the Gantt shows the saved
// plan as it stood at the end of that day (team time zone), rebuilt from
// the change history, with today's plan as a grey outline. Read-only.
export default function TimeTravelPanel({ days, changeDays, day, onDay, events, loading, error, then, now, nameOf, onExit }) {
  const [playing, setPlaying] = useState(false);
  const timer = useRef(null);
  const idx = Math.max(0, days.indexOf(day));
  const nextChange = changeDays.find((d) => d > day);
  const prevChange = [...changeDays].reverse().find((d) => d < day);
  const todays = events.filter((e) => e.day === day);

  // Play: step through the days that have changes, then stop on today.
  useEffect(() => {
    if (!playing) return undefined;
    timer.current = setTimeout(() => {
      const next = changeDays.find((d) => d > day) || days[days.length - 1];
      onDay(next);
      if (next === days[days.length - 1]) setPlaying(false);
    }, 900);
    return () => clearTimeout(timer.current);
  }, [playing, day, changeDays, days, onDay]);

  const step = (n) => onDay(days[Math.max(0, Math.min(days.length - 1, idx + n))]);

  return (
    <section className={`${styles.whatIf} ${styles.timeTravel}`} aria-labelledby="tl-tt-title">
      <div className={styles.wiHead}>
        <h2 id="tl-tt-title" className={styles.cardTitle}>
          <History size={18} aria-hidden="true" /> Time travel
        </h2>
        <span className={styles.wiNote}>The saved plan as it stood at the end of the day you pick, rebuilt from the change history. Today’s plan shows as a grey outline. Read-only.</span>
        <div className={styles.cardActions}>
          <Button size="sm" variant="secondary" leftIcon={X} onClick={onExit}>
            Back to today
          </Button>
        </div>
      </div>

      {error && <p className={styles.toneError}>History could not be loaded: {error}</p>}
      {loading && <p className={styles.wiNote}>Loading the change history…</p>}

      {!loading && !error && (
        <>
          <div className={styles.ttControls}>
            <Button size="sm" variant="secondary" onClick={() => onDay(days[0])} disabled={idx === 0} aria-label="First day">
              <SkipBack size={14} aria-hidden="true" />
            </Button>
            <Button size="sm" variant="secondary" onClick={() => prevChange && onDay(prevChange)} disabled={!prevChange} aria-label="Previous change">
              <ChevronsLeft size={14} aria-hidden="true" />
            </Button>
            <Button size="sm" onClick={() => setPlaying((p) => !p)} leftIcon={playing ? Pause : Play} disabled={!changeDays.length}>
              {playing ? 'Pause' : day === days[days.length - 1] ? 'Replay' : 'Play'}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => nextChange && onDay(nextChange)} disabled={!nextChange} aria-label="Next change">
              <ChevronsRight size={14} aria-hidden="true" />
            </Button>
            <Button size="sm" variant="secondary" onClick={() => onDay(days[days.length - 1])} disabled={idx === days.length - 1} aria-label="Today">
              <SkipForward size={14} aria-hidden="true" />
            </Button>
            <div className={styles.ttSlider}>
              <label htmlFor="tl-tt-day" className={styles.ttDay}>
                {formatDate(day)}
                {day === days[days.length - 1] && ' (today)'}
              </label>
              <input
                id="tl-tt-day"
                type="range"
                min={0}
                max={Math.max(0, days.length - 1)}
                value={idx}
                onChange={(e) => {
                  setPlaying(false);
                  onDay(days[Number(e.target.value)]);
                }}
                aria-valuetext={formatDate(day)}
              />
              <div className={styles.ttTicks} aria-hidden="true">
                {changeDays.map((d) => (
                  <span key={d} className={styles.ttTick} style={{ left: `${days.length > 1 ? (days.indexOf(d) / (days.length - 1)) * 100 : 0}%` }} title={formatDate(d)} />
                ))}
              </div>
            </div>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setPlaying(false);
                step(-7);
              }}
            >
              −1 week
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setPlaying(false);
                step(7);
              }}
            >
              +1 week
            </Button>
          </div>

          <div className={styles.wiMetrics} aria-live="polite">
            <Then label="Phases" then={then.phases} now={now.phases} kind="count" />
            <Then label="Completed" then={then.completed} now={now.completed} kind="count" />
            <Then label="Overdue then" then={then.overdue} now={now.overdue} kind="count" />
            <Then label="Project end" then={then.projectEnd} now={now.projectEnd} kind="date" />
            <Then label="Likely finish then" then={then.likelyEnd} now={now.likelyEnd} kind="date" />
          </div>

          <div className={styles.ttEvents}>
            <strong>{todays.length ? `${plural(todays.length, 'change')} on ${formatDate(day)}` : `No changes on ${formatDate(day)}`}</strong>
            {todays.length > 0 && (
              <ul>
                {todays.slice(0, 8).map((e) => (
                  <li key={e.id}>
                    {eventText(e, nameOf)} <span className={styles.wiNote}>· {e.by || 'unknown'}, {formatDateTime(e.at)}</span>
                  </li>
                ))}
                {todays.length > 8 && <li>…and {todays.length - 8} more.</li>}
              </ul>
            )}
            <span className={styles.wiNote}>
              {plural(changeDays.length, 'day')} with changes since {formatDate(days[0])}. Dependencies and ticket progress are today’s (their history isn’t rebuilt).
            </span>
          </div>
        </>
      )}
    </section>
  );
}
