import Link from 'next/link';
import { ArrowRight, CalendarClock, CheckCircle2 } from 'lucide-react';
import Badge from '../ui/Badge';
import Skeleton from '../ui/Skeleton';
import Avatar from '../ui/Avatar';
import { formatDate } from '../../lib/formatDate';
import { isOverdueTask, todayISO } from '../../lib/developerTaskStats';
import { COMPLETED_STATUSES, HOLD_CLOSED_STATUSES, statusBadgeStyle, statusLabel, priorityTone, priorityLabel } from '../../lib/taskTableShared';
import styles from '../../styles/dashboardHome.module.css';

function greetingFor(date) {
  const hour = date.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

// Time-of-day greeting + today's date + one-line summary. Rendered
// client-side only (the dashboard mounts after localStorage is read), so
// the local clock is safe to use without a hydration mismatch.
export function DashboardHeader({ user, summary, actions }) {
  const now = new Date();
  const firstName = user.fullName ? user.fullName.split(' ')[0] : null;
  return (
    <header className={styles.header}>
      <Avatar name={user.fullName || user.email} size="lg" className={styles.headerAvatar} />
      <div className={styles.headerText}>
        <p className={styles.headerDate}>
          {now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
        <h1 className={styles.headerTitle}>
          {greetingFor(now)}
          {firstName ? `, ${firstName}` : ''}
        </h1>
        {summary && <p className={styles.headerSummary}>{summary}</p>}
      </div>
      {actions && <div className={styles.headerActions}>{actions}</div>}
    </header>
  );
}

// Clickable stat tile. `tone` only applies when the value is non-zero and
// always ships with the icon + label (never colour alone). value === null
// while loading renders a skeleton; undefined (no access/failed) hides it.
export function AttentionTile({ href, icon: Icon, value, label, caption, tone = 'neutral' }) {
  if (value === undefined) return null;
  const loading = value === null;
  const active = !loading && value > 0;
  const toneClass = active ? styles[`tone_${tone}`] || '' : '';
  return (
    <Link href={href} className={`${styles.tile} ${toneClass}`}>
      <span className={styles.tileTop}>
        <span className={styles.tileIcon} aria-hidden="true">
          <Icon size={18} />
        </span>
        <ArrowRight size={16} className={styles.tileArrow} aria-hidden="true" />
      </span>
      <span className={styles.tileValue}>{loading ? <Skeleton width="48px" height="32px" /> : value}</span>
      <span className={styles.tileLabel}>{label}</span>
      {caption && !loading && <span className={styles.tileCaption}>{active ? caption.active : caption.clear}</span>}
    </Link>
  );
}

export function TileGrid({ children, label }) {
  return (
    <section aria-label={label} className={styles.tileGrid}>
      {children}
    </section>
  );
}

export function Panel({ title, action, children, className = '' }) {
  return (
    <section className={`${styles.panel} ${className}`} aria-label={title}>
      <div className={styles.panelHeader}>
        <h2 className={styles.panelTitle}>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function PanelLink({ href, children }) {
  return (
    <Link href={href} className={styles.panelLink}>
      {children}
      <ArrowRight size={14} aria-hidden="true" />
    </Link>
  );
}

const NOT_ACTIVE = [...COMPLETED_STATUSES, ...HOLD_CLOSED_STATUSES];

// Open tasks most in need of attention: overdue first, then by due date
// (undated last), then newest.
export function upNextTasks(tasks, limit = 6) {
  return tasks
    .filter((t) => !NOT_ACTIVE.includes(t.status))
    .sort((a, b) => {
      const ao = isOverdueTask(a) ? 0 : 1;
      const bo = isOverdueTask(b) ? 0 : 1;
      if (ao !== bo) return ao - bo;
      if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
      if (!!a.dueDate !== !!b.dueDate) return a.dueDate ? -1 : 1;
      return b.id - a.id;
    })
    .slice(0, limit);
}

function dueText(task) {
  if (!task.dueDate) return 'No due date';
  const today = todayISO();
  if (task.dueDate === today) return 'Due today';
  if (isOverdueTask(task, today)) return `Overdue · ${formatDate(task.dueDate)}`;
  return `Due ${formatDate(task.dueDate)}`;
}

export function TaskList({ tasks, loading, emptyText }) {
  if (loading) {
    return (
      <div className={styles.listSkeleton} aria-busy="true" aria-label="Loading tasks">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} height="52px" />
        ))}
      </div>
    );
  }
  if (tasks.length === 0) {
    return (
      <div className={styles.emptyRow} role="status">
        <CheckCircle2 size={20} aria-hidden="true" />
        <span>{emptyText}</span>
      </div>
    );
  }
  return (
    <ul className={styles.taskList}>
      {tasks.map((task) => {
        const overdue = isOverdueTask(task);
        return (
          <li key={task.id}>
            <Link href={`/tasks/${task.id}`} className={styles.taskRow}>
              <span className={styles.taskMain}>
                <span className={styles.taskTitle}>
                  <span className={styles.taskId}>#{task.id}</span>
                  {task.title}
                </span>
                <span className={`${styles.taskDue} ${overdue ? styles.taskDueOverdue : ''}`}>
                  <CalendarClock size={13} aria-hidden="true" />
                  {dueText(task)}
                  {task.projectName ? ` · ${task.projectName}` : ''}
                </span>
              </span>
              {task.priority && <Badge tone={priorityTone(task.priority)}>{priorityLabel(task.priority)}</Badge>}
              <span className={styles.statusChip} style={statusBadgeStyle(task.status)}>
                {statusLabel(task.status)}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

const PIPELINE = [
  { status: 'Backlog', color: 'var(--status-open)' },
  { status: 'In Progress', color: 'var(--status-inprogress)' },
  { status: 'In Review', color: 'var(--status-review)' },
  { status: 'QA Testing', color: 'var(--status-qa)' },
  { status: 'QA Failed', color: 'var(--color-red)' },
  { status: 'Ready for Production', color: 'var(--status-closed)' },
];

// Issues by stage as an ordered row of labelled counts (a KPI row, not a
// chart - six headline numbers read faster as numbers). Stages link to the
// Issues list only for roles that can open it (`linkable`).
export function IssuePipeline({ issues, loading, linkable = true }) {
  return (
    <ol className={styles.pipeline}>
      {PIPELINE.map((stage) => {
        const count = issues.filter((i) => i.status === stage.status).length;
        const content = (
          <>
            <span className={styles.pipelineCount}>{loading ? '–' : count}</span>
            <span className={styles.pipelineLabel}>
              <span className={styles.pipelineDot} style={{ background: stage.color }} aria-hidden="true" />
              {stage.status}
            </span>
          </>
        );
        return (
          <li key={stage.status} className={styles.pipelineStage}>
            {linkable ? (
              <Link href="/issues" className={styles.pipelineLink}>
                {content}
              </Link>
            ) : (
              <div className={`${styles.pipelineLink} ${styles.pipelineStatic}`}>{content}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function StatRow({ items }) {
  return (
    <dl className={styles.statRow}>
      {items.map((item) => (
        <div key={item.label} className={styles.statRowItem}>
          <dt className={styles.statRowLabel}>{item.label}</dt>
          <dd className={styles.statRowValue}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
