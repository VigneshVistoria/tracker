import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  FileText, CalendarClock, Clock, Link2, PercentCircle, Hourglass, User, Activity,
  ChevronDown, ChevronRight, List, LayoutGrid, Layers, Users,
} from 'lucide-react';
import Table from '../ui/Table';
import Badge from '../ui/Badge';
import ColHeader from '../ColHeader';
import styles from '../../styles/issues.module.css';
import { isOverdueTask } from '../../lib/developerTaskStats';
import { priorityTone, priorityLabel, priorityRank, statusBadgeStyle, statusLabel } from '../../lib/taskTableShared';
import { formatDate } from '../../lib/formatDate';

// Table/Tiles building blocks shared by Team Tasks (TeamTaskWorkboard)
// and My Tasks / the Developer Dashboard (DeveloperTaskWorkboard) - one
// implementation, so the two pages can't drift apart (confirmed with the
// user 2026-10-07). Rows are tasks plus optional dependency-ticket rows
// (`kind: 'dependency'`, see TasksService's TeamDependencyRow and
// toDependencyRow() below), shown in three fixed sections: Tasks, then
// Defects, then Dependencies (grouped by who filed them).

// One "no value" mark for every empty cell, same muted colour everywhere
// (centred by the column's own alignment).
export function EmptyValue() {
  return (
    <span className={styles.teamEmpty} aria-label="None">
      —
    </span>
  );
}

function ProgressBar({ percent }) {
  if (percent === null || percent === undefined) {
    return <EmptyValue />;
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ds-space-2)' }}>
      <div
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Percent complete"
        style={{
          width: 44,
          height: 8,
          borderRadius: 'var(--ds-radius-full)',
          background: 'var(--ds-bg-surface-sunken)',
          overflow: 'hidden',
        }}
      >
        <div style={{ width: `${percent}%`, height: '100%', background: 'var(--ds-color-success)' }} />
      </div>
      <span style={{ fontSize: 'var(--ds-text-sm)', color: 'var(--ds-text-secondary)' }}>{percent}%</span>
    </div>
  );
}

// Dependency tree content - shared by the table view's expandable row
// (Table's expandedContent prop) and the tile view's inline expansion.
// Only ever rendered for a task that actually has dependency tickets.
export function DependencyTree({ tickets }) {
  return (
    <div className={styles.dependencyTree}>
      {tickets.map((tk) => (
        <div key={tk.id} className={styles.dependencyTreeItem}>
          <Link2 size={13} aria-hidden="true" />
          <span title={tk.description}>{tk.title}</span>
          <span className={styles.dependencyTreeOwner}>{tk.ownerEmail}</span>
          <Badge tone={tk.status === 'open' ? 'warning' : 'success'}>{tk.status === 'open' ? 'Open' : 'Resolved'}</Badge>
        </div>
      ))}
    </div>
  );
}

// A ticket has no page of its own - it lives on its parent task's page -
// so opening one goes there, scrolled to and highlighting that ticket
// (confirmed with the user 2026-10).
export const isDependencyRow = (row) => row.kind === 'dependency';
const dependencyHref = (row) => `/tasks/${row.parentTaskId}#dependency-${row.id}`;
export const rowHref = (row) => (isDependencyRow(row) ? dependencyHref(row) : `/tasks/${row.id}`);
const openInNewTab = (row) => window.open(rowHref(row), '_blank', 'noopener,noreferrer');

// Fixed section order for Table and Tiles - Tasks, Defects, Dependencies
// (confirmed with the user 2026-10-07).
export const SECTIONS = [
  { key: 'tasks', label: 'Tasks' },
  { key: 'defects', label: 'Defects' },
  { key: 'dependencies', label: 'Dependencies' },
];
export const sectionOf = (row) => (isDependencyRow(row) ? 'dependencies' : row.isDefect ? 'defects' : 'tasks');

// Section totals for a fully-loaded row list (My Tasks). Team Tasks gets
// its totals from the API instead, since it only holds one page.
export function countSections(rows) {
  const counts = { tasks: 0, defects: 0, dependencies: 0 };
  for (const r of rows) counts[sectionOf(r)] += 1;
  return counts;
}

// A column sort reorders rows only inside their own run - a section, or a
// "Filed by" group within Dependencies - so headers never scatter.
const sortGroupOf = (row) => (isDependencyRow(row) ? `dep:${row.createdByEmail}` : sectionOf(row));

function compareValues(av, bv) {
  if (av == null && bv == null) return 0;
  if (av == null) return 1;
  if (bv == null) return -1;
  if (typeof av === 'number' && typeof bv === 'number') return av - bv;
  return String(av).localeCompare(String(bv));
}

// Default order for a fully-loaded list - the same rule TasksService.
// findTeam() applies server-side for Team Tasks: section order, then due
// date soonest first (none last), then priority, then id. Dependencies
// keep their "Filed by" groups (biggest group first, like the API), with
// the soonest parent-task due date first inside each.
export function sortBySections(rows) {
  const filerCounts = new Map();
  for (const r of rows) if (isDependencyRow(r)) filerCounts.set(r.createdByEmail, (filerCounts.get(r.createdByEmail) || 0) + 1);
  const sectionRank = (r) => SECTIONS.findIndex((s) => s.key === sectionOf(r));
  return [...rows].sort((a, b) => {
    const bySection = sectionRank(a) - sectionRank(b);
    if (bySection) return bySection;
    if (isDependencyRow(a)) {
      const byGroup =
        (filerCounts.get(b.createdByEmail) || 0) - (filerCounts.get(a.createdByEmail) || 0) ||
        String(a.createdByEmail).localeCompare(String(b.createdByEmail));
      if (byGroup) return byGroup;
    }
    return (
      compareValues(a.dueDate || null, b.dueDate || null) ||
      priorityRank(a.priority) - priorityRank(b.priority) ||
      a.id - b.id
    );
  });
}

// Table column sort ({ key, dir } or null = the default order), applied
// within each section to both Table and Tiles. Pass the result's
// handleSortChange to TaskSectionsTable (asc -> desc -> off).
export function useSectionSort(rows, assigneeLabel) {
  const [sort, setSort] = useState(null);
  const displayRows = useMemo(() => {
    if (!sort) return rows;
    const accessor =
      sort.key === 'estimatedHours'
        ? (t) => (t.estimatedHours == null ? null : Number(t.estimatedHours))
        : sort.key === 'assigneeEmail'
          ? (t) => assigneeLabel(t)
          : (t) => t[sort.key];
    const runs = [];
    for (const t of rows) {
      const g = sortGroupOf(t);
      if (runs.length > 0 && runs[runs.length - 1].g === g) runs[runs.length - 1].rows.push(t);
      else runs.push({ g, rows: [t] });
    }
    return runs.flatMap(({ rows: run }) => {
      const sorted = [...run].sort((a, b) => compareValues(accessor(a), accessor(b)));
      return sort.dir === 'desc' ? sorted.reverse() : sorted;
    });
  }, [rows, sort, assigneeLabel]);
  const handleSortChange = (key, dir) => {
    setSort((prev) => (prev && prev.key === key && prev.dir === 'desc' ? null : { key, dir }));
  };
  return { displayRows, sort, handleSortChange };
}

// An open ticket from GET /task-dependency-tickets/mine (TaskDependency
// TicketWithParent) in the same shape as the API's TeamDependencyRow, so
// My Tasks can show it in the shared Dependencies section.
export function toDependencyRow(ticket) {
  return {
    kind: 'dependency',
    id: ticket.id,
    title: ticket.title,
    status: 'Open',
    assigneeUserId: ticket.ownerUserId,
    assigneeEmail: ticket.ownerEmail,
    createdByEmail: ticket.createdByEmail,
    createdAt: ticket.createdAt,
    ageingDays: Math.max(0, Math.floor((Date.now() - new Date(ticket.createdAt).getTime()) / 86400000)),
    dueDate: ticket.parentTaskDueDate || null,
    parentTaskId: ticket.parentTaskId,
    parentTaskTitle: ticket.parentTaskTitle,
    priority: null,
    estimatedHours: null,
    percentComplete: null,
  };
}

export function SectionHeader({ label, count, inTable }) {
  return (
    <div role="heading" aria-level={2} className={`${styles.teamSectionHeader} ${inTable ? styles.teamSectionHeaderInTable : ''}`}>
      {label} <span className={styles.teamSectionCount}>({count})</span>
    </div>
  );
}

// "Dependencies (n)" toggle with open/resolved counts - same control in
// the Table's Title cell and on a task tile.
function DependencyToggle({ tickets, expanded, onToggle, style }) {
  const open = tickets.filter((tk) => tk.status === 'open').length;
  const resolved = tickets.length - open;
  return (
    <button
      type="button"
      className={`${styles.dependencyToggle} ${styles.teamNowrap}`}
      style={style}
      aria-expanded={expanded}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      {expanded ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
      Dependencies ({tickets.length})
      <span className={styles.depCountOpen} title={`${open} open`} aria-label={`${open} open`}>{open}</span>
      <span className={styles.depCountResolved} title={`${resolved} resolved`} aria-label={`${resolved} resolved`}>{resolved}</span>
    </button>
  );
}

// Backend-resolved filer name first (TeamDependencyRow.createdByName), so
// the card line and its "Filed by X" group header always agree.
const filerLabel = (row, labelForEmail) => row.createdByName || labelForEmail(row.createdByEmail);

// Inside a "Filed by X" group the group header already names the filer,
// so the line drops it.
function FiledByLine({ row, labelForEmail, grouped = false }) {
  const parent = `#${row.parentTaskId}${row.parentTaskTitle ? ` ${row.parentTaskTitle}` : ''}`;
  return grouped ? <>on {parent}</> : <>Filed by {filerLabel(row, labelForEmail)} on {parent}</>;
}

// "Filed by X (n)" band above each group of dependency cards (Tiles) or
// rows (Table). `count` is the filer's total across all pages.
function FiledByGroupHeader({ label, count, inTable }) {
  return (
    <div role="heading" aria-level={3} className={`${styles.filedByHeader} ${inTable ? styles.filedByHeaderInTable : ''}`}>
      Filed by {label} ({count})
    </div>
  );
}

// Same layout as TaskTile below (ticket number + type tag + status tag,
// Title headline, module/assignee/due meta line), with the dependency's
// own differences: DEPENDENCY tag, no priority (a ticket has none), the
// parent task's due date labeled "Task due", and an "on #id Task" line.
function DependencyTile({ row, assigneeLabel, labelForEmail }) {
  const href = dependencyHref(row);
  const open = () => openInNewTab(row);
  return (
    <div
      className={`${styles.taskTile} ${styles.railDependency}`}
      role="button"
      tabIndex={0}
      aria-label={`Open dependency #${row.id}: ${row.title}`}
      onClick={open}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      }}
    >
      <div className={styles.taskTileTop}>
        <div className={styles.taskTileTopLeft}>
          <Link
            href={href}
            className={styles.teamTaskId}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
          >
            #{row.id}
          </Link>
          <span className={`${styles.typeTag} ${styles.typeTagDependency}`}>Dependency</span>
        </div>
        <div className={styles.taskTileBadges}>
          <Badge tone="warning">{row.status}</Badge>
        </div>
      </div>
      <div className={styles.taskTileDesc} title={row.title}>
        {row.title}
      </div>
      <div className={styles.taskTileMeta}>
        {row.moduleName !== undefined && (
          <span title={row.projectName || undefined}><Layers size={12} aria-hidden="true" /> {row.moduleName || '—'}</span>
        )}
        {assigneeLabel && <span><User size={12} aria-hidden="true" /> {assigneeLabel}</span>}
        <span><CalendarClock size={12} aria-hidden="true" /> Task due {formatDate(row.dueDate)}</span>
      </div>
      <div className={`${styles.dependencyRaisedBy} ${styles.teamOneLine}`} title={`Filed by ${filerLabel(row, labelForEmail)} on #${row.parentTaskId}${row.parentTaskTitle ? ` ${row.parentTaskTitle}` : ''}`}>
        <FiledByLine row={row} labelForEmail={labelForEmail} grouped />
      </div>
    </div>
  );
}

function TaskTile({ task, assigneeLabel, railClass, expanded, onToggleExpand }) {
  const depCount = task.dependencyTickets?.length || 0;
  const onOpen = () => openInNewTab(task);
  return (
    <div
      className={`${styles.taskTile} ${railClass || ''}`}
      role="button"
      tabIndex={0}
      aria-label={`Open task #${task.id}: ${task.title}`}
      onClick={onOpen}
      onKeyDown={(e) => {
        // Only the tile itself, not a nested link/button (which already
        // handle their own Enter/Space), should trigger onOpen.
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <div className={styles.taskTileTop}>
        <div className={styles.taskTileTopLeft}>
          <Link
            href={`/tasks/${task.id}`}
            className={styles.teamTaskId}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
          >
            #{task.id}
          </Link>
          <span className={`${styles.typeTag} ${task.isDefect ? styles.typeTagDefect : styles.typeTagTask}`}>
            {task.isDefect ? 'Defect' : 'Task'}
          </span>
        </div>
        <div className={styles.taskTileBadges}>
          {task.priority && <Badge tone={priorityTone(task.priority)}>{priorityLabel(task.priority)}</Badge>}
          <span className={styles.badge} style={statusBadgeStyle(task.status)}>{statusLabel(task.status)}</span>
        </div>
      </div>
      <div className={styles.taskTileDesc} title={task.title}>
        {task.title}
      </div>
      <div className={styles.taskTileMeta}>
        <span><Layers size={12} aria-hidden="true" /> {task.moduleName || '—'}</span>
        {assigneeLabel && <span><User size={12} aria-hidden="true" /> {assigneeLabel}</span>}
        <span className={isOverdueTask(task) ? styles.dueDateOverdue : undefined}>
          <CalendarClock size={12} aria-hidden="true" /> {formatDate(task.dueDate)}
        </span>
      </div>
      {depCount > 0 && (
        <DependencyToggle
          tickets={task.dependencyTickets}
          expanded={expanded}
          onToggle={() => onToggleExpand(task.id)}
          style={{ marginTop: 'var(--ds-space-3)', alignSelf: 'flex-start' }}
        />
      )}
      {expanded && depCount > 0 && (
        <div style={{ marginTop: 'var(--space-2)' }} onClick={(e) => e.stopPropagation()}>
          <DependencyTree tickets={task.dependencyTickets} />
        </div>
      )}
    </div>
  );
}

// Fixed widths for every column except Title, which takes the rest
// (Table's fixedLayout). Priority and dependency tickets have no column
// of their own - both are empty on most rows, so they show in the Title
// cell instead (confirmed with the user 2026-10-06/07). No Created column
// either: Age already says the same thing, with the exact date on hover.
// `assigneeLabel` null drops the Assignee column (one person's list).
export function buildTaskColumns({ assigneeLabel, labelForEmail, expandedTaskIds, toggleExpanded }) {
  return [
    {
      key: 'id',
      header: <ColHeader label="#" tooltip="Ticket ID" showLabel />,
      width: 64,
      sortable: true,
      render: (t) => (
        <Link
          href={rowHref(t)}
          className={styles.teamTaskId}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
        >
          #{t.id}
        </Link>
      ),
    },
    ...(assigneeLabel
      ? [
          {
            key: 'assigneeEmail',
            header: <ColHeader icon={User} label="Assignee" showLabel />,
            width: 140,
            sortable: true,
            render: (t) => {
              const name = assigneeLabel(t);
              return name ? <span className={styles.teamOneLine} title={name}>{name}</span> : <EmptyValue />;
            },
          },
        ]
      : []),
    {
      key: 'title',
      header: <ColHeader icon={FileText} label="Title" showLabel />,
      sortable: true,
      render: (t, { grouped } = {}) => {
        const dep = isDependencyRow(t);
        const typeTag = dep ? (
          <span className={`${styles.typeTag} ${styles.typeTagDependency}`}>Dependency</span>
        ) : (
          <span className={`${styles.typeTag} ${t.isDefect ? styles.typeTagDefect : styles.typeTagTask}`}>
            {t.isDefect ? 'Defect' : 'Task'}
          </span>
        );
        const filedBy = dep
          ? `Filed by ${filerLabel(t, labelForEmail)} on #${t.parentTaskId}${t.parentTaskTitle ? ` ${t.parentTaskTitle}` : ''}`
          : null;
        const depTickets = dep ? [] : t.dependencyTickets || [];
        return (
          <div className={styles.teamTitleCell}>
            <div className={styles.teamTitleBadges}>
              {typeTag}
              {!dep && t.priority && <Badge tone={priorityTone(t.priority)}>{priorityLabel(t.priority)}</Badge>}
            </div>
            <span className={styles.teamTitleClamp} title={t.title}>{t.title}</span>
            {filedBy && (
              <span className={`${styles.dependencyRaisedBy} ${styles.teamOneLine}`} title={filedBy}>
                <FiledByLine row={t} labelForEmail={labelForEmail} grouped={grouped} />
              </span>
            )}
            {depTickets.length > 0 && (
              <DependencyToggle
                tickets={depTickets}
                expanded={expandedTaskIds.has(t.id)}
                onToggle={() => toggleExpanded(t.id)}
                style={{ alignSelf: 'flex-start' }}
              />
            )}
          </div>
        );
      },
    },
    {
      key: 'status',
      header: <ColHeader icon={Activity} label="Status" showLabel />,
      width: 124,
      align: 'center',
      sortable: true,
      render: (t) =>
        isDependencyRow(t) ? (
          <Badge tone="warning">{t.status}</Badge>
        ) : (
          <span className={`${styles.badge} ${styles.teamNowrap}`} style={statusBadgeStyle(t.status)}>{statusLabel(t.status)}</span>
        ),
    },
    {
      key: 'dueDate',
      header: <ColHeader icon={CalendarClock} label="Due" tooltip="Due date (dependency: its parent task's due date, labelled Task due)" showLabel />,
      width: 112,
      align: 'center',
      sortable: true,
      render: (t) => {
        if (!t.dueDate) return <EmptyValue />;
        if (isDependencyRow(t)) {
          // A ticket has no due date of its own - this is the parent
          // task's, labelled so it isn't read as the ticket's deadline.
          return (
            <span className={styles.teamParentDue} title={`Due date of parent task #${t.parentTaskId}`}>
              <span className={styles.teamParentDueLabel}>Task due</span>
              <span className={styles.teamNowrap}>{formatDate(t.dueDate)}</span>
            </span>
          );
        }
        return (
          <span className={`${styles.teamNowrap} ${isOverdueTask(t) ? styles.dueDateOverdue : ''}`}>{formatDate(t.dueDate)}</span>
        );
      },
    },
    {
      key: 'estimatedHours',
      header: <ColHeader icon={Clock} label="Est. hrs" tooltip="Estimated hours" showLabel />,
      width: 104,
      align: 'center',
      sortable: true,
      render: (t) => (t.estimatedHours == null ? <EmptyValue /> : t.estimatedHours),
    },
    {
      key: 'percentComplete',
      header: <ColHeader icon={PercentCircle} label="Done %" tooltip="Completed %" showLabel />,
      width: 112,
      align: 'center',
      sortable: true,
      render: (t) => <ProgressBar percent={t.percentComplete} />,
    },
    {
      key: 'ageingDays',
      header: (
        <ColHeader
          icon={Hourglass}
          label="Age"
          tooltip="Whole days since the task was created (dependency: since it was filed). 0d = under a day. Hover a value for the exact date."
          showLabel
        />
      ),
      width: 84,
      align: 'right',
      sortable: true,
      render: (t) => (
        <span
          className={`${styles.teamNowrap} ${styles.teamAge}`}
          title={`${isDependencyRow(t) ? 'Filed' : 'Created'} ${formatDate(t.createdAt)}`}
        >
          {t.ageingDays}d
        </span>
      ),
    },
  ];
}

// Table view: section headers ("Tasks (n)" etc.) and "Filed by X (n)"
// sub-headers as full-width rows, column sort kept inside each section.
// `rows` must already be in section order (see sortBySections /
// useSectionSort).
export function TaskSectionsTable({
  rows, columns, sort, onSortChange, sectionCounts, filerCount, labelForEmail, rowTintClass,
  expandedTaskIds, emptyState, className, minWidth = 1040,
}) {
  return (
    <Table
      columns={columns}
      fixedLayout
      minWidth={minWidth}
      bodyVerticalAlign="middle"
      sortKey={sort ? sort.key : null}
      sortDir={sort ? sort.dir : 'asc'}
      onSortChange={onSortChange}
      groupHeader={(t, prev) => {
        const sec = sectionOf(t);
        const newSection = !prev || sectionOf(prev) !== sec;
        const newFiler = isDependencyRow(t) && (newSection || prev.createdByEmail !== t.createdByEmail);
        if (!newSection && !newFiler) return null;
        const def = SECTIONS.find((x) => x.key === sec);
        return (
          <>
            {newSection && <SectionHeader label={def.label} count={sectionCounts[sec] || 0} inTable />}
            {newFiler && <FiledByGroupHeader label={filerLabel(t, labelForEmail)} count={filerCount(t)} inTable />}
          </>
        );
      }}
      rows={rows}
      getRowId={(t) => (isDependencyRow(t) ? `dep-${t.id}` : t.id)}
      onRowClick={openInNewTab}
      rowClassName={(t) => (isDependencyRow(t) ? '' : rowTintClass[t.status] || '')}
      emptyState={emptyState}
      className={className}
      expandedContent={(t) =>
        !isDependencyRow(t) && expandedTaskIds.has(t.id) && t.dependencyTickets?.length > 0 ? (
          <DependencyTree tickets={t.dependencyTickets} />
        ) : null
      }
    />
  );
}

// Tiles view: the same rows split into sections (empty ones skipped),
// with Dependencies further split into "Filed by" groups. `assigneeLabel`
// null leaves the assignee off every card (one person's list).
export function TaskSectionsTiles({
  rows, sectionCounts, filerCount, labelForEmail, assigneeLabel, railClass,
  expandedTaskIds, toggleExpanded, emptyState, className,
}) {
  const sections = useMemo(
    () =>
      SECTIONS.map((sec) => {
        const secRows = rows.filter((t) => sectionOf(t) === sec.key);
        if (sec.key !== 'dependencies') return { ...sec, rows: secRows };
        const groups = [];
        for (const t of secRows) {
          if (groups.length > 0 && groups[groups.length - 1].email === t.createdByEmail) groups[groups.length - 1].rows.push(t);
          else groups.push({ email: t.createdByEmail, rows: [t] });
        }
        return { ...sec, rows: secRows, groups };
      }).filter((sec) => sec.rows.length > 0),
    [rows],
  );
  const labelFor = (t) => (assigneeLabel ? assigneeLabel(t) || '—' : null);
  return (
    <div className={className}>
      {rows.length === 0 && <div className={styles.card}>{emptyState}</div>}
      {sections.map((sec) => (
        <section key={sec.key} className={styles.teamSection}>
          <SectionHeader label={sec.label} count={sectionCounts[sec.key] || sec.rows.length} />
          {sec.groups ? (
            sec.groups.map((g) => (
              <section key={`filer-${g.email}`} className={styles.filedByGroup}>
                <FiledByGroupHeader label={filerLabel(g.rows[0], labelForEmail)} count={filerCount(g.rows[0])} />
                <div className={styles.taskTileGrid}>
                  {g.rows.map((t) => (
                    <DependencyTile key={`dep-${t.id}`} row={t} assigneeLabel={labelFor(t)} labelForEmail={labelForEmail} />
                  ))}
                </div>
              </section>
            ))
          ) : (
            <div className={styles.taskTileGrid}>
              {sec.rows.map((t) => (
                <TaskTile
                  key={t.id}
                  task={t}
                  assigneeLabel={labelFor(t)}
                  railClass={railClass[t.status]}
                  expanded={expandedTaskIds.has(t.id)}
                  onToggleExpand={toggleExpanded}
                />
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

const VIEW_MODES = {
  table: { label: 'Table', icon: List },
  tile: { label: 'Tiles', icon: LayoutGrid },
  workload: { label: 'Workload', icon: Users },
};

// Table | Tiles (| Workload on Team Tasks) toggle, as a labelled filter
// bar group.
export function ViewToggle({ id, value, onChange, modes = ['table', 'tile'] }) {
  return (
    <div className={styles.filterGroup}>
      <span className={styles.filterLabel} id={id}>View</span>
      <div className={styles.viewToggle} role="group" aria-labelledby={id}>
        {modes.map((mode) => {
          const { label, icon: Icon } = VIEW_MODES[mode];
          return (
            <button
              key={mode}
              type="button"
              className={`${styles.viewToggleButton} ${value === mode ? styles.viewToggleActive : ''}`}
              aria-pressed={value === mode}
              onClick={() => onChange(mode)}
            >
              <Icon size={14} aria-hidden="true" /> {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Colour key for the row tints / status colours. Each dot is the status's
// solid hue (clearly visible, 3:1 against the page) ringed by its lighter
// row tint, so it still reads as matching the rows (2026-10-07).
export function StatusLegend({ items }) {
  return (
    <div className={styles.statusLegend}>
      {items.map((item) => (
        <span key={item.label} className={styles.statusLegendItem}>
          <span
            className={styles.statusLegendDot}
            style={{ background: item.dot, boxShadow: `0 0 0 2px ${item.swatch}` }}
            aria-hidden="true"
          />
          {item.label}
        </span>
      ))}
    </div>
  );
}
