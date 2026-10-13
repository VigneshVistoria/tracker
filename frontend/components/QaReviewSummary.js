import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Hash, FileText, Tag, FolderKanban, User, FlaskConical, CalendarClock, Activity, Repeat } from 'lucide-react';
import Table from './ui/Table';
import Badge from './ui/Badge';
import ColHeader from './ColHeader';
import styles from '../styles/issues.module.css';
import dashboardStyles from '../styles/dashboard.module.css';
import summaryStyles from '../styles/qaSummary.module.css';
import { statusBadgeStyle, statusLabel } from '../lib/taskTableShared';
import { formatDate, formatDateTime } from '../lib/formatDate';
import { apiFetch } from '../lib/api';

// QA Review summary (2026-10-13) - five tiles above the QA Review list,
// each one drilling down into exactly the tickets it counts. Every number
// and row comes from GET /tasks/qa-summary(/items), which build both from
// the same lists (QaSummaryService) - so a tile always equals its rows.
// Read-only, and separate from QaReviewWorkboard below it, which is
// unchanged.

const PERIODS = [
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: 'last30', label: 'Last 30 days' },
  { value: 'custom', label: 'Custom' },
];

const TILES = [
  { key: 'defectsRaised', label: 'Defects raised', when: 'Raised', defectsOnly: true },
  { key: 'approved', label: 'Approved', when: 'Approved' },
  { key: 'rejected', label: 'Rejected', when: 'Last rejected', accent: 'danger' },
  { key: 'waiting', label: 'Waiting for QA', when: 'Submitted', rightNow: true, accent: 'warning' },
  { key: 'refeedback', label: 'Re-feedback', when: 'Resubmitted', rightNow: true, accent: 'warning' },
];

const LEADERSHIP_ROLES = ['admin', 'program_manager', 'executive'];

// Dropdown options, keeping the current pick even if the new period has
// no rows for it - otherwise the select would read "All" while still
// filtering.
function withSelected(options, selected) {
  const list = options || [];
  if (selected === 'all' || list.some((o) => String(o.id) === selected)) return list;
  return [...list, { id: Number(selected), name: `#${selected}` }];
}

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

// The period as [from, to) in the viewer's own time zone - "to" is the
// start of the day after the last one included. Weeks start on Monday,
// same as KPI. Returns null for an incomplete/invalid Custom range.
function resolvePeriod(period, customFrom, customTo) {
  const today = startOfDay(new Date());
  if (period === 'week') {
    const offset = (today.getDay() + 6) % 7;
    const from = addDays(today, -offset);
    return { from, to: addDays(from, 7) };
  }
  if (period === 'last30') return { from: addDays(today, -29), to: addDays(today, 1) };
  if (period === 'custom') {
    if (!customFrom || !customTo || customTo < customFrom) return null;
    return { from: new Date(`${customFrom}T00:00:00`), to: addDays(new Date(`${customTo}T00:00:00`), 1) };
  }
  const from = new Date(today.getFullYear(), today.getMonth(), 1);
  return { from, to: new Date(today.getFullYear(), today.getMonth() + 1, 1) };
}

export default function QaReviewSummary({ user }) {
  const isLeadership = LEADERSHIP_ROLES.includes(user.role);
  const [period, setPeriod] = useState('month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [qaUserId, setQaUserId] = useState('all');
  const [projectId, setProjectId] = useState('all');
  const [developerUserId, setDeveloperUserId] = useState('all');
  const [activeTile, setActiveTile] = useState(null);

  const [summary, setSummary] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [error, setError] = useState('');

  const range = useMemo(() => resolvePeriod(period, customFrom, customTo), [period, customFrom, customTo]);

  const query = useMemo(() => {
    if (!range) return null;
    const params = new URLSearchParams({ from: range.from.toISOString(), to: range.to.toISOString() });
    if (isLeadership && qaUserId !== 'all') params.set('qaUserId', qaUserId);
    if (projectId !== 'all') params.set('projectId', projectId);
    if (developerUserId !== 'all') params.set('developerUserId', developerUserId);
    return params.toString();
  }, [range, isLeadership, qaUserId, projectId, developerUserId]);

  useEffect(() => {
    if (!query) return undefined;
    let cancelled = false;
    setLoading(true);
    apiFetch(`/tasks/qa-summary?${query}`)
      .then((res) => {
        if (cancelled) return;
        setSummary(res);
        setError('');
      })
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [query]);

  useEffect(() => {
    if (!query || !activeTile) {
      setRows([]);
      return undefined;
    }
    let cancelled = false;
    setRowsLoading(true);
    apiFetch(`/tasks/qa-summary/items?tile=${activeTile}&${query}`)
      .then((res) => {
        if (cancelled) return;
        setRows(res);
        setError('');
      })
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setRowsLoading(false));
    return () => {
      cancelled = true;
    };
  }, [query, activeTile]);

  const visibleTiles = TILES.filter((t) => !t.defectsOnly || summary?.includeDefects !== false);
  const activeDef = TILES.find((t) => t.key === activeTile);
  const periodText = range ? `${formatDate(range.from)} – ${formatDate(addDays(range.to, -1))}` : 'Pick a start and end date';
  const counts = summary?.counts;

  const columns = useMemo(() => {
    const showRounds = activeTile === 'waiting' || activeTile === 'refeedback';
    const showRejections = activeTile === 'rejected' || activeTile === 'refeedback';
    return [
      {
        key: 'id',
        header: <ColHeader icon={Hash} label="Ticket" />,
        width: 70,
        sortable: true,
        render: (r) => (
          <Link href={`/tasks/${r.id}`} className={styles.issueId} onClick={(e) => e.stopPropagation()}>
            #{r.id}
          </Link>
        ),
      },
      {
        key: 'title',
        header: <ColHeader icon={FileText} label="Title" />,
        sortable: true,
        render: (r) => <span className={styles.descClamp} title={r.title}>{r.title}</span>,
      },
      {
        key: 'isDefect',
        header: <ColHeader icon={Tag} label="Type" />,
        width: 90,
        sortable: true,
        render: (r) => <Badge tone={r.isDefect ? 'warning' : 'info'}>{r.isDefect ? 'Defect' : 'Task'}</Badge>,
      },
      {
        key: 'projectName',
        header: <ColHeader icon={FolderKanban} label="Project · Module" />,
        sortable: true,
        render: (r) => <span className={styles.issueMeta}>{r.projectName} &middot; {r.moduleName}</span>,
      },
      {
        key: 'developerName',
        header: <ColHeader icon={User} label="Developer" />,
        sortable: true,
        render: (r) => r.developerName || '—',
      },
      {
        key: 'qaName',
        header: <ColHeader icon={FlaskConical} label="QA" />,
        sortable: true,
        render: (r) => r.qaName || <span className={summaryStyles.anyQa}>Any QA</span>,
      },
      {
        key: 'happenedAt',
        header: <ColHeader icon={CalendarClock} label={activeDef?.when || 'When'} />,
        sortable: true,
        render: (r) => formatDateTime(r.happenedAt),
      },
      {
        key: 'status',
        header: <ColHeader icon={Activity} label="Status" />,
        sortable: true,
        render: (r) => <span className={styles.badge} style={statusBadgeStyle(r.status)}>{statusLabel(r.status)}</span>,
      },
      ...(showRounds
        ? [{ key: 'round', header: <ColHeader icon={Repeat} label="Round" />, width: 80, sortable: true, render: (r) => r.round ?? '—' }]
        : []),
      ...(showRejections
        ? [{ key: 'rejections', header: <ColHeader icon={Repeat} label="Rejections" />, width: 100, sortable: true, render: (r) => r.rejections ?? '—' }]
        : []),
    ];
  }, [activeTile, activeDef]);

  const decided = counts ? counts.approved + counts.rejected : 0;

  return (
    <section className={styles.card} aria-labelledby="qaSummaryTitle">
      <div className={summaryStyles.header}>
        <h2 id="qaSummaryTitle" className={summaryStyles.title}>Summary</h2>
        <span className={summaryStyles.periodLabel}>{periodText}</span>
      </div>

      <div className={styles.filterBar}>
        <div className={styles.filterGroup}>
          <label className={styles.filterLabel} htmlFor="qaSumPeriod">Period</label>
          <select id="qaSumPeriod" className={styles.filterSelect} value={period} onChange={(e) => setPeriod(e.target.value)}>
            {PERIODS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>
        {period === 'custom' && (
          <>
            <div className={styles.filterGroup}>
              <label className={styles.filterLabel} htmlFor="qaSumFrom">From</label>
              <input id="qaSumFrom" type="date" className={styles.filterSelect} value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
            </div>
            <div className={styles.filterGroup}>
              <label className={styles.filterLabel} htmlFor="qaSumTo">To</label>
              <input id="qaSumTo" type="date" className={styles.filterSelect} value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
            </div>
          </>
        )}
        {isLeadership && (
          <div className={styles.filterGroup}>
            <label className={styles.filterLabel} htmlFor="qaSumQa">QA</label>
            <select id="qaSumQa" className={styles.filterSelect} value={qaUserId} onChange={(e) => setQaUserId(e.target.value)}>
              <option value="all">All</option>
              {withSelected(summary?.qas, qaUserId).map((q) => (
                <option key={q.id} value={String(q.id)}>{q.name}</option>
              ))}
            </select>
          </div>
        )}
        <div className={styles.filterGroup}>
          <label className={styles.filterLabel} htmlFor="qaSumProject">Project</label>
          <select id="qaSumProject" className={styles.filterSelect} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="all">All</option>
            {withSelected(summary?.projects, projectId).map((p) => (
              <option key={p.id} value={String(p.id)}>{p.name}</option>
            ))}
          </select>
        </div>
        <div className={styles.filterGroup}>
          <label className={styles.filterLabel} htmlFor="qaSumDeveloper">Developer</label>
          <select id="qaSumDeveloper" className={styles.filterSelect} value={developerUserId} onChange={(e) => setDeveloperUserId(e.target.value)}>
            <option value="all">All</option>
            {withSelected(summary?.developers, developerUserId).map((d) => (
              <option key={d.id} value={String(d.id)}>{d.name}</option>
            ))}
          </select>
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      <div className={dashboardStyles.statsStrip}>
        {visibleTiles.map((tile) => {
          const selected = activeTile === tile.key;
          const count = counts ? counts[tile.key] : null;
          return (
            <button
              key={tile.key}
              type="button"
              className={`${dashboardStyles.statStripSegment} ${selected ? dashboardStyles.selected : ''}`}
              aria-pressed={selected}
              onClick={() => setActiveTile(selected ? null : tile.key)}
            >
              <div
                className={`${dashboardStyles.statStripValue} ${
                  loading || !count
                    ? dashboardStyles.statStripZero
                    : tile.accent === 'danger'
                      ? dashboardStyles.accentDanger
                      : tile.accent === 'warning'
                        ? dashboardStyles.accentWarning
                        : ''
                }`}
              >
                {loading || count === null ? '–' : count}
              </div>
              <div className={dashboardStyles.statStripLabel}>
                {tile.label}
                {tile.rightNow && <span> · right now</span>}
              </div>
            </button>
          );
        })}
      </div>

      <div className={summaryStyles.passRate}>
        {!loading && decided === 0 && <span>No approvals or rejections in this period.</span>}
        {!loading && decided > 0 && (
          <>
            <span>
              Pass rate <span className={summaryStyles.passRateValue}>{summary.passRate}%</span>
            </span>
            <div
              className={summaryStyles.bar}
              role="img"
              aria-label={`${counts.approved} approved, ${counts.rejected} rejected`}
            >
              <div className={summaryStyles.barApproved} style={{ width: `${(counts.approved / decided) * 100}%` }} />
              <div className={summaryStyles.barRejected} style={{ width: `${(counts.rejected / decided) * 100}%` }} />
            </div>
            <span>
              <span className={`${summaryStyles.legendDot} ${summaryStyles.barApproved}`} aria-hidden="true" />
              {counts.approved} approved
            </span>
            <span>
              <span className={`${summaryStyles.legendDot} ${summaryStyles.barRejected}`} aria-hidden="true" />
              {counts.rejected} rejected
            </span>
          </>
        )}
      </div>

      {activeDef && (
        <>
          <div className={summaryStyles.drillHeader}>
            <h3 className={summaryStyles.drillTitle}>
              {activeDef.label} · {activeDef.rightNow ? 'right now' : periodText}
              {!rowsLoading && ` · ${rows.length} ${rows.length === 1 ? 'ticket' : 'tickets'}`}
            </h3>
            <button type="button" className={summaryStyles.clearLink} onClick={() => setActiveTile(null)}>
              Clear filter
            </button>
          </div>
          <Table
            columns={columns}
            rows={rows}
            getRowId={(r) => r.id}
            onRowClick={(r) => window.open(`/tasks/${r.id}`, '_blank', 'noopener,noreferrer')}
            emptyState={rowsLoading ? 'Loading...' : 'No tickets in this tile.'}
          />
        </>
      )}
    </section>
  );
}
