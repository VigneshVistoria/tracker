import { useEffect, useState } from 'react';
import AppShell from './AppShell';
import issueStyles from '../styles/issues.module.css';
import styles from '../styles/dashboard.module.css';
import { apiFetch } from '../lib/api';
import { todayISO, computeDeveloperTaskStats } from '../lib/developerTaskStats';
import { TaskRow, TicketRow, CardList } from './TaskCardRows';

// Developer-only Dashboard (confirmed with the user 2026-09): replaces
// the generic Issues-based stat cards from DefaultDashboard
// (pages/dashboard.js) with 5 cards built entirely from data the app
// already fetches elsewhere - My Tasks (/tasks/mine, same as
// pages/tasks/mine.js), Dependency Clearance's own "Outbound" queue
// (/task-dependency-tickets/mine, same as pages/dependency-clearance),
// and a new mirror-image "Inbound" endpoint
// (/task-dependency-tickets/created-by-me) for tickets this Developer
// filed because they're blocked on someone else. No new backend
// aggregation - counts are computed client-side from these 3 fetches,
// same pattern DefaultDashboard already uses for its Issues counts.
export default function DeveloperDashboard({ user }) {
  const [tasks, setTasks] = useState([]);
  const [outbound, setOutbound] = useState([]);
  const [inbound, setInbound] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    setLoading(true);
    setError('');
    Promise.all([
      apiFetch('/tasks/mine'),
      apiFetch('/task-dependency-tickets/mine'),
      apiFetch('/task-dependency-tickets/created-by-me'),
    ])
      .then(([taskList, outboundList, inboundList]) => {
        setTasks(taskList);
        setOutbound(outboundList);
        setInbound(inboundList);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const { rejectedTasks, overdueTasks, overdueOutbound, overdueCount } = computeDeveloperTaskStats(tasks, outbound, todayISO());

  const cards = [
    {
      key: 'myTasks',
      label: 'My Tasks',
      count: tasks.length,
      content: <CardList items={tasks.map((t) => <TaskRow key={t.id} task={t} />)} emptyText="No tasks assigned to you yet." />,
    },
    {
      key: 'rejected',
      label: 'Rejected',
      count: rejectedTasks.length,
      content: <CardList items={rejectedTasks.map((t) => <TaskRow key={t.id} task={t} />)} emptyText="Nothing sent back from QA right now." />,
    },
    {
      key: 'inbound',
      label: 'Inbound',
      count: inbound.length,
      content: (
        <CardList
          items={inbound.map((t) => <TicketRow key={t.id} ticket={t} subtitle={`Waiting on ${t.ownerEmail}`} />)}
          emptyText="You have no open dependencies on anyone else."
        />
      ),
    },
    {
      key: 'outbound',
      label: 'Outbound',
      count: outbound.length,
      content: (
        <CardList
          items={outbound.map((t) => <TicketRow key={t.id} ticket={t} subtitle={`Filed by ${t.createdByEmail}`} />)}
          emptyText="No one is waiting on you to clear a dependency right now."
        />
      ),
    },
    {
      key: 'overdue',
      label: 'Overdue',
      count: overdueCount,
      content: (
        <CardList
          items={[
            ...overdueTasks.map((t) => <TaskRow key={`task-${t.id}`} task={t} />),
            ...overdueOutbound.map((t) => (
              <TicketRow key={`ticket-${t.id}`} ticket={t} subtitle={`Filed by ${t.createdByEmail}`} />
            )),
          ]}
          emptyText="Nothing overdue right now."
        />
      ),
    },
  ];

  // Only show cards for counts of 1+ - the dashboard shrinks when
  // nothing's urgent and expands to show exactly what needs action.
  // Still shown while loading (count is 0 by default until the fetch
  // resolves) so the grid doesn't flash empty-then-populated.
  const visibleCards = loading ? cards : cards.filter((c) => c.count > 0);
  const activeCard = visibleCards.find((c) => c.key === expanded);
  const allCaughtUp = !loading && visibleCards.length === 0;

  return (
    <AppShell>
      <div className={issueStyles.pageHeader}>
        <div>
          <h1 className={issueStyles.pageTitle}>
            Welcome{user.fullName ? `, ${user.fullName.split(' ')[0]}` : ''}
          </h1>
          <p className={issueStyles.pageSubtitle}>Here&rsquo;s what&rsquo;s on your plate right now.</p>
        </div>
      </div>

      {error && <div className={issueStyles.error}>{error}</div>}

      {allCaughtUp ? (
        <div className={issueStyles.card}>
          <div className={issueStyles.empty}>You&rsquo;re all caught up! Nothing needs your attention right now.</div>
        </div>
      ) : (
        <div className={styles.statsGrid}>
          {visibleCards.map((card) => (
            <button
              key={card.key}
              type="button"
              className={styles.statCardButton}
              aria-expanded={expanded === card.key}
              onClick={() => setExpanded((prev) => (prev === card.key ? null : card.key))}
            >
              <div
                className={`${styles.statCard} ${styles.statCardCompact} ${expanded === card.key ? styles.expanded : ''}`}
              >
                <div className={`${styles.statValue} ${styles.statValueCompact}`}>{loading ? '–' : card.count}</div>
                <div className={`${styles.statLabel} ${styles.statLabelCompact}`}>{card.label}</div>
              </div>
            </button>
          ))}
        </div>
      )}

      {activeCard && (
        <>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>{activeCard.label}</h2>
          </div>
          {loading ? <div className={issueStyles.empty}>Loading...</div> : activeCard.content}
        </>
      )}
    </AppShell>
  );
}
