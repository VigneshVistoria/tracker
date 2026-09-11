import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import {
  Hash, CalendarDays, FileText, CalendarClock, Clock, Link2, PercentCircle, Hourglass, User,
  ChevronDown, ChevronUp, ChevronLeft, ChevronRight,
} from 'lucide-react';
import Table from './ui/Table';
import ColHeader from './ColHeader';
import styles from '../styles/issues.module.css';
import dashboardStyles from '../styles/dashboard.module.css';
import { yesterdayISO } from '../lib/developerTaskStats';
import { LEGEND_ITEMS, buildRowTintClass, selectableStatuses } from '../lib/taskTableShared';
import { apiFetch } from '../lib/api';

// Team Tasks - every team member's assigned tasks in one place, for
// Admin/Executive/Program Manager. Modeled directly on
// DeveloperTaskWorkboard (My Tasks): same icon-header/sortable table
// (components/ui/Table), same row-tint-by-status + legend, same "hide
// completed by default" toggle, same stat-cards-as-filter-presets pattern.
//
// The one structural difference: My Tasks fetches its (necessarily small,
// one-person) task list once and does all filtering/sorting/"pagination"
// (there is none) client-side. Team Tasks spans every assignee in the
// tenant, so filtering, the stat card counts, and pagination itself all
// happen server-side (GET /tasks/team) - every filter change or page
// change here triggers a re-fetch instead of a client-side recompute.
// Sorting is the one thing that stays client-side, exactly like My
// Tasks - it applies only within whichever page is currently loaded,
// the standard trade-off for a paginated table.

const PAGE_SIZE = 50;

const ROW_TINT_CLASS = buildRowTintClass(styles);

// Keys match TeamTasksResult.statCounts exactly (TasksService.findTeam) -
// 'total' rather than 'all', since it's a count field there, not a filter
// preset key.
const CARD_DEFS = [
  { key: 'total', label: 'Team Tasks' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'openDependency', label: 'Open Dependency' },
  { key: 'overdue', label: 'Overdue' },
];

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

export default function TeamTaskWorkboard({ storageKey }) {
  const router = useRouter();

  const [activeCard, setActiveCard] = useState(null);

  const [statusFilter, setStatusFilter] = useState('All');
  const [dependencyFilter, setDependencyFilter] = useState('All');
  const [assigneeFilter, setAssigneeFilter] = useState('All');
  const [dueFrom, setDueFrom] = useState('');
  const [dueTo, setDueTo] = useState('');
  const [showCompleted, setShowCompleted] = useState(false);
  const [page, setPage] = useState(1);

  const [tasks, setTasks] = useState([]);
  const [total, setTotal] = useState(0);
  const [statCounts, setStatCounts] = useState({ total: 0, rejected: 0, openDependency: 0, overdue: 0 });
  const [assignees, setAssignees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const showCompletedStorageKey = `${storageKey}ShowCompleted`;

  useEffect(() => {
    const stored = localStorage.getItem(storageKey);
    if (stored) setActiveCard(stored);
    setShowCompleted(localStorage.getItem(showCompletedStorageKey) === 'true');
    // storageKey is a static prop per page, not expected to change at runtime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('pageSize', String(PAGE_SIZE));
    if (statusFilter !== 'All') params.set('status', statusFilter);
    if (dependencyFilter !== 'All') params.set('dependency', dependencyFilter);
    if (assigneeFilter !== 'All') params.set('assigneeUserId', assigneeFilter);
    if (dueFrom) params.set('dueFrom', dueFrom);
    if (dueTo) params.set('dueTo', dueTo);
    if (showCompleted) params.set('showCompleted', 'true');

    let cancelled = false;
    setLoading(true);
    apiFetch(`/tasks/team?${params.toString()}`)
      .then((res) => {
        if (cancelled) return;
        setTasks(res.tasks);
        setTotal(res.total);
        setStatCounts(res.statCounts);
        setAssignees(res.assignees);
        setError('');
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [statusFilter, dependencyFilter, assigneeFilter, dueFrom, dueTo, showCompleted, page]);

  // Any filter change invalidates the current page - jumping back to
  // page 1 avoids landing on a now out-of-range page (e.g. page 3 of a
  // filter that now only has 1 page of results).
  useEffect(() => {
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, dependencyFilter, assigneeFilter, dueFrom, dueTo, showCompleted]);

  const handleShowCompletedChange = (checked) => {
    setShowCompleted(checked);
    localStorage.setItem(showCompletedStorageKey, String(checked));
  };

  const statusOptions = selectableStatuses(showCompleted);
  // Same guard My Tasks applies: don't let a "completed" status stay
  // selected once completed tasks are hidden, or the table gets stuck
  // empty with no visible way back.
  useEffect(() => {
    if (!showCompleted && statusFilter !== 'All' && !statusOptions.includes(statusFilter)) {
      setStatusFilter('All');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCompleted]);

  const cards = useMemo(
    () => CARD_DEFS.map((c) => ({ ...c, count: statCounts[c.key] ?? 0, kind: 'table' })),
    [statCounts],
  );

  const handleCardClick = (card) => {
    setActiveCard((prev) => {
      const next = prev === card.key ? null : card.key;
      localStorage.setItem(storageKey, next || '');
      return next;
    });
    if (card.key === 'total') {
      setStatusFilter('All'); setDependencyFilter('All'); setDueFrom(''); setDueTo('');
    } else if (card.key === 'rejected') {
      setStatusFilter('Failed'); setDependencyFilter('All'); setDueFrom(''); setDueTo('');
    } else if (card.key === 'openDependency') {
      setStatusFilter('All'); setDependencyFilter('Yes'); setDueFrom(''); setDueTo('');
    } else if (card.key === 'overdue') {
      setStatusFilter('All'); setDependencyFilter('All'); setDueTo(yesterdayISO());
    }
  };

  const handleGenericToggle = () => {
    setActiveCard((prev) => {
      const next = prev ? null : 'total';
      localStorage.setItem(storageKey, next || '');
      return next;
    });
  };

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
        key: 'assigneeEmail',
        header: <ColHeader icon={User} label="Assignee" />,
        sortable: true,
        render: (t) => t.assigneeEmail || '—',
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
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
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
              <div className={`${dashboardStyles.statValue} ${dashboardStyles.statValueCompact}`}>{loading ? '–' : card.count}</div>
              <div className={`${dashboardStyles.statLabel} ${dashboardStyles.statLabelCompact}`}>{card.label}</div>
            </div>
          </button>
        ))}
      </div>

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

      {error && <div className={styles.error}>{error}</div>}

      {activeCard && activeCardDef && (
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
              <label className={styles.filterLabel} htmlFor="teamAssigneeFilter">Assignee</label>
              <select
                id="teamAssigneeFilter"
                className={styles.filterSelect}
                value={assigneeFilter}
                onChange={(e) => setAssigneeFilter(e.target.value)}
              >
                <option value="All">All</option>
                {assignees.map((a) => (
                  <option key={a.id} value={a.id}>{a.fullName || a.email}</option>
                ))}
              </select>
            </div>

            <div className={styles.filterGroup}>
              <label className={styles.filterLabel} htmlFor="teamStatusFilter">Status</label>
              <select
                id="teamStatusFilter"
                className={styles.filterSelect}
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="All">All</option>
                {statusOptions.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            <div className={styles.filterGroup}>
              <label className={styles.filterLabel} htmlFor="teamDependencyFilter">Dependency</label>
              <select
                id="teamDependencyFilter"
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
              <label className={styles.filterLabel} htmlFor="teamDueFrom">Due from</label>
              <input
                id="teamDueFrom"
                type="date"
                className={styles.filterSelect}
                value={dueFrom}
                onChange={(e) => setDueFrom(e.target.value)}
              />
            </div>

            <div className={styles.filterGroup}>
              <label className={styles.filterLabel} htmlFor="teamDueTo">Due to</label>
              <input
                id="teamDueTo"
                type="date"
                className={styles.filterSelect}
                value={dueTo}
                onChange={(e) => setDueTo(e.target.value)}
              />
            </div>
          </div>

          <Table
            columns={columns}
            rows={tasks}
            getRowId={(t) => t.id}
            onRowClick={(t) => router.push(`/tasks/${t.id}`)}
            rowClassName={(t) => ROW_TINT_CLASS[t.status] || ''}
            emptyState={loading ? 'Loading...' : 'No tasks match these filters.'}
          />

          <div className={styles.filterBar} style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <span className={styles.issueMeta}>
              {total === 0 ? '0 tasks' : `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total}`}
            </span>
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <button
                type="button"
                className={`${styles.button} ${styles.buttonSecondary}`}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || loading}
              >
                <ChevronLeft size={16} aria-hidden="true" />
                Previous
              </button>
              <button
                type="button"
                className={`${styles.button} ${styles.buttonSecondary}`}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages || loading}
              >
                Next
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
