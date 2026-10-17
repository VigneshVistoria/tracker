import { useState } from 'react';
import { AlertOctagon, CheckCircle2, ChevronDown, ChevronUp, Clock, Layers, ListChecks, Stethoscope } from 'lucide-react';
import Button from '../ui/Button';
import styles from '../../styles/timelineOverview.module.css';
import pageStyles from '../../styles/projectTimeline.module.css';
import { formatDate } from '../../lib/formatDate';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// One row of chips for everything that needs a look (2026-10-17) - it
// replaces the full-width conflict and ticket banners. Conflicts and
// ticket mismatches open their detail in place; Overdue filters the
// Gantt/Table; Status check opens the Overview.
export default function AttentionStrip({ conflicts, shiftsCount, canEdit, onShift, ticketIssues, ticketInfoById, onTicketRow, overdue, onOverdue, statusChecks, onStatusChecks, overlapPairs }) {
  const [open, setOpen] = useState(null); // 'conflicts' | 'tickets' | null
  const toggle = (key) => setOpen((cur) => (cur === key ? null : key));
  const nothing = conflicts.length === 0 && ticketIssues.length === 0 && overdue === 0 && statusChecks === 0;

  const Chevron = ({ k }) => (open === k ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />);

  return (
    <section className={styles.strip} aria-label="Needs attention">
      <div className={styles.chips}>
        <span className={styles.stripLabel}>Attention</span>
        {nothing && (
          <span className={`${styles.chip} ${styles.chipSuccess}`}>
            <CheckCircle2 size={14} aria-hidden="true" /> All clear: no conflicts, ticket mismatches or overdue phases
          </span>
        )}
        {conflicts.length > 0 && (
          <button type="button" className={`${styles.chip} ${styles.chipError} ${open === 'conflicts' ? styles.chipOpen : ''}`} aria-expanded={open === 'conflicts'} aria-controls="tl-att-conflicts" onClick={() => toggle('conflicts')}>
            <AlertOctagon size={14} aria-hidden="true" />
            <span className={styles.chipCount}>{conflicts.length}</span> dependency conflict{conflicts.length === 1 ? '' : 's'}
            <Chevron k="conflicts" />
          </button>
        )}
        {ticketIssues.length > 0 && (
          <button type="button" className={`${styles.chip} ${styles.chipWarning} ${open === 'tickets' ? styles.chipOpen : ''}`} aria-expanded={open === 'tickets'} aria-controls="tl-att-tickets" onClick={() => toggle('tickets')}>
            <ListChecks size={14} aria-hidden="true" />
            <span className={styles.chipCount}>{ticketIssues.length}</span> ticket mismatch{ticketIssues.length === 1 ? '' : 'es'}
            <Chevron k="tickets" />
          </button>
        )}
        {overdue > 0 && (
          <button type="button" className={`${styles.chip} ${styles.chipError}`} onClick={onOverdue} aria-label={`${plural(overdue, 'overdue phase')}. Show them`}>
            <Clock size={14} aria-hidden="true" />
            <span className={styles.chipCount}>{overdue}</span> overdue
          </button>
        )}
        {statusChecks > 0 && (
          <button type="button" className={`${styles.chip} ${styles.chipWarning}`} onClick={onStatusChecks} aria-label={`${plural(statusChecks, 'status check')}. Open the status check`}>
            <Stethoscope size={14} aria-hidden="true" />
            <span className={styles.chipCount}>{statusChecks}</span> status check{statusChecks === 1 ? '' : 's'}
          </button>
        )}
        {overlapPairs > 0 && (
          <span className={styles.chip} title="Phases in the same module whose dates overlap">
            <Layers size={14} aria-hidden="true" />
            <span className={styles.chipCount}>{overlapPairs}</span> overlapping pair{overlapPairs === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {open === 'conflicts' && conflicts.length > 0 && (
        <div id="tl-att-conflicts" className={pageStyles.conflictBanner} role="region" aria-label="Dependency conflicts">
          <div className={pageStyles.conflictText}>
            <strong>
              {plural(conflicts.length, 'phase')} start{conflicts.length === 1 ? 's' : ''} before the phase{conflicts.length === 1 ? '' : 's'} they depend on allow
              {conflicts.length === 1 ? 's' : ''}.
            </strong>
            <ul>
              {conflicts.slice(0, 8).map((c) => (
                <li key={`${c.dep.predecessorRowId}-${c.dep.successorRowId}`}>
                  {c.successor.phase} ({c.successor.module}) starts {formatDate(c.successor.startDate)}, {plural(c.daysEarly, 'day')} before “{c.predecessor.phase}” allows (
                  {formatDate(c.earliest)}).
                </li>
              ))}
              {conflicts.length > 8 && <li>…and {conflicts.length - 8} more.</li>}
            </ul>
          </div>
          {canEdit && shiftsCount > 0 && (
            <Button variant="secondary" onClick={onShift}>
              Shift {plural(shiftsCount, 'phase')} to fit
            </Button>
          )}
        </div>
      )}

      {open === 'tickets' && ticketIssues.length > 0 && (
        <div id="tl-att-tickets" className={pageStyles.ticketCheck} role="region" aria-label="Ticket mismatches">
          <strong>
            {plural(ticketIssues.length, 'phase')} {ticketIssues.length === 1 ? 'doesn’t' : 'don’t'} match {ticketIssues.length === 1 ? 'its' : 'their'} tickets.
          </strong>
          <ul>
            {ticketIssues.slice(0, 8).map((r) => (
              <li key={r.key}>
                <button type="button" onClick={() => onTicketRow(r.key)}>
                  {r.module} – {r.phase}
                </button>
                : {ticketInfoById.get(r.id).mismatches.map((m) => m.text).join('; ')}
              </li>
            ))}
            {ticketIssues.length > 8 && <li>…and {ticketIssues.length - 8} more.</li>}
          </ul>
        </div>
      )}
    </section>
  );
}
