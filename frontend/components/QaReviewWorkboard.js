import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Hash, User, FolderKanban, FileText, Flag, Activity, CalendarDays,
  ChevronDown, ChevronUp,
} from 'lucide-react';
import Table from './ui/Table';
import Badge from './ui/Badge';
import ColHeader from './ColHeader';
import styles from '../styles/issues.module.css';
import dashboardStyles from '../styles/dashboard.module.css';
import { yesterdayISO } from '../lib/developerTaskStats';
import { LEGEND_ITEMS, buildRowTintClass, priorityRank, priorityTone, priorityLabel, statusBadgeStyle } from '../lib/taskTableShared';
import { formatDate } from '../lib/formatDate';
import { stripHtmlForPreview } from '../lib/richText';
import { apiFetch } from '../lib/api';

// QA Review queue - same icon-header/sortable table, row-tint, and
// stat-cards-as-filter-presets pattern as My Tasks (DeveloperTaskWorkboard).
// Columns are deliberately limited to the same information the previous
// plain card-list layout showed - this is a layout change, not a change to
// what QA sees or how "Review task" works.
//
// Pending/Resubmissions/Overdue are the small, tenant-wide "queue" proper
// (status IN Feedback/Re-Feedback) - Approved/Rejected are already-decided
// tasks (Pass/Failed) that have left the queue entirely, so selecting
// either one re-fetches from the backend instead of filtering client-side,
// same server-driven-by-status-filter pattern TeamTaskWorkboard uses.
// Card counts (statCounts from the backend) are independent of whichever
// status is currently loaded into the table, so the five card numbers
// never change just because you clicked into a different one.

const ROW_TINT_CLASS = buildRowTintClass(styles);

// Feedback/Re-Feedback (plum), Pass (moss), and Failed (red) are the only
// statuses that can ever appear in this table now - Development and the
// two Released statuses can't, so they're left out of the legend here.
const QA_LEGEND_ITEMS = LEGEND_ITEMS.filter(
  (item) => item.label.includes('Feedback') || item.label === 'Pass' || item.label.startsWith('Failed'),
);

// My Defects (showDefectColumns) additionally includes Development and
// Escalated - unlike QA Review above, a defect stays open (and needs a
// legend swatch) the whole time it's with the Developer, not just while a
// QA review round is actually pending. See OPEN_DEFECT_STATUSES on the
// backend (TasksService.findDefectQueue()).
const DEFECT_LEGEND_ITEMS = LEGEND_ITEMS.filter(
  (item) => item.label === 'Development' || item.label.includes('Feedback') || item.label === 'Escalated' || item.label === 'Pass' || item.label.startsWith('Failed'),
);

const CARD_DEFS = [
  { key: 'pending', label: 'Pending QA Review', statusFilter: 'All' },
  { key: 'resubmissions', label: 'Resubmissions', statusFilter: 'Re-Feedback' },
  { key: 'overdue', label: 'Overdue', statusFilter: 'All', overdue: true },
  { key: 'approved', label: 'Approved', statusFilter: 'Pass' },
  { key: 'rejected', label: 'Rejected', statusFilter: 'Failed' },
];

// Same 5 cards as QA Review, just the first one relabeled - "Open" (not
// "Pending QA Review") since it now also covers a defect still sitting
// with the Developer in Development, not just ones actually pending a QA
// decision.
const DEFECT_CARD_DEFS = [
  { ...CARD_DEFS[0], label: 'Open' },
  ...CARD_DEFS.slice(1),
];

export default function QaReviewWorkboard({ storageKey, endpoint = '/tasks/qa-queue', showDefectColumns = false }) {
  const [activeCard, setActiveCard] = useState(null);
  const [statusFilter, setStatusFilter] = useState('All');
  const [assigneeFilter, setAssigneeFilter] = useState('All');
  const [dueFrom, setDueFrom] = useState('');
  const [dueTo, setDueTo] = useState('');

  const [tasks, setTasks] = useState([]);
  const [statCounts, setStatCounts] = useState({ pending: 0, resubmissions: 0, overdue: 0, approved: 0, rejected: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const stored = localStorage.getItem(storageKey);
    if (stored) setActiveCard(stored);
    // storageKey is a static prop per page, not expected to change at runtime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    if (statusFilter !== 'All') params.set('status', statusFilter);

    let cancelled = false;
    setLoading(true);
    apiFetch(`${endpoint}${params.toString() ? `?${params.toString()}` : ''}`)
      .then((res) => {
        if (cancelled) return;
        setTasks(res.tasks);
        setStatCounts(res.statCounts);
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
  }, [statusFilter, endpoint]);

  // Distinct list of assignees among the tasks currently loaded, for the
  // Assignee filter - rebuilds whenever the loaded set changes (e.g.
  // switching from Pending to Approved). The filter itself still matches
  // on email (see filteredTasks below) - only the dropdown's visible label
  // uses Full Name, falling back to email for anyone with none set.
  const assignees = useMemo(() => {
    const byEmail = new Map();
    tasks.forEach((t) => {
      if (t.assigneeEmail && !byEmail.has(t.assigneeEmail)) {
        byEmail.set(t.assigneeEmail, t.assigneeFullName || t.assigneeEmail);
      }
    });
    return Array.from(byEmail.entries())
      .map(([email, label]) => ({ email, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [tasks]);

  const cards = useMemo(
    () => (showDefectColumns ? DEFECT_CARD_DEFS : CARD_DEFS).map((c) => ({ ...c, count: statCounts[c.key] ?? 0 })),
    [statCounts, showDefectColumns],
  );

  const handleCardClick = (card) => {
    setActiveCard((prev) => {
      const next = prev === card.key ? null : card.key;
      localStorage.setItem(storageKey, next || '');
      return next;
    });
    setStatusFilter(card.statusFilter);
    setDueTo(card.overdue ? yesterdayISO() : '');
    setDueFrom('');
  };

  const handleGenericToggle = () => {
    setActiveCard((prev) => {
      const next = prev ? null : 'pending';
      localStorage.setItem(storageKey, next || '');
      return next;
    });
  };

  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      if (assigneeFilter !== 'All' && task.assigneeEmail !== assigneeFilter) return false;
      if (dueFrom && (!task.dueDate || task.dueDate < dueFrom)) return false;
      if (dueTo && (!task.dueDate || task.dueDate > dueTo)) return false;
      return true;
    });
  }, [tasks, assigneeFilter, dueFrom, dueTo]);

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
        render: (t) => t.assigneeFullName || t.assigneeEmail || '—',
      },
      {
        key: 'projectName',
        header: <ColHeader icon={FolderKanban} label="Project · Module · Phase" />,
        sortable: true,
        render: (t) => (
          <span className={styles.issueMeta}>
            {t.projectName} &middot; {t.moduleName} &middot; {t.phaseName}
          </span>
        ),
      },
      {
        key: 'title',
        header: <ColHeader icon={FileText} label="Title" />,
        sortable: true,
        render: (t) => (
          <span className={styles.descClamp} title={t.title}>
            {t.title}
            {showDefectColumns && stripHtmlForPreview(t.description) && (
              <span className={styles.issueMeta}>{stripHtmlForPreview(t.description)}</span>
            )}
          </span>
        ),
      },
      ...(showDefectColumns
        ? [
            {
              key: 'status',
              header: <ColHeader icon={Activity} label="Status" />,
              sortable: true,
              render: (t) => <span className={styles.badge} style={statusBadgeStyle(t.status)}>{t.status}</span>,
            },
            {
              key: 'createdAt',
              header: <ColHeader icon={CalendarDays} label="Date Created" />,
              sortable: true,
              render: (t) => formatDate(t.createdAt),
            },
          ]
        : []),
      {
        key: 'priority',
        header: <ColHeader icon={Flag} label="Priority" />,
        sortable: true,
        sortAccessor: (t) => priorityRank(t.priority),
        render: (t) => <Badge tone={priorityTone(t.priority)}>{priorityLabel(t.priority)}</Badge>,
      },
    ],
    [showDefectColumns],
  );

  const activeCardDef = cards.find((c) => c.key === activeCard);

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
            {(showDefectColumns ? DEFECT_LEGEND_ITEMS : QA_LEGEND_ITEMS).map((item) => (
              <span key={item.label} className={styles.statusLegendItem}>
                <span className={styles.statusLegendDot} style={{ background: item.swatch }} />
                {item.label}
              </span>
            ))}
          </div>

          <div className={styles.filterBar}>
            <div className={styles.filterGroup}>
              <label className={styles.filterLabel} htmlFor="qaAssigneeFilter">Assignee</label>
              <select
                id="qaAssigneeFilter"
                className={styles.filterSelect}
                value={assigneeFilter}
                onChange={(e) => setAssigneeFilter(e.target.value)}
              >
                <option value="All">All</option>
                {assignees.map((a) => (
                  <option key={a.email} value={a.email}>{a.label}</option>
                ))}
              </select>
            </div>

            <div className={styles.filterGroup}>
              <label className={styles.filterLabel} htmlFor="qaStatusFilter">Status</label>
              <select
                id="qaStatusFilter"
                className={styles.filterSelect}
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="All">{showDefectColumns ? 'All (Open)' : 'All (Feedback + Re-Feedback)'}</option>
                {showDefectColumns && <option value="Development">Development</option>}
                <option value="Feedback">Feedback</option>
                <option value="Re-Feedback">Re-Feedback</option>
                {showDefectColumns && <option value="Escalated">Escalated</option>}
                <option value="Pass">Approved</option>
                <option value="Failed">Rejected</option>
              </select>
            </div>

            <div className={styles.filterGroup}>
              <label className={styles.filterLabel} htmlFor="qaDueFrom">Due from</label>
              <input
                id="qaDueFrom"
                type="date"
                className={styles.filterSelect}
                value={dueFrom}
                onChange={(e) => setDueFrom(e.target.value)}
              />
            </div>

            <div className={styles.filterGroup}>
              <label className={styles.filterLabel} htmlFor="qaDueTo">Due to</label>
              <input
                id="qaDueTo"
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
            onRowClick={(t) => window.open(`/tasks/${t.id}`, '_blank', 'noopener,noreferrer')}
            rowClassName={(t) => ROW_TINT_CLASS[t.status] || ''}
            emptyState={loading ? 'Loading...' : 'No tasks match these filters.'}
          />
        </>
      )}
    </>
  );
}
