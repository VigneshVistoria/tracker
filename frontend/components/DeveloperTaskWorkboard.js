import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import styles from '../styles/issues.module.css';
import dashboardStyles from '../styles/dashboard.module.css';
import {
  todayISO, computeDeveloperTaskStats, isOverdueTask, openTickets, MY_TASK_CARD_FILTERS, countMyTaskCard,
} from '../lib/developerTaskStats';
import { readCardParam, syncedQuery, sameQuery } from '../lib/listPresets';
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
//
// "Waiting for QA / review" (2026-11-04, user feedback): submitted work is
// with QA, a peer or the PM, so it leaves "Open tasks" and is never
// overdue for the developer. The review delay shows on the task header.
//
// Open / On hold (2026-11-04, user feedback - a card's number must match
// its list): "Open tasks" is open work that is the assignee's to act on
// (lib/developerTaskStats.js isOpenTask - no Hold/Closed/completed, no
// work with a reviewer) and lists task rows only; dependency tickets
// waiting on you have their own "Waiting on you" card. Hold is counted on
// its own card. Each task card counts and lists through the same
// MY_TASK_CARD_FILTERS predicate.
const CARD_DEFS = [
  { key: 'myTasks', label: 'Open tasks', sections: 'tasks' },
  { key: 'waitingReview', label: 'Waiting for QA / review', sections: 'tasks' },
  { key: 'rejected', label: 'Rejected', accent: 'danger', sections: 'tasks' },
  { key: 'inbound', label: 'You’re waiting on', kind: 'tickets', direction: 'inbound' },
  { key: 'outbound', label: 'Waiting on you', kind: 'tickets', direction: 'outbound' },
  { key: 'overdue', label: 'Overdue tasks', accent: 'warning', sections: 'tasks' },
  { key: 'defects', label: 'Open defects', sections: 'tasks' },
  { key: 'hold', label: 'On hold', sections: 'tasks' },
];
const CARD_KEYS = CARD_DEFS.map((c) => c.key);

// Status filter a card sets when it opens (Rejected = Failed); every other
// card starts from All and narrows by its own predicate.
const cardStatusPreset = (key) => (key === 'rejected' ? 'Failed' : 'All');

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
  // My Tasks page only: read ?card= on first load (a dashboard tile's
  // link) and keep the URL in step with the open card.
  urlSync = false,
}) {
  const router = useRouter();
  const initRef = useRef(false);
  const [initialized, setInitialized] = useState(!urlSync);
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
    if (urlSync && !router.isReady) return;
    if (initRef.current) return;
    initRef.current = true;
    const stored = localStorage.getItem(storageKey);
    const card = (urlSync && readCardParam(router.query, CARD_KEYS)) || (stored && CARD_KEYS.includes(stored) ? stored : null);
    if (card) {
      // Re-apply the card's filter too (Rejected = Failed), not only its
      // highlight, so the rows match the number after a reload.
      setActiveCard(card);
      setStatusFilter(cardStatusPreset(card));
    }
    setShowCompleted(localStorage.getItem(showCompletedStorageKey) === 'true');
    const storedViewMode = localStorage.getItem(viewModeStorageKey);
    if (storedViewMode === 'table' || storedViewMode === 'tile') setViewMode(storedViewMode);
    setInitialized(true);
    // storageKey/userId are static per page, not expected to change at runtime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady]);

  useEffect(() => {
    if (!urlSync || !initialized) return;
    const next = syncedQuery(router.query, ['card'], { card: activeCard });
    if (!sameQuery(router.query, next)) router.replace({ pathname: router.pathname, query: next }, undefined, { shallow: true });
    // router.query changes with every replace; reacting to it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlSync, initialized, activeCard]);

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

  const today = todayISO();
  const { overdueOutbound } = computeDeveloperTaskStats(visibleTasks, outbound, today);

  // Task cards never count a completed task, so "Show completed tasks"
  // doesn't move them.
  const counts = {
    myTasks: countMyTaskCard('myTasks', tasks, today),
    waitingReview: countMyTaskCard('waitingReview', tasks, today),
    rejected: countMyTaskCard('rejected', tasks, today),
    inbound: openInbound.length,
    outbound: openOutbound.length,
    overdue: countMyTaskCard('overdue', tasks, today),
    defects: countMyTaskCard('defects', tasks, today),
    hold: countMyTaskCard('hold', tasks, today),
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
    setStatusFilter(cardStatusPreset(card.key));
    setDependencyFilter('All');
    setDueFrom('');
    setDueTo('');
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
      // Same predicate as the card's count, so the rows always match the
      // number. A status picked by hand wins over the card's own status
      // rule (so "Feedback" from the dropdown still finds those tasks);
      // Overdue and Defects keep their rule either way.
      const cardFilter = MY_TASK_CARD_FILTERS[activeCard];
      if (cardFilter && statusFilter === 'All' && !cardFilter(task, today)) return false;
      if (activeCard === 'overdue' && !isOverdueTask(task, today)) return false;
      if (activeCard === 'defects' && !task.isDefect) return false;
      return true;
    });
  }, [visibleTasks, statusFilter, dependencyFilter, dueFrom, dueTo, activeCard, today]);

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
          {/* No cards on this page for this role: say which list a
              dashboard link opened, with a way back to all open tasks. */}
          {!showCards && activeCard !== 'myTasks' && (
            <div className={styles.filterBar}>
              <div className={styles.filterGroup}>
                <span className={styles.filterLabel}>Showing</span>
                <span className={styles.filterChip}>
                  <span>
                    {activeCardDef.label} ({activeCardDef.count})
                  </span>
                  <button
                    type="button"
                    className={styles.filterChipClear}
                    aria-label={`Clear: show all open tasks instead of ${activeCardDef.label}`}
                    onClick={() => handleCardClick(cards.find((c) => c.key === 'myTasks'))}
                  >
                    <X size={13} aria-hidden="true" />
                  </button>
                </span>
              </div>
            </div>
          )}
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
              <label className={styles.filterLabel} htmlFor="dueFrom">Task due from</label>
              <input
                id="dueFrom"
                type="date"
                className={styles.filterSelect}
                value={dueFrom}
                onChange={(e) => setDueFrom(e.target.value)}
              />
            </div>

            <div className={styles.filterGroup}>
              <label className={styles.filterLabel} htmlFor="dueTo">Task due to</label>
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
