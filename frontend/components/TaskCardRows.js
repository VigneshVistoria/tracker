import Link from 'next/link';
import issueStyles from '../styles/issues.module.css';

// Shared row renderer for the Developer Dashboard's and My Tasks page's
// Outbound ticket list - the one card that isn't a row in the task table
// (Outbound tickets live on someone else's task).
export function TicketRow({ ticket, subtitle }) {
  return (
    <Link key={`ticket-${ticket.id}`} href={`/tasks/${ticket.parentTaskId}`} className={issueStyles.issueRow}>
      <div className={issueStyles.issueMain}>
        <p className={`${issueStyles.issueTitle} ${issueStyles.issueTitleClamp}`}>{ticket.description}</p>
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
