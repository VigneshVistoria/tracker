import { Fragment, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Hash, CalendarDays, FileText, CalendarClock, Clock, Link2, PercentCircle, Hourglass, User, Flag, Activity,
  ChevronDown, ChevronRight, ChevronLeft, List, LayoutGrid, X, Users, Layers,
} from 'lucide-react';
import Table from './ui/Table';
import Badge from './ui/Badge';
import ColHeader from './ColHeader';
import styles from '../styles/issues.module.css';
import dashboardStyles from '../styles/dashboard.module.css';
import { yesterdayISO, isOverdueTask } from '../lib/developerTaskStats';
import {
  buildRowTintClass, buildRowRailClass, visibleStatusTabs,
  priorityRank, priorityTone, priorityLabel, priorityStripeColor, statusBadgeStyle,
} from '../lib/taskTableShared';
import { formatDate } from '../lib/formatDate';
import { apiFetch } from '../lib/api';

// Team Tasks - every team member's assigned tasks in one place, for
// Admin/Executive/Program Manager. Modeled directly on
// DeveloperTaskWorkboard (My Tasks): same icon-header/sortable table
// (components/ui/Table), same row-tint-by-status, same stat-cards-as-
// filter-presets pattern. Unlike My Tasks, completed tasks (Pass/Junk/
// Released) are always hidden here - confirmed with the user 2026-09 when
// the "Show completed tasks" toggle was removed, no per-user override.
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
//
// Table view and tile view share this exact same fetch/filter/pagination
// state - the toggle only swaps which of the two render blocks below is
// used for the current page's rows, so the two views can never drift out
// of sync with each other.

const PAGE_SIZE_OPTIONS = [25, 50, 100];
const DEFAULT_PAGE_SIZE = 50;

const ROW_TINT_CLASS = buildRowTintClass(styles);
const ROW_RAIL_CLASS = buildRowRailClass(styles);

// Workload view - calendar weeks (Monday-Sunday), 6 shown at a time.
// Confirmed with the user 2026-09.
const WORKLOAD_WEEK_COUNT = 6;

// Local-date-safe formatting (no UTC conversion, unlike toISOString) - see
// lib/formatDate.js's identical reasoning for why this matters for a
// date-only value like ProjectTask.dueDate.
function toDateOnlyString(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function startOfWeek(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0=Sun, 1=Mon, ... 6=Sat
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diffToMonday);
  return d;
}

// The WORKLOAD_WEEK_COUNT calendar weeks starting at weekOffset weeks from
// this week's Monday - weekOffset shifts the whole window backward/forward
// via the Workload view's "prev/next" buttons.
function buildWorkloadWeeks(weekOffset) {
  const base = startOfWeek(new Date());
  base.setDate(base.getDate() + weekOffset * 7);
  const weeks = [];
  for (let i = 0; i < WORKLOAD_WEEK_COUNT; i++) {
    const start = new Date(base);
    start.setDate(start.getDate() + i * 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    weeks.push({ key: toDateOnlyString(start), start: toDateOnlyString(start), end: toDateOnlyString(end) });
  }
  return weeks;
}

// Keys match TeamTasksResult.statCounts exactly (TasksService.findTeam) -
// 'total' rather than 'all', since it's a count field there, not a filter
// preset key. `accent` is only set for the two that indicate a problem
// (Rejected/Overdue) - Team Tasks/Open Dependency are neutral counts, no
// accent color.
const CARD_DEFS = [
  { key: 'total', label: 'Team Tasks' },
  { key: 'rejected', label: 'Rejected', accent: 'danger' },
  { key: 'openDependency', label: 'Open Dependency' },
  { key: 'overdue', label: 'Overdue', accent: 'warning' },
  { key: 'defects', label: 'Defects' },
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

// Dependency tree content - shared by the table view's expandable row
// (Table's expandedContent prop) and the tile view's inline expansion.
// Only ever rendered for a task that actually has dependency tickets
// (see the callers below); defects are intentionally out of scope here -
// there's no data linking a defect back to an originating task today.
function DependencyTree({ tickets }) {
  return (
    <div className={styles.dependencyTree}>
      {tickets.map((tk) => (
        <div key={tk.id} className={styles.dependencyTreeItem}>
          <Link2 size={13} aria-hidden="true" />
          <span>{tk.description}</span>
          <span className={styles.dependencyTreeOwner}>{tk.ownerEmail}</span>
          <Badge tone={tk.status === 'open' ? 'warning' : 'success'}>{tk.status === 'open' ? 'Open' : 'Resolved'}</Badge>
        </div>
      ))}
    </div>
  );
}

function TaskTile({ task, assigneeLabel, railClass, expanded, onToggleExpand, onOpen }) {
  const depCount = task.dependencyTickets?.length || 0;
  return (
    <div className={`${styles.taskTile} ${railClass || ''}`} onClick={onOpen}>
      <div className={styles.taskTileTop}>
        <Link
          href={`/tasks/${task.id}`}
          className={styles.issueId}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
        >
          #{task.id}
        </Link>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <Badge tone={priorityTone(task.priority)}>{priorityLabel(task.priority)}</Badge>
          <span className={styles.badge} style={statusBadgeStyle(task.status)}>{task.status}</span>
        </div>
      </div>
      <div className={styles.taskTileDesc} title={task.title}>
        {task.title}
      </div>
      <div className={styles.taskTileMeta}>
        <span><Layers size={12} aria-hidden="true" /> {task.moduleName || '—'}</span>
        <span><User size={12} aria-hidden="true" /> {assigneeLabel}</span>
        <span className={isOverdueTask(task) ? styles.dueDateOverdue : undefined}>
          <CalendarClock size={12} aria-hidden="true" /> {formatDate(task.dueDate)}
        </span>
      </div>
      {depCount > 0 && (
        <button
          type="button"
          className={styles.dependencyToggle}
          style={{ marginTop: 'var(--space-3)' }}
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpand(task.id);
          }}
        >
          {expanded ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
          Dependencies ({depCount})
        </button>
      )}
      {expanded && depCount > 0 && (
        <div style={{ marginTop: 'var(--space-2)' }} onClick={(e) => e.stopPropagation()}>
          <DependencyTree tickets={task.dependencyTickets} />
        </div>
      )}
    </div>
  );
}

// Workload view chip - status fill (same statusBadgeStyle used by the
// Status column/badge elsewhere on this page) + a colored left-edge stripe
// for Priority. Opens the task the same way every other click-to-open spot
// on this page does (new tab).
function WorkloadChip({ task }) {
  return (
    <button
      type="button"
      className={styles.workloadChip}
      style={{ ...statusBadgeStyle(task.status), borderLeftColor: priorityStripeColor(task.priority) }}
      title={`#${task.id} ${task.title}`}
      onClick={() => window.open(`/tasks/${task.id}`, '_blank', 'noopener,noreferrer')}
    >
      #{task.id}
    </button>
  );
}

// One assignee×week (or Overdue/Later/No Due Date) cell - fixed height
// with its own internal scrollbar once it has more chips than fit, so
// every cell in the grid stays the same height regardless of how many
// tasks are in it (confirmed with the user 2026-09, over a "+N more"
// popover alternative).
function WorkloadCell({ tasks }) {
  return (
    <div className={styles.workloadCell}>
      <div className={styles.workloadCellBody}>
        {tasks.length === 0 ? (
          <span className={styles.workloadCellEmpty}>—</span>
        ) : (
          tasks.map((t) => <WorkloadChip key={t.id} task={t} />)
        )}
      </div>
    </div>
  );
}

export default function TeamTaskWorkboard({ storageKey, fullScreen = false }) {
  const [activeCard, setActiveCard] = useState(null);

  const [statusFilter, setStatusFilter] = useState('All');
  const [phaseFilter, setPhaseFilter] = useState('All');
  const [dependencyFilter, setDependencyFilter] = useState('All');
  // 'All' | 'Yes' | 'No' - only ever set to 'Yes' today, by clicking the
  // Defects stat card, same as Rejected/Overdue reusing statusFilter/dueTo
  // rather than exposing this as its own dropdown.
  const [defectFilter, setDefectFilter] = useState('All');
  const [assigneeFilter, setAssigneeFilter] = useState('All');
  const [dueFrom, setDueFrom] = useState('');
  const [dueTo, setDueTo] = useState('');
  const [viewMode, setViewMode] = useState('table');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [expandedTaskIds, setExpandedTaskIds] = useState(() => new Set());
  // Workload view's 6-week window, in whole-week steps from this week -
  // shifted by the view's own prev/next buttons, independent of page/
  // pageSize which Table/Tiles use instead.
  const [weekOffset, setWeekOffset] = useState(0);

  const [tasks, setTasks] = useState([]);
  const [total, setTotal] = useState(0);
  const [statCounts, setStatCounts] = useState({ total: 0, rejected: 0, openDependency: 0, overdue: 0, defects: 0 });
  const [assignees, setAssignees] = useState([]);
  const [phases, setPhases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Workload view's own data - every matching task (all=true, no
  // pagination), fetched separately from Table/Tiles' paginated `tasks`
  // above and only while that view is active, so switching to/from
  // Workload never adds a wasted request to the other two views.
  const [workloadTasks, setWorkloadTasks] = useState([]);
  const [workloadLoading, setWorkloadLoading] = useState(false);

  const viewModeStorageKey = `${storageKey}ViewMode`;
  const pageSizeStorageKey = `${storageKey}PageSize`;

  useEffect(() => {
    const stored = localStorage.getItem(storageKey);
    if (stored) setActiveCard(stored);
    const storedViewMode = localStorage.getItem(viewModeStorageKey);
    if (storedViewMode === 'tile' || storedViewMode === 'table' || storedViewMode === 'workload') setViewMode(storedViewMode);
    const storedPageSize = Number(localStorage.getItem(pageSizeStorageKey));
    if (PAGE_SIZE_OPTIONS.includes(storedPageSize)) setPageSize(storedPageSize);
    // storageKey is a static prop per page, not expected to change at runtime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('pageSize', String(pageSize));
    // statusFilter is either 'All' or a raw status/comma-joined status list
    // ready to send straight through - set directly by the status tabs
    // (tab.statuses.join(',')) below, or a single exact status when a stat
    // card sets it (e.g. 'Failed' for the Rejected card, which must stay a
    // precise match to that card's own count - see handleCardClick).
    if (statusFilter !== 'All') params.set('status', statusFilter);
    if (phaseFilter !== 'All') params.set('phaseId', phaseFilter);
    if (dependencyFilter !== 'All') params.set('dependency', dependencyFilter);
    if (defectFilter !== 'All') params.set('isDefect', defectFilter);
    if (assigneeFilter !== 'All') params.set('assigneeUserId', assigneeFilter);
    if (dueFrom) params.set('dueFrom', dueFrom);
    if (dueTo) params.set('dueTo', dueTo);

    let cancelled = false;
    setLoading(true);
    apiFetch(`/tasks/team?${params.toString()}`)
      .then((res) => {
        if (cancelled) return;
        setTasks(res.tasks);
        setTotal(res.total);
        setStatCounts(res.statCounts);
        setAssignees(res.assignees);
        setPhases(res.phases || []);
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
  }, [statusFilter, phaseFilter, dependencyFilter, defectFilter, assigneeFilter, dueFrom, dueTo, page, pageSize]);

  // Workload view's own fetch - same filters as above, minus page/pageSize
  // (all=true instead, see TasksService.findTeam()) since the weekly grid
  // needs every matching task to bucket correctly. Only runs while
  // Workload is the active view.
  useEffect(() => {
    if (viewMode !== 'workload') return;
    const params = new URLSearchParams();
    params.set('all', 'true');
    if (statusFilter !== 'All') params.set('status', statusFilter);
    if (phaseFilter !== 'All') params.set('phaseId', phaseFilter);
    if (dependencyFilter !== 'All') params.set('dependency', dependencyFilter);
    if (defectFilter !== 'All') params.set('isDefect', defectFilter);
    if (assigneeFilter !== 'All') params.set('assigneeUserId', assigneeFilter);
    if (dueFrom) params.set('dueFrom', dueFrom);
    if (dueTo) params.set('dueTo', dueTo);

    let cancelled = false;
    setWorkloadLoading(true);
    apiFetch(`/tasks/team?${params.toString()}`)
      .then((res) => {
        if (cancelled) return;
        setWorkloadTasks(res.tasks);
        setError('');
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setWorkloadLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [viewMode, statusFilter, phaseFilter, dependencyFilter, defectFilter, assigneeFilter, dueFrom, dueTo]);

  // Any filter (or page size) change invalidates the current page -
  // jumping back to page 1 avoids landing on a now out-of-range page
  // (e.g. page 3 of a filter that now only has 1 page of results).
  useEffect(() => {
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, phaseFilter, dependencyFilter, defectFilter, assigneeFilter, dueFrom, dueTo, pageSize]);

  const handleViewModeChange = (mode) => {
    setViewMode(mode);
    localStorage.setItem(viewModeStorageKey, mode);
  };

  const handlePageSizeChange = (size) => {
    setPageSize(size);
    localStorage.setItem(pageSizeStorageKey, String(size));
  };

  const toggleExpanded = (taskId) => {
    setExpandedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  // Completed tasks (Pass/Junk/Released) are always hidden on Team Tasks
  // now - confirmed with the user 2026-09 when the "Show completed tasks"
  // toggle was removed - so the tabs that are entirely completed statuses
  // (Pass, Released - No Showstoppers) never show here.
  const visibleTabs = visibleStatusTabs(false);

  const cards = useMemo(
    () => CARD_DEFS.map((c) => ({ ...c, count: statCounts[c.key] ?? 0, kind: 'table' })),
    [statCounts],
  );

  // Full Name is already fetched for the Assignee filter dropdown - reused
  // here so the table/tile Assignee display shows the same name instead of
  // the raw email, falling back to email for anyone with no Full Name set.
  const assigneeLabelById = useMemo(() => new Map(assignees.map((a) => [a.id, a.fullName || a.email])), [assignees]);

  const workloadWeeks = useMemo(() => buildWorkloadWeeks(weekOffset), [weekOffset]);

  // Groups workloadTasks by assignee, then buckets each assignee's tasks
  // into Overdue / one column per visible week / Later / No Due Date - see
  // buildWorkloadWeeks above for the week boundaries. Rows are only built
  // for assignees who actually appear in the current (filtered) task set,
  // not TasksService.findTeamAssignees()'s full tenant-wide, all-time
  // roster - otherwise the grid would show rows for people with zero open
  // work right now.
  const workloadRows = useMemo(() => {
    const byAssignee = new Map();
    for (const t of workloadTasks) {
      if (t.assigneeUserId == null) continue;
      if (!byAssignee.has(t.assigneeUserId)) {
        byAssignee.set(t.assigneeUserId, {
          id: t.assigneeUserId,
          label: assigneeLabelById.get(t.assigneeUserId) || t.assigneeEmail || `#${t.assigneeUserId}`,
          total: 0,
          overdue: [],
          weekBuckets: workloadWeeks.map(() => []),
          later: [],
          noDueDate: [],
        });
      }
      const row = byAssignee.get(t.assigneeUserId);
      row.total += 1;
      if (!t.dueDate) {
        row.noDueDate.push(t);
      } else if (t.dueDate < workloadWeeks[0].start) {
        row.overdue.push(t);
      } else if (t.dueDate > workloadWeeks[workloadWeeks.length - 1].end) {
        row.later.push(t);
      } else {
        const weekIndex = workloadWeeks.findIndex((w) => t.dueDate >= w.start && t.dueDate <= w.end);
        row.weekBuckets[weekIndex].push(t);
      }
    }
    return Array.from(byAssignee.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [workloadTasks, workloadWeeks, assigneeLabelById]);

  const handleCardClick = (card) => {
    setActiveCard((prev) => {
      const next = prev === card.key ? null : card.key;
      localStorage.setItem(storageKey, next || '');
      return next;
    });
    if (card.key === 'total') {
      setStatusFilter('All'); setDependencyFilter('All'); setDefectFilter('All'); setDueFrom(''); setDueTo('');
    } else if (card.key === 'rejected') {
      setStatusFilter('Failed'); setDependencyFilter('All'); setDefectFilter('All'); setDueFrom(''); setDueTo('');
    } else if (card.key === 'openDependency') {
      setStatusFilter('All'); setDependencyFilter('Yes'); setDefectFilter('All'); setDueFrom(''); setDueTo('');
    } else if (card.key === 'overdue') {
      setStatusFilter('All'); setDependencyFilter('All'); setDefectFilter('All'); setDueTo(yesterdayISO());
    } else if (card.key === 'defects') {
      setStatusFilter('All'); setDependencyFilter('All'); setDefectFilter('Yes'); setDueFrom(''); setDueTo('');
    }
  };

  const columns = useMemo(
    () => [
      {
        key: 'id',
        header: <ColHeader icon={Hash} label="Ticket ID" />,
        width: 70,
        sortable: true,
        render: (t) => (
          <Link
            href={`/tasks/${t.id}`}
            className={styles.issueId}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
          >
            #{t.id}
          </Link>
        ),
      },
      {
        key: 'assigneeEmail',
        header: <ColHeader icon={User} label="Assignee" />,
        sortable: true,
        render: (t) => assigneeLabelById.get(t.assigneeUserId) || t.assigneeEmail || '—',
      },
      {
        key: 'createdAt',
        header: <ColHeader icon={CalendarDays} label="Created Date" />,
        sortable: true,
        render: (t) => formatDate(t.createdAt),
      },
      {
        key: 'title',
        header: <ColHeader icon={FileText} label="Title" />,
        sortable: true,
        render: (t) => (
          <span className={styles.descClamp} title={t.title}>
            {t.title}
          </span>
        ),
      },
      {
        key: 'status',
        header: <ColHeader icon={Activity} label="Status" />,
        sortable: true,
        render: (t) => <span className={styles.badge} style={statusBadgeStyle(t.status)}>{t.status}</span>,
      },
      {
        key: 'priority',
        header: <ColHeader icon={Flag} label="Priority" />,
        sortable: true,
        sortAccessor: (t) => priorityRank(t.priority),
        render: (t) => <Badge tone={priorityTone(t.priority)}>{priorityLabel(t.priority)}</Badge>,
      },
      {
        key: 'dueDate',
        header: <ColHeader icon={CalendarClock} label="Due Date" />,
        sortable: true,
        render: (t) => (
          <span className={isOverdueTask(t) ? styles.dueDateOverdue : undefined}>{formatDate(t.dueDate)}</span>
        ),
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
        render: (t) => {
          const depCount = t.dependencyTickets?.length || 0;
          const label = t.hasOpenDependency ? 'Yes' : 'No';
          if (depCount === 0) return label;
          const isExpanded = expandedTaskIds.has(t.id);
          return (
            <button
              type="button"
              className={styles.dependencyToggle}
              onClick={(e) => {
                e.stopPropagation();
                toggleExpanded(t.id);
              }}
            >
              {isExpanded ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
              {label} ({depCount})
            </button>
          );
        },
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
    [expandedTaskIds, assigneeLabelById],
  );

  const activeCardDef = cards.find((c) => c.key === activeCard);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className={fullScreen ? styles.fullScreenPage : undefined}>
      <div className={dashboardStyles.statsStrip}>
        {cards.map((card) => (
          <button
            key={card.key}
            type="button"
            className={`${dashboardStyles.statStripSegment} ${activeCard === card.key ? dashboardStyles.expanded : ''}`}
            aria-expanded={activeCard === card.key}
            onClick={() => handleCardClick(card)}
          >
            <div
              className={`${dashboardStyles.statStripValue} ${
                card.accent === 'danger'
                  ? dashboardStyles.accentDanger
                  : card.accent === 'warning'
                    ? dashboardStyles.accentWarning
                    : ''
              }`}
            >
              {loading ? '–' : card.count}
            </div>
            <div className={dashboardStyles.statStripLabel}>{card.label}</div>
          </button>
        ))}
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {activeCard && activeCardDef && (
        <div className={fullScreen ? styles.fullScreenSection : undefined}>
          <div className={styles.statusTabs}>
            {visibleTabs.map((tab) => {
              const tabValue = tab.key === 'All' ? 'All' : tab.statuses.join(',');
              return (
                <button
                  key={tab.key}
                  type="button"
                  className={`${styles.statusTab} ${statusFilter === tabValue ? styles.statusTabActive : ''}`}
                  onClick={() => setStatusFilter(tabValue)}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          <label className={styles.filterLabel}>Assignee</label>
          <div className={styles.statusTabs}>
            <button
              type="button"
              className={`${styles.statusTab} ${assigneeFilter === 'All' ? styles.statusTabActive : ''}`}
              onClick={() => setAssigneeFilter('All')}
            >
              All
            </button>
            {assignees.map((a) => (
              <button
                key={a.id}
                type="button"
                className={`${styles.statusTab} ${assigneeFilter === String(a.id) ? styles.statusTabActive : ''}`}
                onClick={() => setAssigneeFilter(String(a.id))}
              >
                {a.fullName || a.email}
              </button>
            ))}
          </div>

          <div className={styles.filterBar}>
            <div className={styles.filterGroup}>
              <label className={styles.filterLabel} htmlFor="teamPhaseFilter">Project Phase</label>
              <select
                id="teamPhaseFilter"
                className={styles.filterSelect}
                value={phaseFilter}
                onChange={(e) => setPhaseFilter(e.target.value)}
              >
                <option value="All">All</option>
                {phases.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
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
              <div className={styles.dateFieldWrap}>
                <input
                  id="teamDueFrom"
                  type="date"
                  className={styles.filterSelect}
                  style={dueFrom ? { paddingRight: '2.5rem' } : undefined}
                  value={dueFrom}
                  onChange={(e) => setDueFrom(e.target.value)}
                />
                {dueFrom && (
                  <button
                    type="button"
                    className={styles.dateFieldClear}
                    aria-label="Clear due from"
                    onClick={() => setDueFrom('')}
                  >
                    <X size={13} aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>

            <div className={styles.filterGroup}>
              <label className={styles.filterLabel} htmlFor="teamDueTo">Due to</label>
              <div className={styles.dateFieldWrap}>
                <input
                  id="teamDueTo"
                  type="date"
                  className={styles.filterSelect}
                  style={dueTo ? { paddingRight: '2.5rem' } : undefined}
                  value={dueTo}
                  onChange={(e) => setDueTo(e.target.value)}
                />
                {dueTo && (
                  <button
                    type="button"
                    className={styles.dateFieldClear}
                    aria-label="Clear due to"
                    onClick={() => setDueTo('')}
                  >
                    <X size={13} aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>

            <div className={styles.filterGroup} style={{ marginLeft: 'auto' }}>
              <label className={styles.filterLabel}>View</label>
              <div className={styles.viewToggle}>
                <button
                  type="button"
                  className={`${styles.viewToggleButton} ${viewMode === 'table' ? styles.viewToggleActive : ''}`}
                  onClick={() => handleViewModeChange('table')}
                >
                  <List size={14} aria-hidden="true" /> Table
                </button>
                <button
                  type="button"
                  className={`${styles.viewToggleButton} ${viewMode === 'tile' ? styles.viewToggleActive : ''}`}
                  onClick={() => handleViewModeChange('tile')}
                >
                  <LayoutGrid size={14} aria-hidden="true" /> Tiles
                </button>
                <button
                  type="button"
                  className={`${styles.viewToggleButton} ${viewMode === 'workload' ? styles.viewToggleActive : ''}`}
                  onClick={() => handleViewModeChange('workload')}
                >
                  <Users size={14} aria-hidden="true" /> Workload
                </button>
              </div>
            </div>
          </div>

          {viewMode === 'workload' ? (
            <>
              <div className={styles.workloadNav}>
                <button
                  type="button"
                  className={`${styles.button} ${styles.buttonSecondary}`}
                  onClick={() => setWeekOffset((w) => w - 1)}
                >
                  <ChevronLeft size={16} aria-hidden="true" />
                  Previous week
                </button>
                {weekOffset !== 0 && (
                  <button
                    type="button"
                    className={`${styles.button} ${styles.buttonSecondary}`}
                    onClick={() => setWeekOffset(0)}
                  >
                    This week
                  </button>
                )}
                <button
                  type="button"
                  className={`${styles.button} ${styles.buttonSecondary}`}
                  onClick={() => setWeekOffset((w) => w + 1)}
                >
                  Next week
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              </div>

              <div className={`${styles.workloadWrap} ${fullScreen ? styles.fullScreenTableWrap : ''}`}>
                {workloadRows.length === 0 ? (
                  <div className={styles.card}>{workloadLoading ? 'Loading...' : 'No tasks match these filters.'}</div>
                ) : (
                  <div
                    className={styles.workloadGrid}
                    style={{ gridTemplateColumns: `220px repeat(${workloadWeeks.length + 3}, minmax(140px, 1fr))` }}
                  >
                    <div className={`${styles.workloadCell} ${styles.workloadHeaderCell}`}>Assignee</div>
                    <div className={`${styles.workloadCell} ${styles.workloadHeaderCell}`}>Overdue</div>
                    {workloadWeeks.map((w) => (
                      <div key={w.key} className={`${styles.workloadCell} ${styles.workloadHeaderCell}`}>
                        {formatDate(w.start)} – {formatDate(w.end)}
                      </div>
                    ))}
                    <div className={`${styles.workloadCell} ${styles.workloadHeaderCell}`}>Later</div>
                    <div className={`${styles.workloadCell} ${styles.workloadHeaderCell}`}>No Due Date</div>

                    {workloadRows.map((row) => (
                      <Fragment key={row.id}>
                        <div className={`${styles.workloadCell} ${styles.workloadAssigneeCell}`}>
                          <div className={styles.workloadAssigneeName}>{row.label}</div>
                          <div className={styles.workloadAssigneeCount}>{row.total} open</div>
                        </div>
                        <WorkloadCell tasks={row.overdue} />
                        {row.weekBuckets.map((bucket, i) => (
                          <WorkloadCell key={workloadWeeks[i].key} tasks={bucket} />
                        ))}
                        <WorkloadCell tasks={row.later} />
                        <WorkloadCell tasks={row.noDueDate} />
                      </Fragment>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : viewMode === 'tile' ? (
            <div className={`${styles.taskTileGrid} ${fullScreen ? styles.fullScreenTableWrap : ''}`}>
              {tasks.length === 0 && (
                <div className={styles.card}>{loading ? 'Loading...' : 'No tasks match these filters.'}</div>
              )}
              {tasks.map((t) => (
                <TaskTile
                  key={t.id}
                  task={t}
                  assigneeLabel={assigneeLabelById.get(t.assigneeUserId) || t.assigneeEmail || '—'}
                  railClass={ROW_RAIL_CLASS[t.status]}
                  expanded={expandedTaskIds.has(t.id)}
                  onToggleExpand={toggleExpanded}
                  onOpen={() => window.open(`/tasks/${t.id}`, '_blank', 'noopener,noreferrer')}
                />
              ))}
            </div>
          ) : (
            <Table
              columns={columns}
              rows={tasks}
              getRowId={(t) => t.id}
              onRowClick={(t) => window.open(`/tasks/${t.id}`, '_blank', 'noopener,noreferrer')}
              rowClassName={(t) => ROW_TINT_CLASS[t.status] || ''}
              emptyState={loading ? 'Loading...' : 'No tasks match these filters.'}
              className={fullScreen ? styles.fullScreenTableWrap : undefined}
              expandedContent={(t) =>
                expandedTaskIds.has(t.id) && t.dependencyTickets?.length > 0 ? (
                  <DependencyTree tickets={t.dependencyTickets} />
                ) : null
              }
            />
          )}

          {viewMode !== 'workload' && (
            <div className={styles.filterBar} style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <span className={styles.issueMeta}>
                {total === 0 ? '0 tasks' : `Showing ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`}
              </span>
              <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
                <div className={styles.filterGroup} style={{ minWidth: 90 }}>
                  <label className={styles.filterLabel} htmlFor="teamPageSize">Per page</label>
                  <select
                    id="teamPageSize"
                    className={styles.filterSelect}
                    value={pageSize}
                    onChange={(e) => handlePageSizeChange(Number(e.target.value))}
                  >
                    {PAGE_SIZE_OPTIONS.map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </div>
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
            </div>
          )}
        </div>
      )}
    </div>
  );
}
