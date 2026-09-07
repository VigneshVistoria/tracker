import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import {
  Hash, CalendarDays, FileText, CalendarClock, Clock, Link2, PercentCircle, Hourglass,
  ChevronDown, ChevronUp,
} from 'lucide-react';
import AppShell from '../../components/AppShell';
import Table from '../../components/ui/Table';
import { TicketRow, CardList } from '../../components/TaskCardRows';
import styles from '../../styles/issues.module.css';
import dashboardStyles from '../../styles/dashboard.module.css';
import { apiFetch } from '../../lib/api';
import { todayISO, yesterdayISO, computeDeveloperTaskStats } from '../../lib/developerTaskStats';

const VIEW_ROLES = ['admin', 'executive', 'program_manager', 'qa', 'developer'];

// Remembers which stat card (if any) is expanded below the table, the
// same simple localStorage pattern lib/theme.js already uses for the
// theme preference - null (collapsed) if nothing's been stored yet.
const ACTIVE_CARD_STORAGE_KEY = 'myTasksActiveCard';

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

// Status is deliberately not its own column here (the 8-column spec has
// no room for it) - it's expressed purely as row background color,
// reusing the exact tint tokens the Status badge uses everywhere else
// (mine.js's old StatusBadge, tasks/[id].js) so the color language stays
// consistent. Development has no entry - neutral/no highlight.
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

export default function MyTasksPage() {
  const router = useRouter();

  const [user, setUser] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [outbound, setOutbound] = useState([]);
  const [inbound, setInbound] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // null = collapsed. Otherwise the key of whichever stat card is driving
  // the expanded view below - every card shows the filtered task table
  // (kind: 'table') except Outbound (kind: 'list'), which shows its own
  // ticket list instead since Outbound tickets live on someone else's
  // task, not a row in this table.
  const [activeCard, setActiveCard] = useState(null);

  const [statusFilter, setStatusFilter] = useState('All');
  const [dependencyFilter, setDependencyFilter] = useState('All');
  const [dueFrom, setDueFrom] = useState('');
  const [dueTo, setDueTo] = useState('');

  useEffect(() => {
    const stored = localStorage.getItem(ACTIVE_CARD_STORAGE_KEY);
    if (stored) setActiveCard(stored);
  }, []);

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (!storedUser) {
      router.replace('/');
      return;
    }
    const parsed = JSON.parse(storedUser);
    if (!VIEW_ROLES.includes(parsed.role)) {
      router.replace('/dashboard');
      return;
    }
    setUser(parsed);
    setLoading(true);
    const isDeveloper = parsed.role === 'developer';
    Promise.all([
      apiFetch('/tasks/mine'),
      isDeveloper ? apiFetch('/task-dependency-tickets/mine') : Promise.resolve([]),
      isDeveloper ? apiFetch('/task-dependency-tickets/created-by-me') : Promise.resolve([]),
    ])
      .then(([taskList, outboundList, inboundList]) => {
        setTasks(taskList);
        setOutbound(outboundList);
        setInbound(inboundList);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [router]);

  const { rejectedTasks, overdueCount } = computeDeveloperTaskStats(tasks, outbound, todayISO());

  const cards = useMemo(
    () => [
      { key: 'myTasks', label: 'My Tasks', count: tasks.length, kind: 'table' },
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
    [tasks, rejectedTasks, inbound, outbound, overdueCount],
  );

  const handleCardClick = (card) => {
    setActiveCard((prev) => {
      const next = prev === card.key ? null : card.key;
      localStorage.setItem(ACTIVE_CARD_STORAGE_KEY, next || '');
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
      localStorage.setItem(ACTIVE_CARD_STORAGE_KEY, next || '');
      return next;
    });
  };

  // "Overdue" excludes 'Pass' the same way computeDeveloperTaskStats does
  // for its overdueTasks count - the dueTo=yesterday filter above only
  // covers the date half, so this adds the same status exclusion back in
  // when Overdue is the active card.
  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
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
  }, [tasks, statusFilter, dependencyFilter, dueFrom, dueTo, activeCard]);

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

  if (!user) return null;

  const isDeveloper = user.role === 'developer';
  const activeCardDef = cards.find((c) => c.key === activeCard);

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>My Tasks</h1>
          <p className={styles.pageSubtitle}>
            Tasks assigned to you. Open a task to set Estimated Hours and Due Date, and file a Dependency
            Ticket if you&apos;re blocked.
          </p>
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {loading && <div className={styles.empty}>Loading...</div>}

      {!loading && (
        <>
          {isDeveloper && (
            <div className={dashboardStyles.statsGrid}>
              {cards.map((card) => (
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
                    <div className={`${dashboardStyles.statValue} ${dashboardStyles.statValueCompact}`}>{card.count}</div>
                    <div className={`${dashboardStyles.statLabel} ${dashboardStyles.statLabelCompact}`}>{card.label}</div>
                  </div>
                </button>
              ))}
            </div>
          )}

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
              {activeCardDef.content}
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
                    {TASK_STATUSES.map((s) => (
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
                emptyState={tasks.length === 0 ? 'No tasks assigned to you yet.' : 'No tasks match these filters.'}
              />
            </>
          )}
        </>
      )}
    </AppShell>
  );
}
