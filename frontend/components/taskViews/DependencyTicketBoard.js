import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, CalendarClock, CalendarDays, Activity, FileText, Users, Link2 } from 'lucide-react';
import Table from '../ui/Table';
import Badge from '../ui/Badge';
import ColHeader from '../ColHeader';
import styles from '../../styles/issues.module.css';
import { todayISO } from '../../lib/developerTaskStats';
import { priorityTone, priorityLabel } from '../../lib/taskTableShared';
import { formatDate } from '../../lib/formatDate';
import { SectionHeader, ViewToggle } from './TaskSections';

// Dependency tickets for one user, in either direction (2026-10-07,
// confirmed with the user):
//   'outbound' - GET /task-dependency-tickets/mine: filed against me by
//                someone else, I must clear it ("Waiting on you").
//   'inbound'  - GET /task-dependency-tickets/created-by-me: I filed it,
//                someone else must clear it ("You're waiting on").
// Used by the Developer Dashboard / My Tasks tiles and the Dependency
// Clearance page. Same Table | Tiles toggle, section headers and tile grid
// as Team Tasks / My Tasks (TaskSections.js); the ticket columns and card
// are its own, since a ticket isn't a task. Everything is client-side -
// both endpoints return the user's whole list.
//
// Tickets have no due date of their own - "Task due" is the parent task's.
// They have no replies either, so Last activity is the latest of raised /
// resolved until a replies feature exists.

const DAY_MS = 86400000;
const daysBetween = (fromISO, toISO) => Math.round((Date.parse(toISO) - Date.parse(fromISO)) / DAY_MS);
const daysAgo = (date) => Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / DAY_MS));
const agoText = (date) => {
  const d = daysAgo(date);
  return d === 0 ? 'today' : `${d}d ago`;
};

const nameOrEmail = (name, email) => name || email || '—';
const ticketHref = (t) => `/tasks/${t.parentTaskId}#dependency-${t.id}`;
const openTicket = (t) => window.open(ticketHref(t), '_blank', 'noopener,noreferrer');

const SORTS = {
  due: { label: 'Task due date' },
  raised: { label: 'Raised date' },
  activity: { label: 'Last activity' },
};

function withDerived(ticket, today) {
  const open = ticket.status === 'open';
  const due = ticket.parentTaskDueDate || null;
  const overdueDays = open && due && due < today ? daysBetween(due, today) : 0;
  const lastActivityAt = ticket.resolvedAt && new Date(ticket.resolvedAt) > new Date(ticket.createdAt) ? ticket.resolvedAt : ticket.createdAt;
  return {
    ...ticket,
    open,
    due,
    overdueDays,
    lastActivityAt,
    lastActivityText: ticket.resolvedAt ? `Resolved ${agoText(ticket.resolvedAt)}` : `Raised ${agoText(ticket.createdAt)}`,
    fromName: nameOrEmail(ticket.createdByName, ticket.createdByEmail),
    toName: nameOrEmail(ticket.ownerName, ticket.ownerEmail),
  };
}

function compareTickets(sortKey) {
  return (a, b) => {
    if (sortKey === 'raised') return new Date(b.createdAt) - new Date(a.createdAt) || b.id - a.id;
    if (sortKey === 'activity') return new Date(b.lastActivityAt) - new Date(a.lastActivityAt) || b.id - a.id;
    // Task due date: soonest first, so overdue comes first; none last.
    if (a.due !== b.due) {
      if (!a.due) return 1;
      if (!b.due) return -1;
      return a.due < b.due ? -1 : 1;
    }
    return a.id - b.id;
  };
}

function StatusBadge({ ticket }) {
  return <Badge tone={ticket.open ? 'warning' : 'success'}>{ticket.open ? 'Open' : 'Resolved'}</Badge>;
}

// Task due: the date, then OVERDUE + "n days overdue" in red when past,
// or a grey "No due date".
function DueInfo({ ticket, inline = false }) {
  const icon = inline && <CalendarClock size={12} aria-hidden="true" />;
  if (!ticket.due) return <span className={inline ? styles.ticketDueInline : styles.ticketNoDue}>{icon}<span className={styles.ticketNoDue}>No due date</span></span>;
  return (
    <span className={inline ? styles.ticketDueInline : styles.ticketDue}>
      <span className={styles.teamNowrap}>
        {icon}{inline && ' Task due '}
        {formatDate(ticket.due)}
      </span>
      {ticket.overdueDays > 0 && (
        <span className={styles.teamNowrap}>
          <Badge tone="error">Overdue</Badge>{' '}
          <span className={styles.ticketOverdueText}>
            {ticket.overdueDays} {ticket.overdueDays === 1 ? 'day' : 'days'} overdue
          </span>
        </span>
      )}
    </span>
  );
}

// Filed by → must be cleared by, as display names. The arrow is an icon
// (the app font has no → glyph), with "to" for screen readers.
function FromTo({ ticket }) {
  return (
    <span className={`${styles.ticketFromTo} ${styles.teamOneLine}`} title={`Filed by ${ticket.fromName}, must be cleared by ${ticket.toName}`}>
      {ticket.fromName} <ArrowRight size={13} aria-hidden="true" className={styles.ticketArrow} />
      <span className="sr-only">to</span> {ticket.toName}
    </span>
  );
}

// "#79 Tariff Policy config" (link) then module · phase and the parent
// task's priority - one line each, ellipsis + tooltip when long.
function ParentTask({ ticket }) {
  const title = `#${ticket.parentTaskId}${ticket.parentTaskTitle ? ` ${ticket.parentTaskTitle}` : ''}`;
  const context = [ticket.parentTaskModuleName, ticket.parentTaskPhaseName].filter(Boolean).join(' · ');
  return (
    <div className={styles.ticketParent}>
      <span className={styles.teamOneLine} title={title}>
        <Link2 size={12} aria-hidden="true" />{' '}
        <Link
          href={`/tasks/${ticket.parentTaskId}`}
          className={styles.ticketParentLink}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
        >
          {title}
        </Link>
      </span>
      {(context || ticket.parentTaskPriority) && (
        <span className={styles.ticketParentMeta}>
          {context && <span className={styles.teamOneLine} title={[ticket.parentTaskProjectName, context].filter(Boolean).join(' · ')}>{context}</span>}
          {ticket.parentTaskPriority && <Badge tone={priorityTone(ticket.parentTaskPriority)}>{priorityLabel(ticket.parentTaskPriority)}</Badge>}
        </span>
      )}
    </div>
  );
}

function TicketId({ ticket }) {
  return (
    <Link
      href={ticketHref(ticket)}
      className={styles.teamTaskId}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
    >
      #{ticket.id}
    </Link>
  );
}

function TicketTile({ ticket }) {
  const rail = !ticket.open ? styles.railMoss : ticket.overdueDays > 0 ? styles.railRed : styles.railDependency;
  return (
    <div
      className={`${styles.taskTile} ${rail}`}
      role="button"
      tabIndex={0}
      aria-label={`Open dependency #${ticket.id}: ${ticket.title}`}
      onClick={() => openTicket(ticket)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openTicket(ticket);
        }
      }}
    >
      <div className={styles.taskTileTop}>
        <div className={styles.taskTileTopLeft}>
          <TicketId ticket={ticket} />
          <span className={`${styles.typeTag} ${styles.typeTagDependency}`}>Dependency</span>
        </div>
        <div className={styles.taskTileBadges}>
          <StatusBadge ticket={ticket} />
        </div>
      </div>
      <div className={styles.taskTileDesc} title={ticket.description || ticket.title}>
        {ticket.title}
      </div>
      <FromTo ticket={ticket} />
      <ParentTask ticket={ticket} />
      <div className={styles.ticketTileFooter}>
        <span className={styles.teamNowrap}>
          <CalendarDays size={12} aria-hidden="true" /> Raised {formatDate(ticket.createdAt)} · {agoText(ticket.createdAt)}
        </span>
        <DueInfo ticket={ticket} inline />
        <span className={styles.ticketActivity}>
          <Activity size={12} aria-hidden="true" /> {ticket.lastActivityText}
        </span>
      </div>
    </div>
  );
}

const COLUMNS = [
  { key: 'id', header: <ColHeader label="#" tooltip="Dependency ticket ID" showLabel />, width: 64, render: (t) => <TicketId ticket={t} /> },
  {
    key: 'title',
    header: <ColHeader icon={FileText} label="Ticket" tooltip="Ticket title, then its parent task" showLabel />,
    render: (t) => (
      <div className={styles.teamTitleCell}>
        <span className={styles.teamTitleClamp} title={t.description || t.title}>{t.title}</span>
        <ParentTask ticket={t} />
      </div>
    ),
  },
  {
    key: 'fromTo',
    header: <ColHeader icon={Users} label="From / To" tooltip="Filed by, then who must clear it" showLabel />,
    width: 200,
    render: (t) => <FromTo ticket={t} />,
  },
  { key: 'status', header: <ColHeader icon={Activity} label="Status" showLabel />, width: 104, align: 'center', render: (t) => <StatusBadge ticket={t} /> },
  {
    key: 'raised',
    header: <ColHeader icon={CalendarDays} label="Raised" showLabel />,
    width: 120,
    align: 'center',
    render: (t) => (
      <span className={styles.ticketDue}>
        <span className={styles.teamNowrap}>{formatDate(t.createdAt)}</span>
        <span className={styles.ticketSubtle}>{agoText(t.createdAt)}</span>
      </span>
    ),
  },
  {
    key: 'due',
    header: <ColHeader icon={CalendarClock} label="Task due" tooltip="The parent task's due date - tickets have none of their own" showLabel />,
    width: 168,
    align: 'center',
    render: (t) => <DueInfo ticket={t} />,
  },
  {
    key: 'activity',
    header: <ColHeader icon={Activity} label="Last activity" tooltip="Latest of raised / resolved" showLabel />,
    width: 132,
    align: 'center',
    render: (t) => <span className={styles.ticketSubtle}>{t.lastActivityText}</span>,
  },
];

export default function DependencyTicketBoard({ tickets, direction, title, storageKey, userId, loading, headingLevel = 2 }) {
  const isOutbound = direction === 'outbound';
  const personLabel = isOutbound ? 'Filed by' : 'Assigned to';
  const personOf = (t) => (isOutbound ? t.fromName : t.toName);

  const [statusFilter, setStatusFilter] = useState('open');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [personFilter, setPersonFilter] = useState('All');
  const [moduleFilter, setModuleFilter] = useState('All');
  const [sortKey, setSortKey] = useState('due');
  const [groupBy, setGroupBy] = useState('none');
  const [viewMode, setViewMode] = useState('table');

  // Per user, browser storage only - same as My Tasks' view choice.
  const viewModeStorageKey = `${storageKey}ViewMode:${userId}`;
  useEffect(() => {
    const stored = localStorage.getItem(viewModeStorageKey);
    if (stored === 'table' || stored === 'tile') setViewMode(stored);
  }, [viewModeStorageKey]);
  const handleViewModeChange = (mode) => {
    setViewMode(mode);
    localStorage.setItem(viewModeStorageKey, mode);
  };

  const all = useMemo(() => {
    const today = todayISO();
    return tickets.map((t) => withDerived(t, today));
  }, [tickets]);

  const people = useMemo(() => [...new Set(all.map(personOf))].sort((a, b) => a.localeCompare(b)), [all, isOutbound]); // eslint-disable-line react-hooks/exhaustive-deps
  const modules = useMemo(() => [...new Set(all.map((t) => t.parentTaskModuleName).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [all]);

  const rows = useMemo(() => {
    const filtered = all.filter((t) => {
      if (statusFilter === 'open' && !t.open) return false;
      if (statusFilter === 'resolved' && t.open) return false;
      if (overdueOnly && t.overdueDays === 0) return false;
      if (personFilter !== 'All' && personOf(t) !== personFilter) return false;
      if (moduleFilter !== 'All' && t.parentTaskModuleName !== moduleFilter) return false;
      return true;
    });
    const groupKey = (t) => (groupBy === 'status' ? (t.open ? '0' : '1') : groupBy === 'person' ? personOf(t) : '');
    const cmp = compareTickets(sortKey);
    return filtered.sort((a, b) => groupKey(a).localeCompare(groupKey(b)) || cmp(a, b));
  }, [all, statusFilter, overdueOnly, personFilter, moduleFilter, sortKey, groupBy]); // eslint-disable-line react-hooks/exhaustive-deps

  const groupLabel = (t) => (groupBy === 'status' ? (t.open ? 'Open' : 'Resolved') : groupBy === 'person' ? `${personLabel} ${personOf(t)}` : null);
  const groupCounts = useMemo(() => {
    const m = new Map();
    for (const t of rows) m.set(groupLabel(t), (m.get(groupLabel(t)) || 0) + 1);
    return m;
  }, [rows, groupBy]); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = useMemo(() => {
    const out = [];
    for (const t of rows) {
      const label = groupLabel(t);
      if (out.length > 0 && out[out.length - 1].label === label) out[out.length - 1].rows.push(t);
      else out.push({ label, rows: [t] });
    }
    return out;
  }, [rows, groupBy]); // eslint-disable-line react-hooks/exhaustive-deps

  const emptyState = loading
    ? 'Loading...'
    : all.length === 0
      ? isOutbound
        ? 'No dependency tickets have been filed against you.'
        : "You haven't filed any dependency tickets."
      : 'No tickets match these filters.';

  const id = `ticketBoard-${direction}`;

  return (
    <section aria-labelledby={`${id}-heading`}>
      <div role="heading" aria-level={headingLevel} id={`${id}-heading`} className={styles.teamSectionHeader}>
        {title} <span className={styles.teamSectionCount}>({loading ? '–' : rows.length})</span>
      </div>

      <div className={`${styles.filterBar} ${styles.teamFilterBar}`}>
        <div className={styles.filterGroup}>
          <label className={styles.filterLabel} htmlFor={`${id}-status`}>Status</label>
          <select id={`${id}-status`} className={styles.filterSelect} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="open">Open</option>
            <option value="resolved">Resolved</option>
            <option value="all">All</option>
          </select>
        </div>
        <div className={styles.filterGroup}>
          <label className={styles.filterLabel} htmlFor={`${id}-person`}>{personLabel}</label>
          <select id={`${id}-person`} className={styles.filterSelect} value={personFilter} onChange={(e) => setPersonFilter(e.target.value)}>
            <option value="All">All</option>
            {people.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div className={styles.filterGroup}>
          <label className={styles.filterLabel} htmlFor={`${id}-module`}>Module</label>
          <select id={`${id}-module`} className={styles.filterSelect} value={moduleFilter} onChange={(e) => setModuleFilter(e.target.value)}>
            <option value="All">All</option>
            {modules.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div className={styles.filterGroup}>
          <span className={styles.filterLabel} id={`${id}-overdue-label`}>Overdue</span>
          <label className={styles.teamCheckChip}>
            <input
              type="checkbox"
              checked={overdueOnly}
              aria-labelledby={`${id}-overdue-label ${id}-overdue-text`}
              onChange={(e) => setOverdueOnly(e.target.checked)}
            />
            <span id={`${id}-overdue-text`}>Only</span>
          </label>
        </div>
        <div className={styles.filterGroup}>
          <label className={styles.filterLabel} htmlFor={`${id}-sort`}>Sort by</label>
          <select id={`${id}-sort`} className={styles.filterSelect} value={sortKey} onChange={(e) => setSortKey(e.target.value)}>
            {Object.entries(SORTS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
          </select>
        </div>
        <div className={styles.filterGroup}>
          <label className={styles.filterLabel} htmlFor={`${id}-group`}>Group by</label>
          <select id={`${id}-group`} className={styles.filterSelect} value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
            <option value="none">None</option>
            <option value="status">Status</option>
            <option value="person">{isOutbound ? 'Filed by' : 'Assigned to'}</option>
          </select>
        </div>
        <ViewToggle id={`${id}-view`} value={viewMode} onChange={handleViewModeChange} />
      </div>

      {viewMode === 'tile' ? (
        <div>
          {rows.length === 0 && <div className={styles.card}>{emptyState}</div>}
          {groups.map((g) => (
            <section key={g.label || 'all'} className={styles.teamSection}>
              {g.label && <SectionHeader label={g.label} count={groupCounts.get(g.label)} />}
              <div className={styles.taskTileGrid}>
                {g.rows.map((t) => <TicketTile key={t.id} ticket={t} />)}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <Table
          columns={COLUMNS}
          fixedLayout
          minWidth={1000}
          bodyVerticalAlign="middle"
          rows={rows}
          getRowId={(t) => t.id}
          onRowClick={openTicket}
          groupHeader={
            groupBy === 'none'
              ? undefined
              : (t, prev) =>
                  !prev || groupLabel(prev) !== groupLabel(t) ? (
                    <SectionHeader label={groupLabel(t)} count={groupCounts.get(groupLabel(t))} inTable />
                  ) : null
          }
          emptyState={emptyState}
        />
      )}
    </section>
  );
}

