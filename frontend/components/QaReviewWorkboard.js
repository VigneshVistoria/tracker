import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import {
  Hash, User, FolderKanban, FileText,
  ChevronDown, ChevronUp,
} from 'lucide-react';
import Table from './ui/Table';
import ColHeader from './ColHeader';
import styles from '../styles/issues.module.css';
import dashboardStyles from '../styles/dashboard.module.css';
import { todayISO, yesterdayISO } from '../lib/developerTaskStats';
import { LEGEND_ITEMS, buildRowTintClass } from '../lib/taskTableShared';

// QA Review queue - same icon-header/sortable table, row-tint, and
// stat-cards-as-filter-presets pattern as My Tasks (DeveloperTaskWorkboard),
// applied to the (much smaller, tenant-wide, unpaginated) set of tasks
// findQaQueue() returns. Columns are deliberately limited to the same
// information the previous plain card-list layout showed - this is a
// layout change, not a change to what QA sees or how "Review task" works.
//
// Unlike Team Tasks, this stays fully client-side like My Tasks: the
// queue is already a small, bounded list (status IN Feedback/Re-Feedback),
// not paginated by the backend, so filtering/sorting/the Assignee dropdown
// all just work off the array already fetched.

const ROW_TINT_CLASS = buildRowTintClass(styles);

// Only Feedback/Re-Feedback (both plum) can ever appear in this queue, so
// the legend only shows that one entry rather than the full 5-item legend
// My Tasks/Team Tasks show (Pass/Failed/Released can't occur here).
const QA_LEGEND_ITEMS = LEGEND_ITEMS.filter((item) => item.label.includes('Feedback'));

export default function QaReviewWorkboard({ tasks, loading, storageKey }) {
  const router = useRouter();

  const [activeCard, setActiveCard] = useState(null);
  const [statusFilter, setStatusFilter] = useState('All');
  const [assigneeFilter, setAssigneeFilter] = useState('All');
  const [dueFrom, setDueFrom] = useState('');
  const [dueTo, setDueTo] = useState('');

  useEffect(() => {
    const stored = localStorage.getItem(storageKey);
    if (stored) setActiveCard(stored);
    // storageKey is a static prop per page, not expected to change at runtime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Distinct list of assignees among the tasks currently in the queue, for
  // the new Assignee filter - derived client-side since this view has no
  // server-side pagination to drive a separate lookup off of.
  const assignees = useMemo(() => {
    const seen = new Map();
    tasks.forEach((t) => {
      if (t.assigneeEmail && !seen.has(t.assigneeEmail)) seen.set(t.assigneeEmail, t.assigneeEmail);
    });
    return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
  }, [tasks]);

  const resubmissionCount = useMemo(() => tasks.filter((t) => t.status === 'Re-Feedback').length, [tasks]);
  const overdueCount = useMemo(() => {
    const today = todayISO();
    return tasks.filter((t) => t.dueDate && t.dueDate < today).length;
  }, [tasks]);

  const cards = useMemo(
    () => [
      { key: 'pending', label: 'Pending QA Review', count: tasks.length, kind: 'table' },
      { key: 'resubmissions', label: 'Resubmissions', count: resubmissionCount, kind: 'table' },
      { key: 'overdue', label: 'Overdue', count: overdueCount, kind: 'table' },
    ],
    [tasks, resubmissionCount, overdueCount],
  );

  const handleCardClick = (card) => {
    setActiveCard((prev) => {
      const next = prev === card.key ? null : card.key;
      localStorage.setItem(storageKey, next || '');
      return next;
    });
    if (card.key === 'pending') {
      setStatusFilter('All'); setDueFrom(''); setDueTo('');
    } else if (card.key === 'resubmissions') {
      setStatusFilter('Re-Feedback'); setDueFrom(''); setDueTo('');
    } else if (card.key === 'overdue') {
      setStatusFilter('All'); setDueTo(yesterdayISO());
    }
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
      if (statusFilter !== 'All' && task.status !== statusFilter) return false;
      if (assigneeFilter !== 'All' && task.assigneeEmail !== assigneeFilter) return false;
      if (dueFrom && (!task.dueDate || task.dueDate < dueFrom)) return false;
      if (dueTo && (!task.dueDate || task.dueDate > dueTo)) return false;
      return true;
    });
  }, [tasks, statusFilter, assigneeFilter, dueFrom, dueTo]);

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
        key: 'description',
        header: <ColHeader icon={FileText} label="Description" />,
        sortable: true,
        render: (t) => (
          <span className={styles.descClamp} title={t.description}>
            {t.description}
          </span>
        ),
      },
    ],
    [],
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

      {activeCard && activeCardDef && (
        <>
          <div className={styles.statusLegend}>
            {QA_LEGEND_ITEMS.map((item) => (
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
                {assignees.map((email) => (
                  <option key={email} value={email}>{email}</option>
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
                <option value="All">All</option>
                <option value="Feedback">Feedback</option>
                <option value="Re-Feedback">Re-Feedback</option>
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
            onRowClick={(t) => router.push(`/tasks/${t.id}`)}
            rowClassName={(t) => ROW_TINT_CLASS[t.status] || ''}
            emptyState={
              tasks.length === 0
                ? 'No tasks are waiting on QA review right now.'
                : 'No tasks match these filters.'
            }
          />
        </>
      )}
    </>
  );
}
