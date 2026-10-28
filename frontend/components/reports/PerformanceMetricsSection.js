import { Fragment, useEffect, useState } from 'react';
import Link from 'next/link';
import Badge from '../ui/Badge';
import LoadingState from '../ui/LoadingState';
import styles from '../../styles/issues.module.css';
import pm from '../../styles/performanceMetrics.module.css';
import { apiFetch } from '../../lib/api';
import { formatDate, formatDateTime } from '../../lib/formatDate';

// Performance metrics (GET /performance-metrics, 2026-10-27): per person,
// over the rolling window ending on the report's To date - Due date set on
// time, Due date changes per task, QA acceptance. PM/Executive/Admin get
// everyone; a Developer/Designer/DevOps gets only their own row (the
// backend decides). Every rule and threshold comes from the settings in
// the response, never from this file.

const STATUS = {
  ok: { label: 'OK', tone: 'success' },
  needs_attention: { label: 'Needs attention', tone: 'warning' },
  not_enough_data: { label: 'Not enough data', tone: 'neutral' },
};

const ON_TIME_OUTCOME = {
  on_time: 'On time',
  already_dated: 'Already dated when assigned',
  late: 'Set late',
  not_set: 'Not set by the deadline',
  set_by_other: 'Set by someone else',
};

const DECISION = { approved: 'Accepted', rejected: 'Rejected', escalated: 'Escalated to PM' };

const SETTINGS_ROLES = ['admin', 'program_manager'];

function StatusBadge({ status }) {
  const s = STATUS[status] || STATUS.not_enough_data;
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

function percent(value) {
  return value === null || value === undefined ? '—' : `${value}%`;
}

function TaskLink({ id }) {
  return (
    <Link href={`/tasks/${id}`} target="_blank" rel="noopener noreferrer">
      #{id}
    </Link>
  );
}

function Reconstructed({ show }) {
  return show ? <span className={pm.tag}>from audit history</span> : null;
}

function DrillDown({ person, names, timeZone }) {
  const nameOf = (id) => (id ? names[id] || `User #${id}` : 'system');
  return (
    <div className={pm.drill}>
      <div>
        <h4 className={pm.drillTitle}>Date set on time ({person.onTime.counted})</h4>
        {person.onTime.items.length === 0 ? (
          <p className={pm.drillEmpty}>No assignments with a deadline in this period.</p>
        ) : (
          <ul className={pm.drillList}>
            {person.onTime.items.map((i) => (
              <li key={`${i.taskId}-${i.assignedAt}`}>
                <TaskLink id={i.taskId} /> {i.title}
                <span className={pm.tag}>{ON_TIME_OUTCOME[i.outcome] || i.outcome}</span>
                <Reconstructed show={i.reconstructed} />
                <br />
                Assigned {formatDateTime(i.assignedAt, timeZone)} · due by end of {formatDate(i.dueBy)}
                {i.setAt ? ` · set ${formatDateTime(i.setAt, timeZone)} by ${nameOf(i.setByUserId)}` : ''}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h4 className={pm.drillTitle}>
          Due date changes ({person.dueChanges.changes} on {person.dueChanges.tasks} tasks)
        </h4>
        {person.dueChanges.items.length === 0 ? (
          <p className={pm.drillEmpty}>No Due date changes in this period.</p>
        ) : (
          <ul className={pm.drillList}>
            {person.dueChanges.items.map((i) => (
              <li key={`${i.taskId}-${i.at}`}>
                <TaskLink id={i.taskId} /> {i.title}
                <span className={pm.tag}>{i.direction === 'later' ? 'Extension (later)' : 'Earlier'}</span>
                <Reconstructed show={i.reconstructed} />
                <br />
                {formatDate(i.oldDueDate)} → {formatDate(i.newDueDate)} · by {nameOf(i.byUserId)}
                {i.initiatedByUserId != null && i.initiatedByUserId !== i.byUserId && ` (asked by ${nameOf(i.initiatedByUserId)})`}, {formatDateTime(i.at, timeZone)}
              </li>
            ))}
          </ul>
        )}
        {/* 2026-10-28: only changes the assignee started are charged; the rest are shown here. */}
        {(person.dueChanges.notCharged?.changes ?? 0) > 0 && (
          <details>
            <summary className={pm.drillEmpty}>Changed by a PM/Admin - not charged ({person.dueChanges.notCharged.changes})</summary>
            <ul className={pm.drillList}>
              {person.dueChanges.notCharged.items.map((i) => (
                <li key={`${i.taskId}-${i.at}`}>
                  <TaskLink id={i.taskId} /> {i.title}
                  <br />
                  {formatDate(i.oldDueDate)} → {formatDate(i.newDueDate)} · by {nameOf(i.initiatedByUserId)}, {formatDateTime(i.at, timeZone)}
                </li>
              ))}
            </ul>
          </details>
        )}
        {person.dueChanges.tasksCounted.length > 0 && (
          <details>
            <summary className={pm.drillEmpty}>Tasks counted for the average ({person.dueChanges.tasksCounted.length})</summary>
            <ul className={pm.drillList}>
              {person.dueChanges.tasksCounted.map((x) => (
                <li key={x.taskId}>
                  <TaskLink id={x.taskId} /> {x.title}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      <div>
        <h4 className={pm.drillTitle}>QA decisions ({person.qa.decided})</h4>
        {person.qa.items.length === 0 ? (
          <p className={pm.drillEmpty}>No QA decisions in this period.</p>
        ) : (
          <ul className={pm.drillList}>
            {person.qa.items.map((i) => (
              <li key={`${i.taskId}-${i.submittedAt}`}>
                <TaskLink id={i.taskId} /> {i.title}
                <span className={pm.tag}>{DECISION[i.decision] || i.decision}</span>
                {i.isFirstSubmission && <span className={pm.tag}>First submission</span>}
                {i.revertedFrom && <span className={pm.tag}>{`First ${i.revertedFrom}, reverted by PM`}</span>}
                {i.reviewType === 'peer' && <span className={pm.tag}>Peer Review</span>}
                <br />
                Submitted {formatDateTime(i.submittedAt, timeZone)} · decided {formatDateTime(i.decidedAt, timeZone)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function PerformanceMetricsSection({ projectId, to, role }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState({});

  useEffect(() => {
    const params = new URLSearchParams();
    if (projectId) params.set('projectId', projectId);
    if (to) params.set('to', to);
    setLoading(true);
    setError('');
    apiFetch(`/performance-metrics?${params.toString()}`)
      .then((d) => {
        setData(d);
        // A developer's own single row opens straight away.
        if (d.people.length === 1) setOpen({ [d.people[0].userId]: true });
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [projectId, to]);

  const counts = { ok: 0, needs_attention: 0, not_enough_data: 0 };
  for (const p of data?.people ?? []) counts[p.status] += 1;
  const s = data?.settings;
  const single = data?.people.length === 1;

  return (
    <section className={`${styles.card} ${pm.section}`} aria-labelledby="perfMetricsHeading">
      <h2 id="perfMetricsHeading" className={pm.heading}>
        Performance metrics
      </h2>
      {loading && <LoadingState />}
      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}

      {!loading && data && (
        <>
          <p className={pm.meta}>
            {data.window.days} days ending {formatDate(data.window.to)} (from {formatDate(data.window.from)}), working days in{' '}
            {data.window.timeZone.replace(/_/g, ' ')}.
          </p>
          <p className={pm.meta}>
            History starts on {data.history.startsOn ? formatDate(data.history.startsOn) : '—'}
            {data.history.liveSince ? `, recorded live since ${formatDate(data.history.liveSince)}` : ', reconstructed from the audit log'}. QA history from{' '}
            {data.history.qaStartsOn ? formatDate(data.history.qaStartsOn) : '—'}.
          </p>
          <div className={pm.rules}>
            OK when: the Due date is set by the end of {s.dueDateWorkingDays === 1 ? 'the next working day' : `${s.dueDateWorkingDays} working days`} after
            assignment in {s.onTimeOkPercent}% or more of cases · {s.changesOkPerTask} or fewer Due date changes per task · QA acceptance{' '}
            {s.qaAcceptanceOkPercent}% or more. Fewer than {s.minSample} tasks or submissions in the period shows &quot;Not enough data&quot;.{' '}
            {SETTINGS_ROLES.includes(role) && <Link href="/admin/performance-metrics-settings">Change settings</Link>}
          </div>

          {!single && (
            <div className={pm.counts} aria-label="People by status">
              <Badge tone="warning">Needs attention: {counts.needs_attention}</Badge>
              <Badge tone="success">OK: {counts.ok}</Badge>
              <Badge tone="neutral">Not enough data: {counts.not_enough_data}</Badge>
            </div>
          )}

          {data.people.length === 0 ? (
            <div className={styles.empty}>No people to show.</div>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <caption className="sr-only">Performance metrics per person</caption>
                <thead>
                  <tr>
                    <th scope="col">Person</th>
                    <th scope="col">Status</th>
                    <th scope="col">Date set on time</th>
                    <th scope="col">Due date changes</th>
                    <th scope="col">QA acceptance</th>
                    <th scope="col">First submission only</th>
                    <th scope="col">
                      <span className="sr-only">Details</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.people.map((p) => {
                    const isOpen = !!open[p.userId];
                    const drillId = `perf-drill-${p.userId}`;
                    return (
                      <Fragment key={p.userId}>
                        <tr>
                          <th scope="row" style={{ textAlign: 'left', fontWeight: 600 }}>
                            {p.fullName || p.email}
                          </th>
                          <td>
                            <StatusBadge status={p.status} />
                          </td>
                          <td>
                            <span className={pm.cellValue}>{percent(p.onTime.percent)}</span>
                            <span className={pm.cellSub}>
                              {p.onTime.onTime} of {p.onTime.counted} assignments
                            </span>
                            <span className={pm.cellStatus}>
                              <StatusBadge status={p.onTime.status} />
                            </span>
                          </td>
                          <td>
                            <span className={pm.cellValue}>{p.dueChanges.perTask ?? '—'} per task</span>
                            <span className={pm.cellSub}>
                              {p.dueChanges.changes} on {p.dueChanges.tasks} tasks · {p.dueChanges.later} later, {p.dueChanges.earlier} earlier
                              {(p.dueChanges.notCharged?.changes ?? 0) > 0 && ` · ${p.dueChanges.notCharged.changes} by PM/Admin, not charged`}
                            </span>
                            <span className={pm.cellStatus}>
                              <StatusBadge status={p.dueChanges.status} />
                            </span>
                          </td>
                          <td>
                            <span className={pm.cellValue}>{percent(p.qa.acceptedPercent)} accepted</span>
                            <span className={pm.cellSub}>
                              {percent(p.qa.rejectedPercent)} rejected · {p.qa.decided} decided
                            </span>
                            <span className={pm.cellStatus}>
                              <StatusBadge status={p.qa.status} />
                            </span>
                          </td>
                          <td>
                            <span className={pm.cellValue}>{percent(p.qa.firstSubmission.acceptedPercent)} accepted</span>
                            <span className={pm.cellSub}>
                              {percent(p.qa.firstSubmission.rejectedPercent)} rejected · {p.qa.firstSubmission.decided} decided
                            </span>
                          </td>
                          <td>
                            <button
                              type="button"
                              className={pm.toggle}
                              aria-expanded={isOpen}
                              aria-controls={drillId}
                              onClick={() => setOpen({ ...open, [p.userId]: !isOpen })}
                            >
                              {isOpen ? 'Hide tasks' : 'Show tasks'}
                              <span className="sr-only"> for {p.fullName || p.email}</span>
                            </button>
                          </td>
                        </tr>
                        {isOpen && (
                          <tr id={drillId}>
                            <td colSpan={7} style={{ whiteSpace: 'normal' }}>
                              <DrillDown person={p} names={data.names} timeZone={data.window.timeZone} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
