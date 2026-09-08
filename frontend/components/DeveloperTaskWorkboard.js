import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import {
  Hash, CalendarDays, FileText, CalendarClock, Clock, Link2, PercentCircle, Hourglass,
  ChevronDown, ChevronUp,
} from 'lucide-react';
import Table from './ui/Table';
import { TicketRow, CardList } from './TaskCardRows';
import styles from '../styles/issues.module.css';
import dashboardStyles from '../styles/dashboard.module.css';
import { todayISO, yesterdayISO, computeDeveloperTaskStats } from '../lib/developerTaskStats';

// Shared by the My Tasks page (pages/tasks/mine.js) and the Developer
// Dashboard (components/DeveloperDashboard.js): the stat cards (My Tasks/
// Rejected/Inbound/Outbound/Overdue), the collapsible icon-header/
// sortable/filterable task table those cards expand into, and the
// Outbound ticket list (Outbound tickets live on someone else's task, so
// they don't fit as rows in this table - same as before).

// Mirrors TASK_STATUSES on the backend (task-status-percent.entity.ts) -
// the two Released statuses are dormant (no code path sets them anymore)
// but existing tasks can still carry one, so they stay selectable here.
const TASK_STATUSES = [
  'Development',
  'Feedback',
  'Re-Feedback',
  'Failed',
  'Pass',
  'Released - No Showstoppers',
  'Released - With Showstoppers',
];

// Tasks in these statuses are done - they stay in the table forever
// (nothing ever deletes/archives a task), which is why "My Tasks" was
// creeping upward for long-tenured developers with no way back down.
// Hidden by default; the "Show completed tasks" toggle below reveals them.
const COMPLETED_STATUSES = ['Pass', 'Released - No Showstoppers', 'Released - With Showstoppers'];

// Status is deliberately not its own column here (the 8-column spec has
// no room for it) - it's expressed purely as row background color,
// reusing the exact tint tokens the Status badge uses everywhere else so
// the color language stays consistent. Development has no entry - it's
// the neutral/no-highlight baseline.
const ROW_TINT_CLASS = {
  Feedback: styles.rowTintPlum,
  'Re-Feedback': styles.rowTintPlum,
  Pass: styles.rowTintMoss,
  Failed: styles.rowTintRed,
  'Released - With Showstoppers': styles.rowTintRed,
  'Released - No Showstoppers': styles.rowTintTeal,
};

const LEGEND_ITEMS = [
  { label: 'Development', swatch: 'var(--color-slate-tint)' },
  { label: 'Feedback / Re-Feedback', swatch: 'var(--color-plum-tint)' },
  { label: 'Pass', swatch: 'var(--color-moss-tint)' },
  { label: 'Failed / Released - With Showstoppers', swatch: 'var(--color-red-tint)' },
  { label: 'Released - No Showstoppers', swatch: 'var(--color-teal-tint)' },
];

function ColHeader({ icon: Icon, label }) {
  return (
    <span className={styles.colHeaderIcon} title={label} aria-label={label}>
      <Icon size={15} aria-hidden="true" />
    </span>
  );
}

function ProgressBar({ percent }) {
  if (percent === null || percent === undefined) {
    return <span className={styles.issueMeta}>—</span>;
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
      <div style={{ width: 80, height: 8, borderRadius: 4, background: 'var(--color-slate-tint)', overflow: 'hidden' }}>
        <div style={{ width: `${percent}%`, height: '100%', background: 'var(--color-teal)' }} />
      </div>
      <span style={{ fontSize: '0.85rem', color: 'var(--color-ink-soft)' }}>{percent}%</span>
    </div>
  );
}

export default function DeveloperTaskWorkboard({
  tasks,
  outbound,
  inbound,
  loading,
  storageKey,
  showCards = true,
  hideEmptyCards = false,
}) {
  const router = useRouter();

  // null = collapsed. Otherwise the key of whichever stat card is driving
  // the expanded view below - every card shows the filtered task table
  // (kind: 'table') except Outbound (kind: 'list').
  const [activeCard, setActiveCard] = useState(null);

  const [statusFilter, setStatusFilter] = useState('All');
  const [dependencyFilter, setDependencyFilter] = useState('All');
  const [dueFrom, setDueFrom] = useState('');
  const [dueTo, setDueTo] = useState('');
  const [showCompleted, setShowCompleted] = useState(false);

  const showCompletedStorageKey = `${storageKey}ShowCompleted`;

  useEffect(() => {
    const stored = localStorage.getItem(storageKey);
    if (stored) setActiveCard(stored);
    setShowCompleted(localStorage.getItem(showCompletedStorageKey) === 'true');
    // storageKey is a static prop per page, not expected to change at runtime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleShowCompletedChange = (checked) => {
    setShowCompleted(checked);
    localStorage.setItem(showCompletedStorageKey, String(checked));
    // Otherwise turning the toggle off while filtered to e.g. "Pass" leaves
    // the table stuck empty with no visible way back.
    if (!checked && COMPLETED_STATUSES.includes(statusFilter)) setStatusFilter('All');
  };

  // The table's whole dataset - every other computation below (card
  // counts, Rejected/Overdue, the filter bar) reads from this, not the
  // raw `tasks` prop, so hiding completed tasks by default actually
  // shrinks what "My Tasks" means rather than just hiding table rows.
  const visibleTasks = useMemo(
    () => (showCompleted ? tasks : tasks.filter((t) => !COMPLETED_STATUSES.includes(t.status))),
    [tasks, showCompleted],
  );

  const { rejectedTasks, overdueCount } = computeDeveloperTaskStats(visibleTasks, outbound, todayISO());

  const cards = useMemo(
    () => [
      { key: 'myTasks', label: 'My Tasks', count: visibleTasks.length, kind: 'table' },
      { key: 'rejected', label: 'Rejected', count: rejectedTasks.length, kind: 'table' },
      { key: 'inbound', label: 'Inbound', count: inbound.length, kind: 'table' },
      {
        key: 'outbound',
        label: 'Outbound',
        count: outbound.length,
        kind: 'list',
        content: (
          <CardList
            items={outbound.map((t) => <TicketRow key={t.id} ticket={t} subtitle={`Filed by ${t.createdByEmail}`} />)}
            emptyText="No one is waiting on you to clear a dependency right now."
          />
        ),
      },
      { key: 'overdue', label: 'Overdue', count: overdueCount, kind: 'table' },
    ],
    [visibleTasks, rejectedTasks, inbound, outbound, overdueCount],
  );

  const visibleCards = hideEmptyCards ? (loading ? cards : cards.filter((c) => c.count > 0)) : cards;
  const allCaughtUp = hideEmptyCards && !loading && visibleCards.length === 0;

  const handleCardClick = (card) => {
    setActiveCard((prev) => {
      const next = prev === card.key ? null : card.key;
      localStorage.setItem(storageKey, next || '');
      return next;
    });
    if (card.key === 'myTasks') {
      setStatusFilter('All'); setDependencyFilter('All'); setDueFrom(''); setDueTo('');
    } else if (card.key === 'rejected') {
      setStatusFilter('Failed'); setDependencyFilter('All'); setDueFrom(''); setDueTo('');
    } else if (card.key === 'inbound') {
      setStatusFilter('All'); setDependencyFilter('Yes'); setDueFrom(''); setDueTo('');
    } else if (card.key === 'overdue') {
      setStatusFilter('All'); setDependencyFilter('All'); setDueFrom(''); setDueTo(yesterdayISO());
    }
  };

  const handleGenericToggle = () => {
    setActiveCard((prev) => {
      const next = prev ? null : 'myTasks';
      localStorage.setItem(storageKey, next || '');
      return next;
    });
  };

  // "Overdue" excludes 'Pass' the same way computeDeveloperTaskStats does
  // for its overdueTasks count - the dueTo=yesterday filter above only
  // covers the date half, so this adds the same status exclusion back in
  // when Overdue is the active card.
  const filteredTasks = useMemo(() => {
    return visibleTasks.filter((task) => {
      if (statusFilter !== 'All' && task.status !== statusFilter) return false;
      if (dependencyFilter !== 'All') {
        const wantsYes = dependencyFilter === 'Yes';
        if (Boolean(task.hasOpenDependency) !== wantsYes) return false;
      }
      if (dueFrom && (!task.dueDate || task.dueDate < dueFrom)) return false;
      if (dueTo && (!task.dueDate || task.dueDate > dueTo)) return false;
      if (activeCard === 'overdue' && task.status === 'Pass') return false;
      return true;
    });
  }, [visibleTasks, statusFilter, dependencyFilter, dueFrom, dueTo, activeCard]);

  // Only offer statuses that can actually appear in visibleTasks right now -
  // with completed tasks hidden, picking "Pass" from the dropdown would
  // otherwise always dead-end on an empty table.
  const selectableStatuses = showCompleted
    ? TASK_STATUSES
    : TASK_STATUSES.filter((s) => !COMPLETED_STATUSES.includes(s));

  const columns = useMemo(
    () => [
      {
        key: 'id',
        header: <ColHeader icon={Hash} label="Ticket ID" />,
        width: 70,
        sortable: true,
        render: (t) => (
          <Link href={`/tasks/${t.id}`} className={styles.issueId} onClick={(e) => e.stopPropagation()}>
            #{t.id}
          </Link>
        ),
      },
      {
        key: 'createdAt',
        header: <ColHeader icon={CalendarDays} label="Created Date" />,
        sortable: true,
        render: (t) => new Date(t.createdAt).toLocaleDateString(),
      },
      {
        key: 'description',
        header: <ColHeader icon={FileText} label="Description" />,
        sortable: true,
        render: (t) => (
          <span className={styles.descClamp} title={t.description}>
            {t.description}
          </span>
        ),
      },
      {
        key: 'dueDate',
        header: <ColHeader icon={CalendarClock} label="Due Date" />,
        sortable: true,
        render: (t) => t.dueDate || '—',
      },
      {
        key: 'estimatedHours',
        header: <ColHeader icon={Clock} label="Estimated Hours" />,
        sortable: true,
        align: 'right',
        // estimatedHours is a Postgres `decimal` column, which TypeORM
        // returns as a string (e.g. "5.00") - compare numerically instead
        // of falling into Table's default string sort, which would put
        // "10.00" before "9.00".
        sortAccessor: (t) => (t.estimatedHours == null ? null : Number(t.estimatedHours)),
        render: (t) => (t.estimatedHours == null ? '—' : t.estimatedHours),
      },
      {
        key: 'hasOpenDependency',
        header: <ColHeader icon={Link2} label="Dependency" />,
        sortable: true,
        render: (t) => (t.hasOpenDependency ? 'Yes' : 'No'),
      },
      {
        key: 'percentComplete',
        header: <ColHeader icon={PercentCircle} label="Completed %" />,
        sortable: true,
        render: (t) => <ProgressBar percent={t.percentComplete} />,
      },
      {
        key: 'ageingDays',
        header: <ColHeader icon={Hourglass} label="Ageing" />,
        sortable: true,
        align: 'right',
        render: (t) => `${t.ageingDays}d`,
      },
    ],
    [],
  );

  const activeCardDef = cards.find((c) => c.key === activeCard);

  if (allCaughtUp) {
    return (
      <div className={styles.card}>
        <div className={styles.empty}>You&rsquo;re all caught up! Nothing needs your attention right now.</div>
      </div>
    );
  }

  return (
    <>
      {showCards && (
        <div className={dashboardStyles.statsGrid}>
          {visibleCards.map((card) => (
            <button
              key={card.key}
              type="button"
              className={dashboardStyles.statCardButton}
              aria-expanded={activeCard === card.key}
              onClick={() => handleCardClick(card)}
            >
              <div
                className={`${dashboardStyles.statCard} ${dashboardStyles.statCardCompact} ${activeCard === card.key ? dashboardStyles.expanded : ''}`}
              >
                <div className={`${dashboardStyles.statValue} ${dashboardStyles.statValueCompact}`}>{loading ? '–' : card.count}</div>
                <div className={`${dashboardStyles.statLabel} ${dashboardStyles.statLabelCompact}`}>{card.label}</div>
              </div>
            </button>
          ))}
        </div>
      )}

      <label className={styles.checkboxRow}>
        <input
          type="checkbox"
          checked={showCompleted}
          onChange={(e) => handleShowCompletedChange(e.target.checked)}
        />
        Show completed tasks (Pass / Released)
      </label>

      <button
        type="button"
        className={`${styles.button} ${styles.buttonSecondary}`}
        onClick={handleGenericToggle}
        style={{ marginBottom: 'var(--space-4)' }}
      >
        {activeCard ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
        {activeCard ? 'Hide detailed table' : 'Show detailed table'}
      </button>

      {activeCard && activeCardDef?.kind === 'list' && (
        <>
          <div className={dashboardStyles.sectionHeader}>
            <h2 className={dashboardStyles.sectionTitle}>{activeCardDef.label}</h2>
          </div>
          {loading ? <div className={styles.empty}>Loading...</div> : activeCardDef.content}
        </>
      )}

      {activeCard && activeCardDef?.kind === 'table' && (
        <>
          <div className={styles.statusLegend}>
            {LEGEND_ITEMS.map((item) => (
              <span key={item.label} className={styles.statusLegendItem}>
                <span className={styles.statusLegendDot} style={{ background: item.swatch }} />
                {item.label}
              </span>
            ))}
          </div>

          <div className={styles.filterBar}>
            <div className={styles.filterGroup}>
              <label className={styles.filterLabel} htmlFor="statusFilter">Status</label>
              <select
                id="statusFilter"
                className={styles.filterSelect}
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="All">All</option>
                {selectableStatuses.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            <div className={styles.filterGroup}>
              <label className={styles.filterLabel} htmlFor="dependencyFilter">Dependency</label>
              <select
                id="dependencyFilter"
                className={styles.filterSelect}
                value={dependencyFilter}
                onChange={(e) => setDependencyFilter(e.target.value)}
              >
                <option value="All">All</option>
                <option value="Yes">Yes</option>
                <option value="No">No</option>
              </select>
            </div>

            <div className={styles.filterGroup}>
              <label className={styles.filterLabel} htmlFor="dueFrom">Due from</label>
              <input
                id="dueFrom"
                type="date"
                className={styles.filterSelect}
                value={dueFrom}
                onChange={(e) => setDueFrom(e.target.value)}
              />
            </div>

            <div className={styles.filterGroup}>
              <label className={styles.filterLabel} htmlFor="dueTo">Due to</label>
              <input
                id="dueTo"
                type="date"
                className={styles.filterSelect}
                value={dueTo}
                onChange={(e) => setDueTo(e.target.value)}
              />
            </div>
          </div>

          <Table
            columns={columns}
            rows={filteredTasks}
            getRowId={(t) => t.id}
            onRowClick={(t) => router.push(`/tasks/${t.id}`)}
            rowClassName={(t) => ROW_TINT_CLASS[t.status] || ''}
            emptyState={
              tasks.length === 0
                ? 'No tasks assigned to you yet.'
                : visibleTasks.length === 0
                  ? "All caught up - your completed tasks are hidden. Check \"Show completed tasks\" above to see them."
                  : 'No tasks match these filters.'
            }
          />
        </>
      )}
    </>
  );
}
