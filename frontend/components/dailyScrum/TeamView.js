import Link from 'next/link';
import { AlertTriangle, CalendarCheck, CheckCircle2, Hourglass, ListTodo, Siren, Users } from 'lucide-react';
import Badge from '../ui/Badge';
import StatCard from '../ui/StatCard';
import { formatDate } from '../../lib/formatDate';
import { roleLabel } from '../../lib/status';
import { statusBadgeStyle } from '../../lib/taskTableShared';
import { REASON_LABELS } from './ScrumPersonView';
import ExternalWaitsBox from './ExternalWaitsBox';
import styles from '../../styles/dailyScrum.module.css';

// Daily Scrum Stage 3 - the Team tab (PM/Executive/Admin, GET
// /daily-scrum/team). Every number is the API's: the totals, "Needs your
// attention" (each blocker once, under its assignee) and the "Totals
// match" check all come from the same computeDailyScrum() output.

const REASON_TONE = { sent_back: 'error', blocking_defect: 'error', overdue: 'error', waiting_on_dependency: 'warning', intervention: 'warning' };

function TotalsCheck({ team }) {
  const t = team.totals;
  const sum = `${t.today} today + ${t.blockers} blockers + ${t.withReviewers} with reviewers`;
  return (
    <p className={`${styles.totalsCheck} ${team.totalsMatch ? styles.totalsOk : styles.totalsBad}`} role="status">
      {team.totalsMatch ? <CheckCircle2 size={16} aria-hidden="true" /> : <AlertTriangle size={16} aria-hidden="true" />}
      <span>
        <strong>{team.totalsMatch ? 'Totals match' : 'Totals do not match'}</strong>
        {' - '}
        {sum} = {t.active} on the cards; {team.activeTicketCount} active tickets counted directly.
      </span>
    </p>
  );
}

function PersonCard({ person, onOpen }) {
  const c = person.counts;
  const reasons = {};
  for (const item of person.blockers) for (const r of item.reasons) reasons[r] = (reasons[r] || 0) + 1;
  return (
    <li className={styles.personCard}>
      <div className={styles.personCardHead}>
        <span className={styles.personName}>{person.name}</span>
        <span className={styles.personRole}>{roleLabel(person.role)}</span>
      </div>
      <dl className={styles.personCounts}>
        <div>
          <dt>Today</dt>
          <dd>{c.today}</dd>
        </div>
        <div className={c.blockers > 0 ? styles.countAlert : ''}>
          <dt>Blockers</dt>
          <dd>{c.blockers}</dd>
        </div>
        <div>
          <dt>With reviewers</dt>
          <dd>{c.withReviewers}</dd>
        </div>
        <div>
          <dt>Since</dt>
          <dd>{person.since.length}</dd>
        </div>
      </dl>
      {Object.keys(reasons).length > 0 && (
        <div className={styles.ticketTags}>
          {Object.entries(reasons).map(([r, n]) => (
            <Badge key={r} tone={REASON_TONE[r] || 'neutral'} dot>
              {REASON_LABELS[r] || r} {n}
            </Badge>
          ))}
        </div>
      )}
      {(person.waitingOnYou.length > 0 || person.peerReviewsToDo.length > 0) && (
        <p className={styles.ticketMeta}>
          {person.waitingOnYou.length > 0 && `${person.waitingOnYou.length} waiting on them`}
          {person.waitingOnYou.length > 0 && person.peerReviewsToDo.length > 0 && ' · '}
          {person.peerReviewsToDo.length > 0 && `${person.peerReviewsToDo.length} peer review${person.peerReviewsToDo.length === 1 ? '' : 's'} to do`}
        </p>
      )}
      <button type="button" className={styles.linkButton} onClick={() => onOpen(person.userId)} aria-label={`Open ${person.name}'s summary`}>
        Open summary
      </button>
    </li>
  );
}

export default function TeamView({ team, waits, canEditWaits, showResolved, onToggleResolved, onWaitsChanged, onOpenPerson }) {
  const t = team.totals;
  return (
    <div className={styles.person}>
      <div className={styles.stats}>
        <StatCard label="Today" value={t.today} icon={ListTodo} accent="primary" />
        <StatCard label="Blockers" value={t.blockers} icon={AlertTriangle} accent={t.blockers > 0 ? 'error' : 'neutral'} />
        <StatCard label="With reviewers" value={t.withReviewers} icon={Hourglass} accent="warning" />
        <StatCard label="Active tickets" value={t.active} icon={CalendarCheck} accent="neutral" />
      </div>
      <TotalsCheck team={team} />

      <div className={styles.grid}>
        <section className={styles.section} aria-labelledby="scrum-attention">
          <h2 id="scrum-attention" className={styles.sectionTitle}>
            <Siren size={16} aria-hidden="true" />
            <span>Needs your attention</span>
            <span className={styles.sectionCount}>{team.needsAttention.length}</span>
          </h2>
          {team.needsAttention.length === 0 ? (
            <p className={styles.empty}>No blockers anywhere on the team.</p>
          ) : (
            <ul className={styles.tickets}>
              {team.needsAttention.map((item) => (
                <li key={item.taskId} className={styles.ticket}>
                  <div className={styles.ticketMain}>
                    <Link href={`/tasks/${item.taskId}`} className={styles.ticketLink}>
                      <span className={styles.ticketId}>#{item.taskId}</span> {item.title}
                    </Link>
                    <p className={styles.ticketMeta}>
                      <button type="button" className={styles.inlineLink} onClick={() => onOpenPerson(item.userId)}>
                        {item.name}
                      </button>
                      {' · '}
                      {item.projectName}
                      {' · '}Due {formatDate(item.dueDate)}
                    </p>
                  </div>
                  <div className={styles.ticketTags}>
                    <span className={styles.statusPill} style={statusBadgeStyle(item.status)}>
                      {item.status}
                    </span>
                    {item.reasons.map((r) => (
                      <Badge key={r} tone={REASON_TONE[r] || 'neutral'} dot>
                        {REASON_LABELS[r] || r}
                      </Badge>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {waits ? (
          <ExternalWaitsBox
            waits={waits}
            today={team.window.today}
            canEdit={canEditWaits}
            people={team.people}
            showResolved={showResolved}
            onToggleResolved={onToggleResolved}
            onChanged={onWaitsChanged}
          />
        ) : (
          <section className={styles.section} aria-label="Waiting on the city office">
            <p className={styles.empty}>Couldn&apos;t load the city office list.</p>
          </section>
        )}
      </div>

      <section aria-labelledby="scrum-people">
        <h2 id="scrum-people" className={`${styles.sectionTitle} ${styles.peopleHeading}`}>
          <Users size={16} aria-hidden="true" />
          <span>People</span>
          <span className={styles.sectionCount}>{team.people.length}</span>
        </h2>
        {team.people.length === 0 ? (
          <p className={styles.empty}>No Developers, Designers, DevOps or QA in this team yet.</p>
        ) : (
          <ul className={styles.personGrid}>
            {team.people.map((p) => (
              <PersonCard key={p.userId} person={p} onOpen={onOpenPerson} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
