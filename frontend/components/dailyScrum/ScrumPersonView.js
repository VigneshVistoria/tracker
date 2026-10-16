import Link from 'next/link';
import { CalendarCheck, AlertTriangle, Hourglass, ListTodo, History, Workflow, UserCheck, FlaskConical } from 'lucide-react';
import Badge from '../ui/Badge';
import StatCard from '../ui/StatCard';
import { formatDate, formatDateTime } from '../../lib/formatDate';
import { priorityLabel, priorityTone, statusBadgeStyle } from '../../lib/taskTableShared';
import styles from '../../styles/dailyScrum.module.css';

// One person's Daily Scrum - read-only, every list and number comes
// straight from the API (DailyScrumService / computeDailyScrum): GET
// /daily-scrum/me for your own, /daily-scrum/people/:id on the Individual
// tab. `self` picks "you" or third-person wording.

// User-facing strings, kept together for later i18n extraction.
export const REASON_LABELS = {
  sent_back: 'Sent back',
  blocking_defect: 'Open defect',
  waiting_on_dependency: 'Waiting on dependency',
  intervention: 'Intervention',
  overdue: 'Overdue',
};

const REASON_TONE = {
  sent_back: 'error',
  blocking_defect: 'error',
  waiting_on_dependency: 'warning',
  intervention: 'warning',
  overdue: 'error',
};

// Event kinds from DailyScrumService.loadEvents(). `detail` is appended
// where the backend sends one (review type/round, dependency title).
export const EVENT_LABELS = {
  submitted_for_review: 'Submitted for review',
  review_passed: 'Passed review',
  review_sent_back: 'Sent back',
  review_escalated: 'Escalated by reviewer',
  reviewed_approved: 'You approved',
  reviewed_rejected: 'You sent back',
  reviewed_escalated: 'You escalated',
  assigned: 'Assigned to you',
  defect_assigned: 'Defect assigned to you',
  raised_defect: 'You raised a defect',
  put_on_hold: 'Put on hold',
  released_from_hold: 'Released from hold',
  closed: 'Closed',
  reopened: 'Reopened',
  dependency_received: 'Dependency raised to you',
  dependency_raised: 'You raised a dependency',
  dependency_resolved: 'You resolved a dependency',
  dependency_cleared: 'Your dependency was resolved',
};

// The same events seen by someone else (Individual tab, Present mode,
// Copy as text).
export const EVENT_LABELS_OTHER = {
  ...EVENT_LABELS,
  reviewed_approved: 'Approved',
  reviewed_rejected: 'Sent back',
  reviewed_escalated: 'Escalated',
  assigned: 'Assigned',
  defect_assigned: 'Defect assigned',
  raised_defect: 'Raised a defect',
  dependency_received: 'Dependency raised to them',
  dependency_raised: 'Raised a dependency',
  dependency_resolved: 'Resolved a dependency',
  dependency_cleared: 'Their dependency was resolved',
};

export function eventLabel(kind, self = true) {
  return (self ? EVENT_LABELS : EVENT_LABELS_OTHER)[kind] || kind.replace(/_/g, ' ');
}

function TicketLine({ item, showReasons = true }) {
  return (
    <li className={styles.ticket}>
      <div className={styles.ticketMain}>
        <Link href={`/tasks/${item.taskId}`} className={styles.ticketLink}>
          <span className={styles.ticketId}>#{item.taskId}</span> {item.title}
        </Link>
        <p className={styles.ticketMeta}>
          {item.isDefect ? 'Defect · ' : ''}
          {item.projectName}
          {item.moduleName ? ` · ${item.moduleName}` : ''}
          {' · '}Due {formatDate(item.dueDate)}
        </p>
      </div>
      <div className={styles.ticketTags}>
        <span className={styles.statusPill} style={statusBadgeStyle(item.status)}>
          {item.status}
        </span>
        <Badge tone={priorityTone(item.priority)}>{priorityLabel(item.priority)}</Badge>
        {showReasons &&
          item.reasons.map((r) => (
            <Badge key={r} tone={REASON_TONE[r] || 'neutral'} dot>
              {REASON_LABELS[r] || r}
            </Badge>
          ))}
      </div>
    </li>
  );
}

function Section({ id, icon: Icon, title, count, empty, children }) {
  const headingId = `scrum-${id}`;
  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.sectionTitle}>
        <Icon size={16} aria-hidden="true" />
        <span>{title}</span>
        {count != null && <span className={styles.sectionCount}>{count}</span>}
      </h2>
      {count === 0 ? <p className={styles.empty}>{empty}</p> : children}
    </section>
  );
}

function QaPanel({ qa, self }) {
  const { executions, queue } = qa;
  return (
    <section className={styles.section} aria-labelledby="scrum-qa">
      <h2 id="scrum-qa" className={styles.sectionTitle}>
        <FlaskConical size={16} aria-hidden="true" />
        <span>QA</span>
      </h2>
      <div className={styles.qaGrid}>
        <div>
          <p className={styles.qaHeading}>Test cases run since last working day</p>
          <dl className={styles.qaList}>
            <div><dt>Passed</dt><dd>{executions.passed}</dd></div>
            <div><dt>Failed</dt><dd>{executions.failed}</dd></div>
            <div><dt>Blocked</dt><dd>{executions.blocked}</dd></div>
            <div><dt>Total</dt><dd>{executions.total}</dd></div>
          </dl>
        </div>
        <div>
          <p className={styles.qaHeading}>QA queue now</p>
          <dl className={styles.qaList}>
            <div>
              <dt><Link href="/tasks/qa-review">Waiting for QA</Link></dt>
              <dd>{queue.pendingQa}</dd>
            </div>
            <div><dt>Of which resubmissions</dt><dd>{queue.resubmissions}</dd></div>
            <div>
              <dt><Link href="/tasks/my-defects">{self ? 'My open defects' : 'Open defects they raised'}</Link></dt>
              <dd>{queue.myOpenDefects}</dd>
            </div>
          </dl>
        </div>
      </div>
    </section>
  );
}

export default function ScrumPersonView({ person, timeZone, self = true }) {
  const { counts } = person;
  return (
    <div className={styles.person}>
      <div className={styles.stats}>
        <StatCard label="Today" value={counts.today} icon={ListTodo} accent="primary" />
        <StatCard label="Blockers" value={counts.blockers} icon={AlertTriangle} accent={counts.blockers > 0 ? 'error' : 'neutral'} />
        <StatCard label="With reviewers" value={counts.withReviewers} icon={Hourglass} accent="warning" />
        <StatCard label="Active tickets" value={counts.active} icon={CalendarCheck} accent="neutral" />
      </div>

      {person.qa && <QaPanel qa={person.qa} self={self} />}

      <div className={styles.grid}>
        <Section id="since" icon={History} title="Since last working day" count={person.since.length} empty="Nothing recorded since the last working day.">
          <ol className={styles.events}>
            {person.since.map((e, i) => (
              <li key={`${e.kind}-${e.taskId}-${i}`} className={styles.event}>
                <time className={styles.eventTime} dateTime={e.at}>
                  {formatDateTime(e.at, timeZone)}
                </time>
                <span className={styles.eventText}>
                  <strong>{eventLabel(e.kind, self)}</strong>
                  {e.detail ? ` (${e.detail})` : ''}
                  {e.taskId != null && (
                    <>
                      {' - '}
                      <Link href={`/tasks/${e.taskId}`} className={styles.ticketLink}>
                        #{e.taskId} {e.title}
                      </Link>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ol>
        </Section>

        <Section id="today" icon={ListTodo} title="Today" count={counts.today} empty="No tickets to work on without a blocker.">
          <ul className={styles.tickets}>
            {person.today.map((item) => (
              <TicketLine key={item.taskId} item={item} />
            ))}
          </ul>
        </Section>

        <Section id="blockers" icon={AlertTriangle} title="Blockers" count={counts.blockers} empty="No blockers.">
          <ul className={styles.tickets}>
            {person.blockers.map((item) => (
              <TicketLine key={item.taskId} item={item} />
            ))}
          </ul>
        </Section>

        <Section id="reviewers" icon={Hourglass} title="With reviewers" count={counts.withReviewers} empty="Nothing waiting on QA, PM or peer review.">
          <ul className={styles.tickets}>
            {person.withReviewers.map((item) => (
              <TicketLine key={item.taskId} item={item} />
            ))}
          </ul>
        </Section>
      </div>

      <h2 className={styles.referenceHeading}>For reference - not counted in {self ? 'your' : 'their'} work</h2>
      <div className={styles.grid}>
        <Section id="waiting" icon={Workflow} title={self ? 'Others are waiting on you' : 'Others are waiting on them'} count={person.waitingOnYou.length} empty={self ? 'Nobody is waiting on a dependency from you.' : 'Nobody is waiting on a dependency from them.'}>
          <ul className={styles.tickets}>
            {person.waitingOnYou.map((d) => (
              <li key={d.dependencyId} className={styles.ticket}>
                <div className={styles.ticketMain}>
                  <Link href={`/tasks/${d.parentTaskId}`} className={styles.ticketLink}>
                    {d.title}
                  </Link>
                  <p className={styles.ticketMeta}>
                    For #{d.parentTaskId} {d.parentTaskTitle} · asked by {d.requestedByName} on {formatDate(d.createdAt)} · ticket due{' '}
                    {formatDate(d.parentTaskDueDate)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </Section>

        <Section id="peer" icon={UserCheck} title="Peer reviews to do" count={person.peerReviewsToDo.length} empty={self ? 'No peer reviews waiting on you.' : 'No peer reviews waiting on them.'}>
          <ul className={styles.tickets}>
            {person.peerReviewsToDo.map((r) => (
              <li key={r.taskId} className={styles.ticket}>
                <div className={styles.ticketMain}>
                  <Link href={`/tasks/${r.taskId}`} className={styles.ticketLink}>
                    <span className={styles.ticketId}>#{r.taskId}</span> {r.title}
                  </Link>
                  <p className={styles.ticketMeta}>
                    {r.assigneeName} · round {r.roundNumber} · submitted {formatDateTime(r.submittedAt, timeZone)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </div>
  );
}
