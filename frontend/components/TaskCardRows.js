import Link from 'next/link';
import issueStyles from '../styles/issues.module.css';

// Shared row renderers for the Developer Dashboard's and My Tasks page's
// stat-card drill-down lists (My Tasks/Rejected/Inbound/Outbound/Overdue).
export function TaskRow({ task }) {
  return (
    <Link key={`task-${task.id}`} href={`/tasks/${task.id}`} className={issueStyles.issueRow}>
      <div className={issueStyles.issueMain}>
        <p className={issueStyles.issueTitle}>
          <span className={issueStyles.issueId}>#{task.id}</span>
          {task.description}
        </p>
        <div className={issueStyles.issueMeta}>
          <span>{task.projectName} &middot; {task.moduleName} &middot; {task.phaseName}</span>
          <span>{task.dueDate ? `Due ${task.dueDate}` : 'No due date set'}</span>
        </div>
      </div>
      <span className={issueStyles.badge}>{task.status}</span>
    </Link>
  );
}

export function TicketRow({ ticket, subtitle }) {
  return (
    <Link key={`ticket-${ticket.id}`} href={`/tasks/${ticket.parentTaskId}`} className={issueStyles.issueRow}>
      <div className={issueStyles.issueMain}>
        <p className={issueStyles.issueTitle}>{ticket.description}</p>
        <div className={issueStyles.issueMeta}>
          <span>{ticket.parentTaskDescription ? `Task: ${ticket.parentTaskDescription}` : `Task #${ticket.parentTaskId}`}</span>
          <span>{subtitle}</span>
        </div>
      </div>
      {ticket.parentTaskDueDate && <span className={issueStyles.badge}>Task due {ticket.parentTaskDueDate}</span>}
    </Link>
  );
}

export function CardList({ items, emptyText }) {
  if (items.length === 0) {
    return <div className={issueStyles.card}><div className={issueStyles.empty}>{emptyText}</div></div>;
  }
  return <div>{items}</div>;
}
