import { AlertTriangle, CheckCircle2, ChevronRight, Siren } from 'lucide-react';
import Avatar from '../ui/Avatar';
import { roleLabel } from '../../lib/status';
import { SummaryStrip } from './ScrumPersonView';
import TicketCard from './TicketCard';
import ExternalWaitsBox from './ExternalWaitsBox';
import styles from '../../styles/dailyScrum.module.css';

// Daily Scrum Stage 3 - the Team tab (PM/Executive/Admin, GET
// /daily-scrum/team). Every number is the API's: the totals, "Needs your
// attention" (each blocker once, under its assignee) and the "Totals
// match" check all come from the same computeDailyScrum() output.
// Laid out as a standup board - one row per person, in the order the
// scrum goes round - with the attention list and the city office beside it.

// Tickets shown per group in a row before "+N more".
const ROW_LIMIT = 3;

function TotalsCheck({ team }) {
  const t = team.totals;
  const detail = `${t.today} today + ${t.blockers} blockers + ${t.withReviewers} with reviewers = ${t.active}; ${team.activeTicketCount} active tickets counted directly.`;
  return (
    <p className={`${styles.totalsCheck} ${team.totalsMatch ? styles.totalsOk : styles.totalsBad}`} role="status" title={detail}>
      {team.totalsMatch ? <CheckCircle2 size={16} aria-hidden="true" /> : <AlertTriangle size={16} aria-hidden="true" />}
      <span>{team.totalsMatch ? 'Totals match' : 'Totals do not match'}</span>
      <span className="sr-only"> - {detail}</span>
    </p>
  );
}

function RowGroup({ label, items, tone, person, onOpen }) {
  const shown = items.slice(0, ROW_LIMIT);
  return (
    <div className={`${styles.rowGroup} ${styles[`column_${tone}`] || ''}`}>
      <p className={styles.rowGroupLabel}>
        {label} <span className={styles.count}>{items.length}</span>
      </p>
      {items.length === 0 ? (
        <p className={styles.rowEmpty}>None</p>
      ) : (
        <ul className={styles.cards}>
          {shown.map((item) => (
            <TicketCard key={item.taskId} item={item} compact />
          ))}
        </ul>
      )}
      {items.length > shown.length && (
        <button type="button" className={styles.textButton} onClick={() => onOpen(person.userId)}>
          +{items.length - shown.length} more
        </button>
      )}
    </div>
  );
}

function StandupRow({ person, onOpen }) {
  const extras = [];
  if (person.since.length) extras.push(`${person.since.length} update${person.since.length === 1 ? '' : 's'} since last working day`);
  if (person.waitingOnYou.length) extras.push(`${person.waitingOnYou.length} waiting on them`);
  if (person.peerReviewsToDo.length) extras.push(`${person.peerReviewsToDo.length} peer review${person.peerReviewsToDo.length === 1 ? '' : 's'} to do`);
  return (
    <li className={styles.row}>
      <div className={styles.rowHead}>
        <Avatar name={person.name} size="md" />
        <div className={styles.rowWho}>
          <span className={styles.rowName}>{person.name}</span>
          <span className={styles.rowRole}>
            {roleLabel(person.role)}
            {extras.length > 0 && ` · ${extras.join(' · ')}`}
          </span>
        </div>
        <button type="button" className={styles.openButton} onClick={() => onOpen(person.userId)} aria-label={`Open ${person.name}'s summary`}>
          Open <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>
      <div className={styles.rowGroups}>
        <RowGroup label="Today" tone="today" items={person.today} person={person} onOpen={onOpen} />
        <RowGroup label="Blockers" tone="blockers" items={person.blockers} person={person} onOpen={onOpen} />
        <RowGroup label="With reviewers" tone="reviewers" items={person.withReviewers} person={person} onOpen={onOpen} />
      </div>
    </li>
  );
}

export default function TeamView({ team, waits, canEditWaits, showResolved, onToggleResolved, onWaitsChanged, onOpenPerson }) {
  return (
    <div className={styles.stack}>
      <SummaryStrip counts={team.totals}>
        <TotalsCheck team={team} />
      </SummaryStrip>

      <div className={styles.teamLayout}>
        <section className={styles.teamMain} aria-labelledby="scrum-board">
          <h2 id="scrum-board" className={styles.panelTitle}>
            <span>Standup</span>
            <span className={styles.count}>{team.people.length}</span>
          </h2>
          {team.people.length === 0 ? (
            <p className={styles.empty}>No Developers, Designers, DevOps or QA in this team yet.</p>
          ) : (
            <ol className={styles.rows}>
              {team.people.map((p) => (
                <StandupRow key={p.userId} person={p} onOpen={onOpenPerson} />
              ))}
            </ol>
          )}
        </section>

        <aside className={styles.teamAside} aria-label="Attention and outside waits">
          <section className={styles.panel} aria-labelledby="scrum-attention">
            <h2 id="scrum-attention" className={styles.panelTitle}>
              <Siren size={16} aria-hidden="true" />
              <span>Needs your attention</span>
              <span className={`${styles.count} ${team.needsAttention.length ? styles.countAlert : ''}`}>{team.needsAttention.length}</span>
            </h2>
            {team.needsAttention.length === 0 ? (
              <p className={styles.empty}>No blockers anywhere on the team.</p>
            ) : (
              <ul className={`${styles.cards} ${styles.scrollList}`}>
                {team.needsAttention.map((item) => (
                  <TicketCard key={item.taskId} item={item} owner={item.name} compact />
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
            <section className={styles.panel} aria-label="Waiting on the city office">
              <p className={styles.empty}>Couldn&apos;t load the city office list.</p>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
