import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import styles from '../styles/issues.module.css';
import dashboardStyles from '../styles/dashboard.module.css';
import { todayISO, yesterdayISO, computeDeveloperTaskStats, isOverdueTask, openTickets } from '../lib/developerTaskStats';
import {
  COMPLETED_STATUSES, LEGEND_ITEMS, buildRowTintClass, buildRowRailClass, selectableStatuses, statusLabel,
} from '../lib/taskTableShared';
import {
  buildTaskColumns, useSectionSort, sortBySections, countSections, toDependencyRow,
  TaskSectionsTable, TaskSectionsTiles, ViewToggle, StatusLegend,
} from './taskViews/TaskSections';
import DependencyTicketBoard from './taskViews/DependencyTicketBoard';
import LoadingState from './ui/LoadingState';

// Shared by the My Tasks page (pages/tasks/mine.js) and the Developer
// Dashboard (components/DeveloperDashboard.js): the summary tiles, and the
// collapsible Table | Tiles view they expand into. The table, tiles,
// sections (Tasks, Defects, Dependencies) and View toggle are the exact
// same components Team Tasks uses (components/taskViews/TaskSections.js,
// confirmed with the user 2026-10-07) - everything here is client-side,
// since one person's list is small and fetched in full.
//
// Dependencies = open tickets other people filed against this user
// (GET /task-dependency-tickets/mine), grouped by who filed them. Tickets
// this user filed against others (/created-by-me) show as each task's
// expandable "Dependencies (n)" tree and on the "You're waiting on" tile.

const ROW_TINT_CLASS = buildRowTintClass(styles);
const ROW_RAIL_CLASS = buildRowRailClass(styles);

// Tiles: what each one counts is spelled out in its label (renamed
// 2026-10-07, confirmed with the user, so no tile can read as a subset of
// another yet show a bigger number). `sections` is which rows clicking it
// shows; 'tickets' tiles open the dependency ticket view instead
// (taskViews/DependencyTicketBoard.js) in the given direction.
const CARD_DEFS = [
  { key: 'myTasks', label: 'Open tasks', sections: 'all' },
  { key: 'rejected', label: 'Rejected', accent: 'danger', sections: 'tasks' },
  { key: 'inbound', label: 'You’re waiting on', kind: 'tickets', direction: 'inbound' },
  { key: 'outbound', label: 'Waiting on you', kind: 'tickets', direction: 'outbound' },
  { key: 'overdue', label: 'Overdue tasks', accent: 'warning', sections: 'tasks' },
  { key: 'defects', label: 'Defects', sections: 'tasks' },
];

const noAssignee = null;
const emailLabel = (email) => email || '—';

export default function DeveloperTaskWorkboard({
  tasks,
  outbound,
  inbound,
  loading,
  storageKey,
  userId,
  showCards = true,
  hideEmptyCards = false,
}) {
  // null = collapsed. Otherwise the key of whichever tile is driving the
  // expanded view below.
  const [activeCard, setActiveCard] = useState(null);

  const [statusFilter, setStatusFilter] = useState('All');
  const [dependencyFilter, setDependencyFilter] = useState('All');
  const [dueFrom, setDueFrom] = useState('');
  const [dueTo, setDueTo] = useState('');
  const [showCompleted, setShowCompleted] = useState(false);
  const [viewMode, setViewMode] = useState('table');
  const [expandedTaskIds, setExpandedTaskIds] = useState(() => new Set());

  const showCompletedStorageKey = `${storageKey}ShowCompleted`;
  // Per user, so two people sharing a browser each keep their own view.
  // Browser storage only - no user setting/DB column (confirmed with the
  // user 2026-10-07).
  const viewModeStorageKey = `${storageKey}ViewMode:${userId}`;

  useEffect(() => {
    const stored = localStorage.getItem(storageKey);
    if (stored && CARD_DEFS.some((c) => c.key === stored)) setActiveCard(stored);
    setShowCompleted(localStorage.getItem(showCompletedStorageKey) === 'true');
    const storedViewMode = localStorage.getItem(viewModeStorageKey);
    if (storedViewMode === 'table' || storedViewMode === 'tile') setViewMode(storedViewMode);
    // storageKey/userId are static per page, not expected to change at runtime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleShowCompletedChange = (checked) => {
    setShowCompleted(checked);
    localStorage.setItem(showCompletedStorageKey, String(checked));
    // Otherwise turning the toggle off while filtered to e.g. "Pass" leaves
    // the table stuck empty with no visible way back.
    if (!checked && COMPLETED_STATUSES.includes(statusFilter)) setStatusFilter('All');
  };

  const handleViewModeChange = (mode) => {
    setViewMode(mode);
    localStorage.setItem(viewModeStorageKey, mode);
  };

  const toggleExpanded = (taskId) => {
    setExpandedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  // Each task's own filed tickets (open and resolved, the full picture -
  // same as Team Tasks' tree) for its expandable "Dependencies (n)".
  const tasksWithTickets = useMemo(() => {
    const byTask = new Map();
    for (const tk of inbound) {
      if (!byTask.has(tk.parentTaskId)) byTask.set(tk.parentTaskId, []);
      byTask.get(tk.parentTaskId).push(tk);
    }
    return tasks.map((t) => (byTask.has(t.id) ? { ...t, dependencyTickets: byTask.get(t.id) } : t));
  }, [tasks, inbound]);

  // The whole task dataset - every count and filter below reads from
  // this, so hiding completed tasks by default actually shrinks what
  // "Open tasks" means rather than just hiding rows.
  const visibleTasks = useMemo(
    () => (showCompleted ? tasksWithTickets : tasksWithTickets.filter((t) => !COMPLETED_STATUSES.includes(t.status))),
    [tasksWithTickets, showCompleted],
  );

  const openOutbound = useMemo(() => openTickets(outbound), [outbound]);
  const openInbound = useMemo(() => openTickets(inbound), [inbound]);
  const dependencyRows = useMemo(() => openOutbound.map(toDependencyRow), [openOutbound]);

  const { rejectedTasks, overdueTasks, overdueOutbound } = computeDeveloperTaskStats(visibleTasks, outbound, todayISO());

  const counts = {
    myTasks: visibleTasks.length,
    rejected: rejectedTasks.length,
    inbound: openInbound.length,
    outbound: openOutbound.length,
    overdue: overdueTasks.length,
    defects: visibleTasks.filter((t) => t.isDefect).length,
  };
  const cards = CARD_DEFS.map((c) => ({
    ...c,
    count: counts[c.key],
    note: c.key === 'outbound' && overdueOutbound.length > 0 ? `${overdueOutbound.length} overdue` : null,
  }));

  const visibleCards = hideEmptyCards ? (loading ? cards : cards.filter((c) => c.count > 0)) : cards;
  const allCaughtUp = hideEmptyCards && !loading && visibleCards.length === 0;

  const handleCardClick = (card) => {
    setActiveCard((prev) => {
      const next = prev === card.key ? null : card.key;
      localStorage.setItem(storageKey, next || '');
      return next;
    });
    setStatusFilter(card.key === 'rejected' ? 'Failed' : 'All');
    setDependencyFilter('All');
    setDueFrom('');
    setDueTo(card.key === 'overdue' ? yesterdayISO() : '');
  };

  const handleGenericToggle = () => {
    setActiveCard((prev) => {
      const next = prev ? null : 'myTasks';
      localStorage.setItem(storageKey, next || '');
      return next;
    });
  };

  const activeCardDef = cards.find((c) => c.key === activeCard);
  const taskOnlyFiltersActive = statusFilter !== 'All' || dependencyFilter !== 'All' || Boolean(dueFrom) || Boolean(dueTo);

  const filteredTasks = useMemo(() => {
    return visibleTasks.filter((task) => {
      if (statusFilter !== 'All' && task.status !== statusFilter) return false;
      if (dependencyFilter !== 'All') {
        const wantsYes = dependencyFilter === 'Yes';
        if (Boolean(task.hasOpenDependency) !== wantsYes) return false;
      }
      if (dueFrom && (!task.dueDate || task.dueDate < dueFrom)) return false;
      if (dueTo && (!task.dueDate || task.dueDate > dueTo)) return false;
      // Same rule as the tile's count (isOverdueTask also leaves out
      // Pass/Junk/Hold/Closed), so the rows always match the number.
      if (activeCard === 'overdue' && !isOverdueTask(task)) return false;
      if (activeCard === 'defects' && !task.isDefect) return false;
      return true;
    });
  }, [visibleTasks, statusFilter, dependencyFilter, dueFrom, dueTo, activeCard]);

  // Tickets carry no status/due date of their own to filter on, so while
  // a task-only filter is set they're left out, with a note instead -
  // same rule as Team Tasks.
  const allSections = activeCardDef?.sections === 'all';
  const includeDependencies = allSections && !taskOnlyFiltersActive;
  const hiddenDependencyCount = allSections && taskOnlyFiltersActive ? dependencyRows.length : 0;

  const rows = useMemo(
    () => sortBySections(includeDependencies ? [...filteredTasks, ...dependencyRows] : filteredTasks),
    [filteredTasks, dependencyRows, includeDependencies],
  );
  const sectionCounts = useMemo(() => countSections(rows), [rows]);
  const filerCounts = useMemo(() => {
    const m = new Map();
    for (const r of rows) if (r.kind === 'dependency') m.set(r.createdByEmail, (m.get(r.createdByEmail) || 0) + 1);
    return m;
  }, [rows]);
  const filerCount = (row) => filerCounts.get(row.createdByEmail) || 0;

  const { displayRows, sort, handleSortChange } = useSectionSort(rows, emailLabel);

  // No Assignee column/card line - every row here is this user's own.
  const columns = useMemo(
    () => buildTaskColumns({ assigneeLabel: noAssignee, labelForEmail: emailLabel, expandedTaskIds, toggleExpanded }),
    [expandedTaskIds],
  );

  // Only offer statuses that can actually appear in visibleTasks right now -
  // with completed tasks hidden, picking "Pass" from the dropdown would
  // otherwise always dead-end on an empty table.
  const statusOptions = selectableStatuses(showCompleted);

  const emptyState =
    tasks.length === 0 && dependencyRows.length === 0
      ? 'No tasks assigned to you yet.'
      : visibleTasks.length === 0 && !includeDependencies
        ? 'All caught up - your completed tasks are hidden. Check "Show completed tasks" above to see them.'
        : 'No tasks match these filters.';

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
        <div className={dashboardStyles.statsStrip}>
          {visibleCards.map((card) => {
            const selected = activeCard === card.key;
            return (
              <button
                key={card.key}
                type="button"
                className={`${dashboardStyles.statStripSegment} ${selected ? dashboardStyles.selected : ''}`}
                aria-pressed={selected}
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
                <div className={dashboardStyles.statStripLabel}>
                  {card.label}
                  {!loading && card.note && <span className={dashboardStyles.statStripNote}> · {card.note}</span>}
                </div>
              </button>
            );
          })}
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

      {activeCard && activeCardDef?.kind === 'tickets' && (
        <DependencyTicketBoard
          key={activeCardDef.direction}
          tickets={activeCardDef.direction === 'outbound' ? outbound : inbound}
          direction={activeCardDef.direction}
          title={activeCardDef.label}
          storageKey={`${storageKey}Tickets`}
          userId={userId}
          loading={loading}
        />
      )}

      {activeCard && activeCardDef && activeCardDef.kind !== 'tickets' && (
        <>
          <StatusLegend items={LEGEND_ITEMS} />

          <div className={`${styles.filterBar} ${styles.teamFilterBar}`}>
            <div className={styles.filterGroup}>
              <label className={styles.filterLabel} htmlFor="statusFilter">Status</label>
              <select
                id="statusFilter"
                className={styles.filterSelect}
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="All">All</option>
                {statusOptions.map((s) => (
                  <option key={s} value={s}>{statusLabel(s)}</option>
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

            <ViewToggle id="myTasksViewLabel" value={viewMode} onChange={handleViewModeChange} />
          </div>

          {hiddenDependencyCount > 0 && (
            <p className={styles.issueMeta}>
              {hiddenDependencyCount === 1 ? '1 dependency waiting on you is' : `${hiddenDependencyCount} dependencies waiting on you are`} hidden while Status, Dependency, or Due date filters are active.
            </p>
          )}

          {loading ? (
            <LoadingState />
          ) : viewMode === 'tile' ? (
            <TaskSectionsTiles
              rows={displayRows}
              sectionCounts={sectionCounts}
              filerCount={filerCount}
              labelForEmail={emailLabel}
              assigneeLabel={noAssignee}
              railClass={ROW_RAIL_CLASS}
              expandedTaskIds={expandedTaskIds}
              toggleExpanded={toggleExpanded}
              emptyState={emptyState}
            />
          ) : (
            <TaskSectionsTable
              rows={displayRows}
              columns={columns}
              sort={sort}
              onSortChange={handleSortChange}
              sectionCounts={sectionCounts}
              filerCount={filerCount}
              labelForEmail={emailLabel}
              rowTintClass={ROW_TINT_CLASS}
              expandedTaskIds={expandedTaskIds}
              emptyState={emptyState}
              minWidth={900}
            />
          )}
        </>
      )}
    </>
  );
}
