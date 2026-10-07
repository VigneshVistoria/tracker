import { Fragment, useEffect, useMemo, useState } from 'react';
import { ChevronRight, ChevronLeft, X } from 'lucide-react';
import styles from '../styles/issues.module.css';
import dashboardStyles from '../styles/dashboard.module.css';
import { yesterdayISO } from '../lib/developerTaskStats';
import {
  buildRowTintClass, buildRowRailClass, visibleStatusTabs,
  priorityStripeColor, statusBadgeStyle,
  HOLD_CLOSED_STATUSES, STATUS_TAB_GROUPS,
} from '../lib/taskTableShared';
import {
  buildTaskColumns, useSectionSort, TaskSectionsTable, TaskSectionsTiles, ViewToggle,
} from './taskViews/TaskSections';
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
// of sync with each other. Both views' building blocks live in
// components/taskViews/TaskSections.js, shared with My Tasks.

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
// (Rejected/Overdue) - Team Tasks/Waiting on Dependency are neutral
// counts, no accent color. 'openDependency' is labeled "Waiting on
// Dependency" (renamed 2026-10, confirmed with the user) so it reads as
// the opposite direction from the Development / Failed tab's "N to
// clear" count - this card counts the selected person's own *tasks* that
// are blocked on someone else, that tab counts open *tickets* the
// selected person owns and is blocking others with.
const CARD_DEFS = [
  { key: 'total', label: 'Team Tasks' },
  { key: 'rejected', label: 'Rejected', accent: 'danger' },
  { key: 'openDependency', label: 'Waiting on Dependency' },
  { key: 'overdue', label: 'Overdue', accent: 'warning' },
  { key: 'defects', label: 'Defects' },
];

// The filters each tile applies when clicked (Phase/Assignee are left as
// they are). Overdue only ever touched "Due to", so "Due from" isn't part
// of its match.
function cardPreset(key) {
  const base = { status: 'All', dependency: 'All', defect: 'All', dueFrom: '', dueTo: '' };
  switch (key) {
    case 'total': return base;
    case 'rejected': return { ...base, status: 'Failed' };
    case 'openDependency': return { ...base, dependency: 'Yes' };
    case 'overdue': return { ...base, dueFrom: null, dueTo: yesterdayISO() };
    case 'defects': return { ...base, defect: 'Yes' };
    default: return null;
  }
}

function presetMatches(key, f) {
  const p = cardPreset(key);
  if (!p) return false;
  return (
    f.status === p.status &&
    f.dependency === p.dependency &&
    f.defect === p.defect &&
    (p.dueFrom === null || f.dueFrom === p.dueFrom) &&
    f.dueTo === p.dueTo
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
      title={`#${task.id} (${task.isDefect ? 'Defect' : 'Task'}) ${task.title}`}
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
  // Completed tasks (Pass/Junk/Released) stay always-hidden here, same as
  // ever (see this file's top comment - no per-user override, confirmed
  // with the user 2026-09). Hold/Closed get their own independent
  // "hidden by default, toggle to reveal" pair instead, since neither is
  // "completed" work - see HOLD_CLOSED_STATUSES in taskTableShared.js.
  const [showHoldClosed, setShowHoldClosed] = useState(false);
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
  // Open dependency tickets the selected assignee owns - the Development /
  // Failed tab's "N to clear" label, always fetched regardless of tab.
  const [dependenciesToClearCount, setDependenciesToClearCount] = useState(0);
  // How many of `total` are dependency rows (0 unless they're included -
  // see includeDependencies below), for the pagination footer.
  const [includedDependencyCount, setIncludedDependencyCount] = useState(0);
  const [dependencyCountsByFiler, setDependencyCountsByFiler] = useState({});
  const [sectionCounts, setSectionCounts] = useState({ tasks: 0, defects: 0, dependencies: 0 });
  // Bumped whenever this browser tab regains focus, to re-fetch - a
  // ticket is usually resolved from its parent task page in another tab,
  // and its card should disappear (and the count drop) on return.
  const [refreshKey, setRefreshKey] = useState(0);
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
  const showHoldClosedStorageKey = `${storageKey}ShowHoldClosed`;

  useEffect(() => {
    const stored = localStorage.getItem(storageKey);
    if (stored && cardPreset(stored)) {
      // Re-apply the remembered tile's filters too, so it never reopens
      // highlighted while showing a different (default) filter set.
      setActiveCard(stored);
      const preset = cardPreset(stored);
      setStatusFilter(preset.status);
      setDependencyFilter(preset.dependency);
      setDefectFilter(preset.defect);
      if (preset.dueFrom !== null) setDueFrom(preset.dueFrom);
      setDueTo(preset.dueTo);
    }
    const storedViewMode = localStorage.getItem(viewModeStorageKey);
    if (storedViewMode === 'tile' || storedViewMode === 'table' || storedViewMode === 'workload') setViewMode(storedViewMode);
    const storedPageSize = Number(localStorage.getItem(pageSizeStorageKey));
    if (PAGE_SIZE_OPTIONS.includes(storedPageSize)) setPageSize(storedPageSize);
    setShowHoldClosed(localStorage.getItem(showHoldClosedStorageKey) === 'true');
    // storageKey is a static prop per page, not expected to change at runtime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Same "reset statusFilter if it becomes invalid" reasoning as My Tasks'
  // handleShowCompletedChange (DeveloperTaskWorkboard.js) - turning the
  // toggle off while filtered to a tab it just hid would otherwise leave
  // the table stuck empty with no visible way back.
  const handleShowHoldClosedChange = (checked) => {
    setShowHoldClosed(checked);
    localStorage.setItem(showHoldClosedStorageKey, String(checked));
    if (!checked && HOLD_CLOSED_STATUSES.includes(statusFilter)) setStatusFilter('All');
  };

  // Dependency rows only join the grid on the Development / Failed tab.
  // Tickets carry no phase/due date/defect flag of their own, so while
  // any of those (or the task-side Dependency filter) is active they're
  // left out, with a one-line note instead - confirmed with the user
  // 2026-10 - rather than silently ignoring the filter.
  const devFailedTab = STATUS_TAB_GROUPS.find((g) => g.key === 'DevelopmentFailed');
  const devFailedTabValue = devFailedTab.statuses.join(',');
  const onDevFailedTab = statusFilter === devFailedTabValue;
  const taskOnlyFiltersActive =
    phaseFilter !== 'All' || dependencyFilter !== 'All' || defectFilter !== 'All' || Boolean(dueFrom) || Boolean(dueTo);
  const includeDependencies = onDevFailedTab && !taskOnlyFiltersActive;

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') setRefreshKey((k) => k + 1);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
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
    if (showHoldClosed) params.set('showHoldClosed', 'true');
    if (includeDependencies) params.set('includeDependencies', 'true');

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
        setDependenciesToClearCount(res.dependenciesToClearCount || 0);
        setIncludedDependencyCount(res.includedDependencyCount || 0);
        setDependencyCountsByFiler(res.includedDependencyCountsByFiler || {});
        setSectionCounts(res.sectionCounts || { tasks: 0, defects: 0, dependencies: 0 });
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
  }, [statusFilter, phaseFilter, dependencyFilter, defectFilter, assigneeFilter, dueFrom, dueTo, showHoldClosed, page, pageSize, includeDependencies, refreshKey]);

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
    if (showHoldClosed) params.set('showHoldClosed', 'true');

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
  }, [viewMode, statusFilter, phaseFilter, dependencyFilter, defectFilter, assigneeFilter, dueFrom, dueTo, showHoldClosed]);

  // Any filter (or page size) change invalidates the current page -
  // jumping back to page 1 avoids landing on a now out-of-range page
  // (e.g. page 3 of a filter that now only has 1 page of results).
  useEffect(() => {
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, phaseFilter, dependencyFilter, defectFilter, assigneeFilter, dueFrom, dueTo, showHoldClosed, pageSize]);

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
  const visibleTabs = visibleStatusTabs(false, showHoldClosed);

  const cards = useMemo(
    () => CARD_DEFS.map((c) => ({ ...c, count: statCounts[c.key] ?? 0, kind: 'table' })),
    [statCounts],
  );

  // Full Name is already fetched for the Assignee filter dropdown - reused
  // here so the table/tile Assignee display shows the same name instead of
  // the raw email, falling back to email for anyone with no Full Name set.
  const assigneeLabelById = useMemo(() => new Map(assignees.map((a) => [a.id, a.fullName || a.email])), [assignees]);

  // Same Full Name preference, keyed by email instead - dependency
  // tickets only carry owner/creator emails, not user ids.
  const labelForEmail = useMemo(() => {
    const byEmail = new Map(assignees.map((a) => [a.email, a.fullName || a.email]));
    return (email) => byEmail.get(email) || email || '—';
  }, [assignees]);

  // "Filed by X (n)" uses the filer's total across all pages, from the API.
  const filerCount = (row) => dependencyCountsByFiler[row.createdByEmail] || 0;

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

  const applyCardPreset = (key) => {
    const preset = cardPreset(key);
    if (!preset) return;
    setStatusFilter(preset.status);
    setDependencyFilter(preset.dependency);
    setDefectFilter(preset.defect);
    if (preset.dueFrom !== null) setDueFrom(preset.dueFrom);
    setDueTo(preset.dueTo);
  };

  // A tile only looks selected while the filters it applied are still in
  // effect - changing a filter afterwards (or a stale remembered tile)
  // no longer leaves a tile shaded that isn't actually active.
  const currentFilters = { status: statusFilter, dependency: dependencyFilter, defect: defectFilter, dueFrom, dueTo };
  const isCardSelected = (key) => activeCard === key && presetMatches(key, currentFilters);

  const handleCardClick = (card) => {
    // Clicking the open tile again closes the section - unless its filters
    // were changed since, in which case it re-applies them instead.
    if (activeCard === card.key && !presetMatches(card.key, currentFilters)) {
      applyCardPreset(card.key);
      return;
    }
    const next = activeCard === card.key ? null : card.key;
    setActiveCard(next);
    localStorage.setItem(storageKey, next || '');
    if (next) applyCardPreset(next);
  };

  const assigneeLabel = useMemo(
    () => (t) => assigneeLabelById.get(t.assigneeUserId) || t.assigneeEmail,
    [assigneeLabelById],
  );
  const { displayRows, sort, handleSortChange } = useSectionSort(tasks, assigneeLabel);

  // The Assignee column/card line is dropped while a single assignee is
  // selected, since every row would repeat it.
  const showAssignee = assigneeFilter === 'All';
  const columns = useMemo(
    () => buildTaskColumns({ assigneeLabel: showAssignee ? assigneeLabel : null, labelForEmail, expandedTaskIds, toggleExpanded }),
    // toggleExpanded only calls a state setter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [expandedTaskIds, assigneeLabel, labelForEmail, showAssignee],
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
            className={`${dashboardStyles.statStripSegment} ${isCardSelected(card.key) ? dashboardStyles.selected : ''}`}
            aria-pressed={isCardSelected(card.key)}
            onClick={() => handleCardClick(card)}
          >
            {/* Red/amber only for a real problem (non-zero); 0 stays neutral. */}
            <div
              className={`${dashboardStyles.statStripValue} ${
                loading || !card.count
                  ? dashboardStyles.statStripZero
                  : card.accent === 'danger'
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
                  {tab.key === 'DevelopmentFailed' && dependenciesToClearCount > 0 && (
                    <> · {dependenciesToClearCount} to clear</>
                  )}
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

          <div className={`${styles.filterBar} ${styles.teamFilterBar}`}>
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

            <div className={styles.filterGroup}>
              <span className={styles.filterLabel} id="teamHoldClosedLabel">Hold/Closed</span>
              <label className={styles.teamCheckChip}>
                <input
                  type="checkbox"
                  checked={showHoldClosed}
                  aria-labelledby="teamHoldClosedLabel teamHoldClosedText"
                  onChange={(e) => handleShowHoldClosedChange(e.target.checked)}
                />
                <span id="teamHoldClosedText">Show</span>
              </label>
            </div>

            <ViewToggle id="teamViewLabel" value={viewMode} onChange={handleViewModeChange} modes={['table', 'tile', 'workload']} />
          </div>

          {onDevFailedTab && viewMode !== 'workload' && taskOnlyFiltersActive && dependenciesToClearCount > 0 && (
            <p className={styles.issueMeta}>
              {dependenciesToClearCount === 1 ? '1 dependency to clear is' : `${dependenciesToClearCount} dependencies to clear are`} hidden while Project Phase, Dependency, Defect, or Due date filters are active.
            </p>
          )}

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
            <TaskSectionsTiles
              rows={displayRows}
              sectionCounts={sectionCounts}
              filerCount={filerCount}
              labelForEmail={labelForEmail}
              assigneeLabel={assigneeLabel}
              railClass={ROW_RAIL_CLASS}
              expandedTaskIds={expandedTaskIds}
              toggleExpanded={toggleExpanded}
              emptyState={loading ? 'Loading...' : 'No tasks match these filters.'}
              className={fullScreen ? styles.fullScreenTableWrap : undefined}
            />
          ) : (
            <TaskSectionsTable
              rows={displayRows}
              columns={columns}
              sort={sort}
              onSortChange={handleSortChange}
              sectionCounts={sectionCounts}
              filerCount={filerCount}
              labelForEmail={labelForEmail}
              rowTintClass={ROW_TINT_CLASS}
              expandedTaskIds={expandedTaskIds}
              emptyState={loading ? 'Loading...' : 'No tasks match these filters.'}
              className={fullScreen ? styles.fullScreenTableWrap : undefined}
            />
          )}

          {viewMode !== 'workload' && (
            <div className={styles.filterBar} style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <span className={styles.issueMeta}>
                {total === 0
                  ? '0 tasks'
                  : `Showing ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}${
                      includedDependencyCount > 0
                        ? ` (incl. ${includedDependencyCount} ${includedDependencyCount === 1 ? 'dependency' : 'dependencies'})`
                        : ''
                    }`}
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
