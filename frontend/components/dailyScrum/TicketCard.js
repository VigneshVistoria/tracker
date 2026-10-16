import Link from 'next/link';
import Badge from '../ui/Badge';
import { formatDate, formatMonthDay } from '../../lib/formatDate';
import styles from '../../styles/dailyScrum.module.css';

// One ticket on the Daily Scrum, kept quiet on purpose: #id + title, one
// meta line, and only what needs attention as chips - the blocker reasons,
// plus priority when it's Immediate or High.

// User-facing strings, kept together for later i18n extraction.
export const REASON_LABELS = {
  sent_back: 'Sent back',
  blocking_defect: 'Open defect',
  waiting_on_dependency: 'Waiting on dependency',
  intervention: 'Intervention',
  overdue: 'Overdue',
};

export const REASON_TONE = {
  sent_back: 'error',
  blocking_defect: 'error',
  waiting_on_dependency: 'warning',
  intervention: 'warning',
  overdue: 'error',
};

const LOUD_PRIORITY = { Immediate: 'error', High: 'warning' };

export function ReasonChips({ reasons }) {
  if (!reasons?.length) return null;
  return reasons.map((r) => (
    <Badge key={r} tone={REASON_TONE[r] || 'neutral'} dot>
      {REASON_LABELS[r] || r}
    </Badge>
  ));
}

// `owner` (Team board / Needs attention) is shown in the meta line.
export default function TicketCard({ item, owner, compact = false }) {
  const loud = LOUD_PRIORITY[item.priority];
  const chips = item.reasons?.length > 0 || loud;
  return (
    <li className={`${styles.card} ${compact ? styles.cardCompact : ''}`}>
      <Link href={`/tasks/${item.taskId}`} className={styles.cardTitle}>
        <span className={styles.ticketId}>#{item.taskId}</span> {item.title}
      </Link>
      <p className={styles.cardMeta}>
        {owner ? `${owner} · ` : ''}
        {item.isDefect ? 'Defect · ' : ''}
        {item.status} · Due {compact ? formatMonthDay(item.dueDate) : formatDate(item.dueDate)}
        {!compact && item.projectName ? ` · ${item.projectName}` : ''}
      </p>
      {chips && (
        <div className={styles.chips}>
          {loud && <Badge tone={loud}>{item.priority}</Badge>}
          <ReasonChips reasons={item.reasons} />
        </div>
      )}
    </li>
  );
}
