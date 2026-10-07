import { useId, useState } from 'react';
import Link from 'next/link';
import { Check, Lock } from 'lucide-react';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Avatar from '../ui/Avatar';
import { formatDateTime, formatRelativeTime } from '../../lib/formatDate';
import { CATEGORY_BY_VALUE, SEVERITY_BY_VALUE, STATUSES, STEPS } from '../../lib/clientTickets';
import { FileList, FilePicker } from './TicketFiles';
import styles from '../../styles/portal.module.css';

// Building blocks shared by the client portal (/portal) and the team's
// Client tickets pages. `audience` picks client or team wording.

export function SeverityBadge({ severity }) {
  const s = SEVERITY_BY_VALUE[severity];
  return <Badge tone={s?.tone || 'neutral'} dot>{s?.label || severity}</Badge>;
}

export function CategoryBadge({ category }) {
  return <Badge tone="neutral">{CATEGORY_BY_VALUE[category]?.label || category}</Badge>;
}

export function StatusBadge({ status, audience = 'client' }) {
  const s = STATUSES[status];
  return <Badge tone={s?.tone || 'neutral'}>{s ? s[audience] : status}</Badge>;
}

export function Stepper({ status }) {
  const current = STATUSES[status]?.step ?? 0;
  const closed = status === 'closed';
  return (
    <ol className={styles.stepper} aria-label="Progress">
      {STEPS.map((label, i) => {
        const done = i < current || closed;
        const isCurrent = i === current && !closed;
        return (
          <li
            key={label}
            className={`${styles.step} ${done ? styles.stepDone : ''} ${isCurrent ? styles.stepCurrent : ''}`}
            aria-current={isCurrent ? 'step' : undefined}
          >
            <span className={styles.stepDot} aria-hidden="true">
              {done ? <Check size={12} /> : i + 1}
            </span>
            <span>{label}</span>
            {done && <span className="sr-only"> (done)</span>}
          </li>
        );
      })}
    </ol>
  );
}

function eventText(event, audience) {
  if (event.type === 'created') return 'Ticket submitted';
  if (event.type === 'status') {
    const label = STATUSES[event.toValue]?.[audience] || event.toValue;
    return `Status changed to ${label}`;
  }
  if (event.type === 'assignee') {
    return event.toValue ? `Assigned to ${event.toValue}` : 'Unassigned';
  }
  return null;
}

// Replies and status changes in time order. `viewerId` marks the
// viewer's own replies; `files` are shown under the reply they came with.
export function Thread({ comments, events, files = [], viewerId, audience = 'client' }) {
  const items = [
    ...comments.map((c) => ({ kind: 'comment', at: c.createdAt, key: `c${c.id}`, c })),
    ...events.map((e) => ({ kind: 'event', at: e.createdAt, key: `e${e.id}`, e })),
  ].sort((a, b) => new Date(a.at) - new Date(b.at));

  if (items.length === 0) return null;
  return (
    <ol className={styles.thread} aria-label="Conversation and history">
      {items.map((item) => {
        if (item.kind === 'event') {
          const text = eventText(item.e, audience);
          if (!text) return null;
          return (
            <li key={item.key} className={styles.threadEvent}>
              <span>{text}</span>
              {item.e.actorName && audience === 'team' && <span> · {item.e.actorName}</span>}
              <span> · <time dateTime={item.at}>{formatDateTime(item.at)}</time></span>
            </li>
          );
        }
        const { c } = item;
        const mine = c.authorUserId === viewerId;
        return (
          <li key={item.key} className={`${styles.message} ${mine ? styles.messageMine : ''} ${c.isInternal ? styles.messageInternal : ''}`}>
            <Avatar name={c.authorName || '?'} size="sm" />
            <div className={styles.messageBody}>
              <div className={styles.messageMeta}>
                <strong>{mine ? 'You' : c.authorName || 'Unknown'}</strong>
                {audience === 'client' && c.fromTeam && !mine && <span> · Support team</span>}
                {c.isInternal && (
                  <span className={styles.internalTag}>
                    <Lock size={12} aria-hidden="true" /> Internal note, not visible to the client
                  </span>
                )}
                <span> · <time dateTime={c.createdAt}>{formatDateTime(c.createdAt)}</time></span>
              </div>
              <p className={styles.messageText}>{c.body}</p>
              <FileList files={files.filter((f) => f.commentId === c.id)} showUploader={false} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// Reply box. Team members also get the "internal note" option.
export function ReplyForm({ onSubmit, allowInternal = false, disabledReason = null }) {
  const id = useId();
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const [files, setFiles] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  if (disabledReason) return <p className={styles.muted}>{disabledReason}</p>;

  const submit = async (e) => {
    e.preventDefault();
    if (!body.trim()) {
      setError('Write a reply first.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSubmit({ body: body.trim(), isInternal: allowInternal && internal, files });
      setBody('');
      setInternal(false);
      setFiles([]);
    } catch (err) {
      // The reply itself went through but its files didn't: clear the text
      // (so it isn't sent twice) and keep the files to retry.
      if (err.replySent) {
        setBody('');
        setFiles([]);
      }
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className={styles.replyForm} onSubmit={submit} noValidate>
      <label htmlFor={`${id}-reply`} className={styles.fieldLabel}>
        {allowInternal && internal ? 'Internal note' : 'Reply'}
      </label>
      <textarea
        id={`${id}-reply`}
        className={`${styles.textarea} ${internal ? styles.textareaInternal : ''}`}
        rows={4}
        maxLength={5000}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      {error && <p id={`${id}-error`} className={styles.fieldError} role="alert">{error}</p>}
      <FilePicker files={files} onChange={setFiles} disabled={saving} />
      <div className={styles.replyActions}>
        {allowInternal && (
          <label className={styles.checkbox}>
            <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} />
            Internal note (team only)
          </label>
        )}
        <Button type="submit" loading={saving}>{allowInternal && internal ? 'Add note' : 'Send reply'}</Button>
      </div>
    </form>
  );
}

// Title, description and (bugs) steps/expected - the read-only body of a ticket.
export function TicketDetails({ ticket }) {
  return (
    <div className={styles.details}>
      <dl className={styles.facts}>
        <div><dt>Module</dt><dd>{ticket.moduleName || 'None'}</dd></div>
        <div><dt>Priority</dt><dd className={styles.capitalize}>{ticket.priority}</dd></div>
        <div><dt>Raised by</dt><dd>{ticket.createdByName || 'Unknown'}</dd></div>
        <div><dt>Assigned to</dt><dd>{ticket.assigneeName || 'Being assigned'}</dd></div>
        <div><dt>Submitted</dt><dd><time dateTime={ticket.createdAt}>{formatDateTime(ticket.createdAt)}</time></dd></div>
      </dl>
      <h3 className={styles.subheading}>Description</h3>
      <p className={styles.prewrap}>{ticket.description}</p>
      {ticket.stepsToReproduce && (
        <>
          <h3 className={styles.subheading}>Steps to reproduce</h3>
          <p className={styles.prewrap}>{ticket.stepsToReproduce}</p>
        </>
      )}
      {ticket.expectedResult && (
        <>
          <h3 className={styles.subheading}>Expected result</h3>
          <p className={styles.prewrap}>{ticket.expectedResult}</p>
        </>
      )}
      {ticket.files?.some((f) => !f.commentId) && (
        <>
          <h3 className={styles.subheading}>Files</h3>
          <FileList files={ticket.files.filter((f) => !f.commentId)} />
        </>
      )}
    </div>
  );
}

// One ticket in the client's card grid.
export function TicketCard({ ticket, href }) {
  return (
    <Link href={href} className={styles.card}>
      <div className={styles.cardTop}>
        <span className={styles.ticketKey}>{ticket.key}</span>
        <SeverityBadge severity={ticket.severity} />
        <StatusBadge status={ticket.status} />
      </div>
      <p className={styles.cardTitle}>{ticket.title}</p>
      <div className={styles.cardMeta}>
        <span>{ticket.moduleName || 'No module'}</span>
        <span>{ticket.assigneeName ? `With ${ticket.assigneeName}` : 'Being assigned'}</span>
        <span>
          Updated <time dateTime={ticket.lastActivityAt}>{formatRelativeTime(ticket.lastActivityAt)}</time>
        </span>
      </div>
    </Link>
  );
}
