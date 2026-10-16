import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw, X } from 'lucide-react';
import Badge from '../ui/Badge';
import { formatDate, formatWeekdayDate } from '../../lib/formatDate';
import { waitingLabel } from '../../lib/dailyScrumText';
import { roleLabel } from '../../lib/status';
import { REASON_LABELS, eventLabel } from './ScrumPersonView';
import styles from '../../styles/dailyScrum.module.css';

// Daily Scrum Stage 3 - Present mode: full screen, one person per slide
// with a 2-minute timer, then a summary slide. Read-only, built from the
// same GET /daily-scrum/team data the Team tab shows.
// Keys: Right/Space/PageDown next, Left/PageUp back, P pause, R restart
// the timer, Esc close.

export const SLOT_SECONDS = 120;
// Longer lists are cut on a slide - the full list is on the Team tab.
const SLIDE_LIMIT = 6;
const REASON_TONE = { sent_back: 'error', blocking_defect: 'error', overdue: 'error', waiting_on_dependency: 'warning', intervention: 'warning' };

function clock(seconds) {
  const abs = Math.abs(seconds);
  return `${seconds < 0 ? '+' : ''}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, '0')}`;
}

function Column({ title, items, render, empty }) {
  const shown = items.slice(0, SLIDE_LIMIT);
  return (
    <section className={styles.slideColumn}>
      <h3 className={styles.slideColumnTitle}>
        {title} <span className={styles.sectionCount}>{items.length}</span>
      </h3>
      {items.length === 0 ? (
        <p className={styles.empty}>{empty}</p>
      ) : (
        <ul className={styles.slideList}>
          {shown.map(render)}
          {items.length > shown.length && <li className={styles.slideMore}>+{items.length - shown.length} more</li>}
        </ul>
      )}
    </section>
  );
}

const ticket = (item) => (
  <li key={item.taskId}>
    <span className={styles.ticketId}>#{item.taskId}</span> {item.title}
    {item.reasons.length > 0 && (
      <span className={styles.slideChips}>
        {item.reasons.map((r) => (
          <Badge key={r} tone={REASON_TONE[r] || 'neutral'} dot>
            {REASON_LABELS[r] || r}
          </Badge>
        ))}
      </span>
    )}
  </li>
);

function PersonSlide({ person }) {
  const c = person.counts;
  return (
    <>
      <header className={styles.slideHeader}>
        <h2 id="present-slide-title" className={styles.slideTitle}>
          {person.name}
        </h2>
        <p className={styles.slideSubtitle}>
          {roleLabel(person.role)} · Today {c.today} · Blockers {c.blockers} · With reviewers {c.withReviewers}
        </p>
      </header>
      <div className={styles.slideGrid}>
        <Column
          title="Since last working day"
          items={person.since}
          empty="Nothing recorded."
          render={(e, i) => (
            <li key={`${e.kind}-${e.taskId}-${i}`}>
              <strong>{eventLabel(e.kind, false)}</strong>
              {e.taskId != null ? ` - #${e.taskId} ${e.title}` : ''}
            </li>
          )}
        />
        <Column title="Today" items={person.today} empty="Nothing without a blocker." render={ticket} />
        <Column title="Blockers" items={person.blockers} empty="No blockers." render={ticket} />
        <Column title="With reviewers" items={person.withReviewers} empty="Nothing with reviewers." render={ticket} />
      </div>
      {person.qa && (
        <p className={styles.slideFooterNote}>
          QA: {person.qa.executions.total} test cases run ({person.qa.executions.passed} passed, {person.qa.executions.failed} failed) · {person.qa.queue.pendingQa}{' '}
          waiting for QA
        </p>
      )}
    </>
  );
}

function SummarySlide({ team, waits }) {
  const t = team.totals;
  const openWaits = (waits || []).filter((w) => w.status === 'open');
  return (
    <>
      <header className={styles.slideHeader}>
        <h2 id="present-slide-title" className={styles.slideTitle}>
          Summary
        </h2>
        <p className={styles.slideSubtitle}>
          {team.people.length} people · Today {t.today} · Blockers {t.blockers} · With reviewers {t.withReviewers} · Active {t.active} ·{' '}
          {team.totalsMatch ? 'Totals match' : 'Totals do not match'}
        </p>
      </header>
      <div className={styles.slideGridTwo}>
        <Column
          title="Needs attention"
          items={team.needsAttention}
          empty="No blockers anywhere on the team."
          render={(item) => (
            <li key={item.taskId}>
              <span className={styles.ticketId}>#{item.taskId}</span> {item.title} - {item.name}
              <span className={styles.slideChips}>
                {item.reasons.map((r) => (
                  <Badge key={r} tone={REASON_TONE[r] || 'neutral'} dot>
                    {REASON_LABELS[r] || r}
                  </Badge>
                ))}
              </span>
            </li>
          )}
        />
        <Column
          title="Waiting on the city office"
          items={openWaits}
          empty="Nothing outside."
          render={(w) => (
            <li key={w.id}>
              {w.title} - {w.party}, {waitingLabel(w.requestedOn, team.window.today).toLowerCase()}
              {w.expectedBy ? `, expected ${formatDate(w.expectedBy)}` : ''}
            </li>
          )}
        />
      </div>
    </>
  );
}

export default function PresentMode({ team, waits, onClose }) {
  const rootRef = useRef(null);
  const slideCount = team.people.length + 1; // + summary
  const [index, setIndex] = useState(0);
  const [remaining, setRemaining] = useState(SLOT_SECONDS);
  const [running, setRunning] = useState(true);
  const isSummary = index === team.people.length;

  const go = useCallback(
    (next) => {
      const clamped = Math.max(0, Math.min(slideCount - 1, next));
      setIndex(clamped);
      setRemaining(SLOT_SECONDS);
      setRunning(true);
    },
    [slideCount],
  );

  // Timer - keeps counting into overtime (shown as +m:ss).
  useEffect(() => {
    if (!running || isSummary) return undefined;
    const id = setInterval(() => setRemaining((s) => s - 1), 1000);
    return () => clearInterval(id);
  }, [running, isSummary, index]);

  // Full screen where the browser allows it; the overlay covers the page
  // either way.
  useEffect(() => {
    const el = rootRef.current;
    const previouslyFocused = document.activeElement;
    el?.focus();
    el?.requestFullscreen?.().catch(() => {});
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
      previouslyFocused?.focus?.();
    };
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.closest?.('button') && (e.key === ' ' || e.key === 'Enter')) return;
      if (e.key === 'Escape') onClose();
      else if (['ArrowRight', 'PageDown', ' '].includes(e.key)) go(index + 1);
      else if (['ArrowLeft', 'PageUp'].includes(e.key)) go(index - 1);
      else if (e.key === 'p' || e.key === 'P') setRunning((r) => !r);
      else if (e.key === 'r' || e.key === 'R') setRemaining(SLOT_SECONDS);
      else return;
      e.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [go, index, onClose]);

  if (typeof document === 'undefined') return null;
  const timerState = remaining <= 0 ? styles.timerOver : remaining <= 30 ? styles.timerLow : '';

  return createPortal(
    <div ref={rootRef} className={styles.present} role="dialog" aria-modal="true" aria-labelledby="present-slide-title" tabIndex={-1}>
      <div className={styles.presentBar}>
        <span className={styles.presentMeta}>
          Daily Scrum · {formatWeekdayDate(team.window.today)} · {isSummary ? 'Summary' : `${index + 1} of ${team.people.length}`}
        </span>
        {!isSummary && (
          <span className={styles.presentTimer}>
            <span className={`${styles.timer} ${timerState}`} role="timer" aria-label={`${remaining <= 0 ? 'Over time by' : 'Time left'} ${clock(Math.abs(remaining))}`}>
              {clock(remaining)}
            </span>
            <button type="button" className={styles.presentButton} onClick={() => setRunning((r) => !r)} aria-label={running ? 'Pause timer' : 'Resume timer'}>
              {running ? <Pause size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}
            </button>
            <button type="button" className={styles.presentButton} onClick={() => setRemaining(SLOT_SECONDS)} aria-label="Restart timer">
              <RotateCcw size={18} aria-hidden="true" />
            </button>
          </span>
        )}
        <button type="button" className={styles.presentButton} onClick={onClose} aria-label="Close present mode">
          <X size={20} aria-hidden="true" />
        </button>
      </div>

      <div className={styles.slide}>{isSummary ? <SummarySlide team={team} waits={waits} /> : <PersonSlide person={team.people[index]} />}</div>

      <div className={styles.presentNav}>
        <button type="button" className={styles.presentButton} onClick={() => go(index - 1)} disabled={index === 0} aria-label="Previous">
          <ChevronLeft size={22} aria-hidden="true" />
        </button>
        <ol className={styles.presentDots} aria-label="Slides">
          {Array.from({ length: slideCount }, (_, i) => (
            <li key={i}>
              <button
                type="button"
                className={`${styles.presentDot} ${i === index ? styles.presentDotActive : ''}`}
                onClick={() => go(i)}
                aria-label={i === team.people.length ? 'Summary' : team.people[i].name}
                aria-current={i === index ? 'step' : undefined}
              />
            </li>
          ))}
        </ol>
        <button type="button" className={styles.presentButton} onClick={() => go(index + 1)} disabled={isSummary} aria-label="Next">
          <ChevronRight size={22} aria-hidden="true" />
        </button>
      </div>
    </div>,
    document.body,
  );
}
