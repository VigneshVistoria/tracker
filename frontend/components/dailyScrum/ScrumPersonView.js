import { useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ChevronDown, FlaskConical, History, Hourglass, ListTodo, UserCheck, Workflow } from 'lucide-react';
import { formatDate, formatDateTime } from '../../lib/formatDate';
import TicketCard, { REASON_LABELS } from './TicketCard';
import styles from '../../styles/dailyScrum.module.css';

// One person's Daily Scrum - read-only, every list and number comes
// straight from the API (DailyScrumService / computeDailyScrum): GET
// /daily-scrum/me for your own, /daily-scrum/people/:id on the Individual
// tab. `self` picks "you" or third-person wording.

export { REASON_LABELS };

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

// Events shown before "Show all".
const SINCE_PREVIEW = 5;

// The one-line summary: Today · Blockers · With reviewers · Active.
export function SummaryStrip({ counts, children }) {
  return (
    <div className={styles.strip}>
      <dl className={styles.stripCounts}>
        <div>
          <dt>Today</dt>
          <dd>{counts.today}</dd>
        </div>
        <div className={counts.blockers > 0 ? styles.stripAlert : ''}>
          <dt>Blockers</dt>
          <dd>{counts.blockers}</dd>
        </div>
        <div>
          <dt>With reviewers</dt>
          <dd>{counts.withReviewers}</dd>
        </div>
        <div>
          <dt>Active</dt>
          <dd>{counts.active}</dd>
        </div>
      </dl>
      {children}
    </div>
  );
}

// One column of the board. `tone` colours the top rule only.
export function BoardColumn({ id, icon: Icon, title, items, empty, tone, render }) {
  const headingId = `scrum-col-${id}`;
  return (
    <section className={`${styles.column} ${styles[`column_${tone}`] || ''}`} aria-labelledby={headingId}>
      <h3 id={headingId} className={styles.columnTitle}>
        <Icon size={16} aria-hidden="true" />
        <span>{title}</span>
        <span className={styles.count}>{items.length}</span>
      </h3>
      {items.length === 0 ? <p className={styles.empty}>{empty}</p> : <ul className={styles.cards}>{items.map(render)}</ul>}
    </section>
  );
}

function SinceList({ events, timeZone, self }) {
  const [all, setAll] = useState(false);
  const shown = all ? events : events.slice(0, SINCE_PREVIEW);
  return (
    <section className={styles.panel} aria-labelledby="scrum-since">
      <h3 id="scrum-since" className={styles.panelTitle}>
        <History size={16} aria-hidden="true" />
        <span>Since last working day</span>
        <span className={styles.count}>{events.length}</span>
      </h3>
      {events.length === 0 ? (
        <p className={styles.empty}>Nothing recorded since the last working day.</p>
      ) : (
        <>
          <ol className={styles.timeline}>
            {shown.map((e, i) => (
              <li key={`${e.kind}-${e.taskId}-${i}`}>
                <time className={styles.timelineTime} dateTime={e.at}>
                  {formatDateTime(e.at, timeZone)}
                </time>
                <span className={styles.timelineText}>
                  <strong>{eventLabel(e.kind, self)}</strong>
                  {e.detail ? ` (${e.detail})` : ''}
                  {e.taskId != null && (
                    <>
                      {' · '}
                      <Link href={`/tasks/${e.taskId}`} className={styles.link}>
                        #{e.taskId} {e.title}
                      </Link>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ol>
          {events.length > SINCE_PREVIEW && (
            <button type="button" className={styles.textButton} onClick={() => setAll((v) => !v)} aria-expanded={all}>
              {all ? 'Show fewer' : `Show all ${events.length}`}
            </button>
          )}
        </>
      )}
    </section>
  );
}

function QaStrip({ qa, self }) {
  const { executions: x, queue: q } = qa;
  return (
    <section className={styles.qaStrip} aria-labelledby="scrum-qa">
      <h3 id="scrum-qa" className={styles.panelTitle}>
        <FlaskConical size={16} aria-hidden="true" />
        <span>QA</span>
      </h3>
      <dl className={styles.qaFacts}>
        <div>
          <dt>Test cases run</dt>
          <dd>
            {x.total} <span className={styles.qaSplit}>({x.passed} passed, {x.failed} failed, {x.blocked} blocked)</span>
          </dd>
        </div>
        <div>
          <dt>
            <Link href="/tasks/qa-review" className={styles.link}>
              Waiting for QA
            </Link>
          </dt>
          <dd>
            {q.pendingQa} <span className={styles.qaSplit}>({q.resubmissions} resubmissions)</span>
          </dd>
        </div>
        <div>
          <dt>
            <Link href="/tasks/my-defects" className={styles.link}>
              {self ? 'My open defects' : 'Open defects they raised'}
            </Link>
          </dt>
          <dd>{q.myOpenDefects}</dd>
        </div>
      </dl>
    </section>
  );
}

// Folded by default - reference only, not counted in the person's work.
function Reference({ id, icon: Icon, title, count, empty, children }) {
  return (
    <details className={styles.reference}>
      <summary className={styles.referenceSummary} id={`scrum-ref-${id}`}>
        <Icon size={16} aria-hidden="true" />
        <span>{title}</span>
        <span className={styles.count}>{count}</span>
        <ChevronDown size={16} className={styles.referenceChevron} aria-hidden="true" />
      </summary>
      <div className={styles.referenceBody}>{count === 0 ? <p className={styles.empty}>{empty}</p> : children}</div>
    </details>
  );
}

export default function ScrumPersonView({ person, timeZone, self = true }) {
  const render = (item) => <TicketCard key={item.taskId} item={item} />;
  return (
    <div className={styles.stack}>
      <SummaryStrip counts={person.counts} />

      <SinceList events={person.since} timeZone={timeZone} self={self} />

      <div className={styles.board}>
        <BoardColumn id="today" icon={ListTodo} title="Today" tone="today" items={person.today} empty="Nothing to work on without a blocker." render={render} />
        <BoardColumn id="blockers" icon={AlertTriangle} title="Blockers" tone="blockers" items={person.blockers} empty="No blockers." render={render} />
        <BoardColumn
          id="reviewers"
          icon={Hourglass}
          title="With reviewers"
          tone="reviewers"
          items={person.withReviewers}
          empty="Nothing with QA, PM or peer review."
          render={render}
        />
      </div>

      {person.qa && <QaStrip qa={person.qa} self={self} />}

      <div className={styles.references}>
        <p className={styles.referenceNote}>For reference - not counted in {self ? 'your' : 'their'} work</p>
        <Reference
          id="waiting"
          icon={Workflow}
          title={self ? 'Others are waiting on you' : 'Others are waiting on them'}
          count={person.waitingOnYou.length}
          empty={self ? 'Nobody is waiting on a dependency from you.' : 'Nobody is waiting on a dependency from them.'}
        >
          <ul className={styles.plainList}>
            {person.waitingOnYou.map((d) => (
              <li key={d.dependencyId}>
                <Link href={`/tasks/${d.parentTaskId}`} className={styles.link}>
                  {d.title}
                </Link>
                <p className={styles.cardMeta}>
                  For #{d.parentTaskId} {d.parentTaskTitle} · asked by {d.requestedByName} on {formatDate(d.createdAt)} · ticket due {formatDate(d.parentTaskDueDate)}
                </p>
              </li>
            ))}
          </ul>
        </Reference>
        <Reference
          id="peer"
          icon={UserCheck}
          title="Peer reviews to do"
          count={person.peerReviewsToDo.length}
          empty={self ? 'No peer reviews waiting on you.' : 'No peer reviews waiting on them.'}
        >
          <ul className={styles.plainList}>
            {person.peerReviewsToDo.map((r) => (
              <li key={r.taskId}>
                <Link href={`/tasks/${r.taskId}`} className={styles.link}>
                  <span className={styles.ticketId}>#{r.taskId}</span> {r.title}
                </Link>
                <p className={styles.cardMeta}>
                  {r.assigneeName} · round {r.roundNumber} · submitted {formatDateTime(r.submittedAt, timeZone)}
                </p>
              </li>
            ))}
          </ul>
        </Reference>
      </div>
    </div>
  );
}
