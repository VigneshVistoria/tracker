import { useEffect, useState } from 'react';
import { Gauge, AlertTriangle, CheckCircle2, XCircle, RotateCcw, GitBranch, Users } from 'lucide-react';
import AppShell from '../components/AppShell';
import TrendBarChart from '../components/TrendBarChart';
import CompletionVsTargetBar from '../components/CompletionVsTargetBar';
import StatCard from '../components/ui/StatCard';
import styles from '../styles/issues.module.css';
import { apiFetch } from '../lib/api';

const PERIOD_OPTIONS = [
  { value: 'day', label: 'Daily' },
  { value: 'week', label: 'Weekly' },
  { value: 'month', label: 'Monthly' },
];

const STATUS_STYLE = {
  Excellent: { background: 'var(--color-teal-tint)', color: 'var(--color-teal-dark)' },
  Good: { background: 'var(--color-amber-tint)', color: 'var(--color-amber-dark)' },
  'Needs Improvement': { background: 'var(--color-red-tint)', color: 'var(--color-red-dark)' },
};

// "Good" maps to the primary accent (not "warning") because its existing
// badge color (--color-amber, a legacy name that actually resolves to the
// app's blue) needs to keep matching between the badge and this card's
// border - StatCard's true semantic "warning" token is orange and would
// visually disagree with a badge right next to it.
const STATUS_ACCENT = { Excellent: 'success', Good: 'primary', 'Needs Improvement': 'error' };

function StatusBadge({ status }) {
  return (
    <span className={styles.badge} style={STATUS_STYLE[status]}>
      {status}
    </span>
  );
}

function toDateInputValue(date) {
  return date.toISOString().slice(0, 10);
}

// Previous period's date, for a period-over-period trend comparison -
// day-1 / week-1 / month-1 relative to the selected date.
function shiftDatePrevious(dateStr, period) {
  const d = new Date(dateStr);
  if (period === 'day') d.setDate(d.getDate() - 1);
  else if (period === 'week') d.setDate(d.getDate() - 7);
  else d.setMonth(d.getMonth() - 1);
  return toDateInputValue(d);
}

function scoreTrend(currentScore, previousScore) {
  if (previousScore == null) return {};
  const delta = currentScore - previousScore;
  const trend = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
  const periodLabel = 'last period';
  const trendLabel = delta === 0 ? `No change vs ${periodLabel}` : `${delta > 0 ? '+' : ''}${delta} vs ${periodLabel}`;
  return { trend, trendLabel };
}

export default function PerformanceDashboard() {
  const [currentUser, setCurrentUser] = useState(null);
  const [period, setPeriod] = useState('week');
  const [date, setDate] = useState(toDateInputValue(new Date()));
  const [projectId, setProjectId] = useState('');
  const [assigneeEmail, setAssigneeEmail] = useState('');
  const [projects, setProjects] = useState([]);
  const [users, setUsers] = useState([]);
  const [dashboard, setDashboard] = useState(null);
  const [previousScore, setPreviousScore] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (storedUser) setCurrentUser(JSON.parse(storedUser));
  }, []);

  const isWideView = currentUser && ['admin', 'program_manager', 'executive'].includes(currentUser.role);

  useEffect(() => {
    apiFetch('/projects').then(setProjects).catch(() => {});
    if (isWideView) {
      apiFetch('/users/assignable').then(setUsers).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isWideView]);

  useEffect(() => {
    if (!currentUser) return;
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ period, date });
    if (projectId) params.set('projectId', projectId);
    if (isWideView && assigneeEmail) params.set('assigneeEmail', assigneeEmail);
    apiFetch(`/performance-dashboard?${params.toString()}`)
      .then(setDashboard)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, period, date, projectId, assigneeEmail]);

  // Self-view only, to keep this to one extra request rather than one per
  // leaderboard row - a per-row trend for the wide view would need N+1
  // calls for a comparison that's secondary there anyway (the distribution
  // strip already tells leadership the team-wide shape at a glance).
  useEffect(() => {
    if (!currentUser || isWideView) {
      setPreviousScore(null);
      return;
    }
    const params = new URLSearchParams({ period, date: shiftDatePrevious(date, period) });
    if (projectId) params.set('projectId', projectId);
    apiFetch(`/performance-dashboard?${params.toString()}`)
      .then((prev) => setPreviousScore(prev.rows[0]?.performanceScore ?? null))
      .catch(() => setPreviousScore(null));
  }, [currentUser, isWideView, period, date, projectId]);

  const periodLabel = PERIOD_OPTIONS.find((o) => o.value === period)?.label || '';
  const isDaily = period === 'day';
  const selfRow = !isWideView && dashboard ? dashboard.rows[0] : null;

  const distribution = isWideView && dashboard
    ? dashboard.rows.reduce(
      (acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }),
      { Excellent: 0, Good: 0, 'Needs Improvement': 0 },
    )
    : null;

  const teamActivityToday = isWideView && dashboard
    ? dashboard.rows.reduce(
      (acc, r) => ({
        completed: acc.completed + r.completed,
        overdue: acc.overdue + r.overdue,
        qaFailed: acc.qaFailed + r.qaFailed,
      }),
      { completed: 0, overdue: 0, qaFailed: 0 },
    )
    : null;

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Performance Dashboard</h1>
          <p className={styles.pageSubtitle}>
            {isWideView
              ? 'Productivity, quality, and SLA compliance across the team.'
              : 'Your own productivity, quality, and SLA compliance.'}
          </p>
        </div>
      </div>

      <div className={styles.card}>
        <div style={{ display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <label className={styles.label}>View</label>
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              {PERIOD_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={opt.value === period ? styles.button : styles.buttonSecondary}
                  onClick={() => setPeriod(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.field} style={{ margin: 0 }}>
            <label className={styles.label} htmlFor="date">Date</label>
            <input className={styles.input} id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>

          <div className={styles.field} style={{ margin: 0 }}>
            <label className={styles.label} htmlFor="projectFilter">Project / Team</label>
            <select className={styles.select} id="projectFilter" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">All projects</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>

          {isWideView && (
            <div className={styles.field} style={{ margin: 0 }}>
              <label className={styles.label} htmlFor="assigneeFilter">Assignee</label>
              <select className={styles.select} id="assigneeFilter" value={assigneeEmail} onChange={(e) => setAssigneeEmail(e.target.value)}>
                <option value="">All assignees</option>
                {users.map((u) => <option key={u.id} value={u.email}>{u.fullName || u.email}</option>)}
              </select>
            </div>
          )}
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}
      {loading && <div className={styles.empty}>Loading...</div>}

      {!loading && dashboard && (
        <>
          {/* Daily: lead with raw activity, since a score computed from one day's data is low-signal. */}
          {isDaily && (
            <div className={styles.card}>
              <h3 style={{ marginTop: 0, fontSize: '1rem' }}>
                {isWideView ? "Team Activity Today" : "Today's Activity"}
              </h3>
              <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                <StatCard
                  label="Completed"
                  value={isWideView ? teamActivityToday.completed : selfRow?.completed ?? 0}
                  icon={CheckCircle2}
                  accent="success"
                />
                <StatCard
                  label="Overdue"
                  value={isWideView ? teamActivityToday.overdue : selfRow?.overdue ?? 0}
                  icon={AlertTriangle}
                  accent="error"
                />
                <StatCard
                  label="QA Failed"
                  value={isWideView ? teamActivityToday.qaFailed : selfRow?.qaFailed ?? 0}
                  icon={XCircle}
                  accent="warning"
                />
              </div>
            </div>
          )}

          {/* Self view: personal score hero + why-it's-that-number breakdown. Replaces the
              leaderboard table entirely for this role - a 1-row ranking table said nothing
              a card couldn't say better. */}
          {!isWideView && selfRow && (
            <>
              <div className={styles.card}>
                <StatCard
                  label={`Your Score — ${selfRow.status}`}
                  value={`${selfRow.performanceScore}%`}
                  icon={Gauge}
                  accent={STATUS_ACCENT[selfRow.status] || 'primary'}
                  {...scoreTrend(selfRow.performanceScore, previousScore)}
                />
              </div>
              <div className={styles.card}>
                <h3 style={{ marginTop: 0, fontSize: '1rem' }}>What&apos;s shaping your score</h3>
                <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                  <StatCard label="Completion" value={`${selfRow.completionPercent}%`} icon={CheckCircle2} accent="primary" />
                  <StatCard label="Overdue" value={selfRow.overdue} icon={AlertTriangle} accent="error" />
                  <StatCard label="QA Failed" value={selfRow.qaFailed} icon={XCircle} accent="warning" />
                  <StatCard label="Reopened" value={selfRow.reopened} icon={RotateCcw} accent="warning" />
                  <StatCard label="Late Dependencies" value={selfRow.lateDependencies} icon={GitBranch} accent="warning" />
                </div>
              </div>
            </>
          )}

          {/* Wide view: team-wide shape first, full leaderboard demoted below. */}
          {isWideView && distribution && (
            <div className={styles.card}>
              <h3 style={{ marginTop: 0, fontSize: '1rem' }}>Team Score Distribution</h3>
              <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                <StatCard label="Excellent" value={distribution.Excellent} icon={Users} accent={STATUS_ACCENT.Excellent} />
                <StatCard label="Good" value={distribution.Good} icon={Users} accent={STATUS_ACCENT.Good} />
                <StatCard label="Needs Improvement" value={distribution['Needs Improvement']} icon={Users} accent={STATUS_ACCENT['Needs Improvement']} />
              </div>
            </div>
          )}

          {isWideView && dashboard.topPerformers && dashboard.bottomPerformers && (
            <div style={{ display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
              <div className={styles.card} style={{ flex: 1, minWidth: '280px' }}>
                <h3 style={{ marginTop: 0, fontSize: '1rem' }}>Top Performers</h3>
                {dashboard.topPerformers.map((r) => (
                  <div key={r.assigneeEmail} style={{ display: 'flex', justifyContent: 'space-between', padding: 'var(--space-2) 0' }}>
                    <span>{r.assigneeName}</span>
                    <StatusBadge status={r.status} />
                  </div>
                ))}
              </div>
              <div className={styles.card} style={{ flex: 1, minWidth: '280px' }}>
                <h3 style={{ marginTop: 0, fontSize: '1rem' }}>Bottom Performers</h3>
                {dashboard.bottomPerformers.map((r) => (
                  <div key={r.assigneeEmail} style={{ display: 'flex', justifyContent: 'space-between', padding: 'var(--space-2) 0' }}>
                    <span>{r.assigneeName}</span>
                    <StatusBadge status={r.status} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {isWideView && (
            <div className={styles.card}>
              <h3 style={{ marginTop: 0, fontSize: '1rem' }}>Assignee Leaderboard</h3>
              <p className={styles.issueMeta} style={{ marginTop: 0 }}>
                In Progress, Overdue, QA Failed reflect current status (not historical); Completed and Late Dependencies are
                scoped to the selected {periodLabel.toLowerCase()} window.
              </p>
              {dashboard.rows.length === 0 && <p className={styles.issueMeta}>No assigned work found for this filter.</p>}
              {dashboard.rows.length > 0 && (
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Assignee</th>
                        <th>Assigned</th>
                        <th>Completed</th>
                        <th>In Progress</th>
                        <th>Overdue</th>
                        <th>QA Failed</th>
                        <th>Reopened</th>
                        <th>Late Deps</th>
                        <th>Completion %</th>
                        <th>Score</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dashboard.rows.map((row, i) => (
                        <tr key={row.assigneeEmail}>
                          <td>{i + 1}</td>
                          <td style={{ fontWeight: 600 }}>{row.assigneeName}</td>
                          <td>{row.totalAssigned}</td>
                          <td>{row.completed}</td>
                          <td>{row.inProgress}</td>
                          <td>{row.overdue}</td>
                          <td>{row.qaFailed}</td>
                          <td>{row.reopened}</td>
                          <td>{row.lateDependencies}</td>
                          <td>{row.completionPercent}%</td>
                          <td>{row.performanceScore}%</td>
                          <td><StatusBadge status={row.status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          <div className={styles.card}>
            <h3 style={{ marginTop: 0, fontSize: '1rem' }}>
              {periodLabel} Progress Trend
            </h3>
            <TrendBarChart points={dashboard.trend} />
          </div>

          <div className={styles.card}>
            <h3 style={{ marginTop: 0, fontSize: '1rem' }}>Completion vs Target (100%)</h3>
            {dashboard.rows.length === 0 && <p className={styles.issueMeta}>Nothing to show.</p>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              {dashboard.rows.map((row) => (
                <CompletionVsTargetBar key={row.assigneeEmail} label={row.assigneeName} percent={row.completionPercent} />
              ))}
            </div>
          </div>

          <div className={styles.card}>
            <h3 style={{ marginTop: 0, fontSize: '1rem' }}>Overdue Analysis</h3>
            {dashboard.overdueAnalysis.length === 0 && <p className={styles.issueMeta}>Nothing currently overdue.</p>}
            {dashboard.overdueAnalysis.length > 0 && (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Ticket #</th>
                      <th>Title</th>
                      <th>Assignee</th>
                      <th>Project</th>
                      <th>Days Late</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dashboard.overdueAnalysis.map((r) => (
                      <tr key={r.issueId}>
                        <td className={styles.issueId}>#{r.issueId}</td>
                        <td className={styles.tableTitleCell}>{r.title}</td>
                        <td>{r.assigneeEmail}</td>
                        <td>{r.projectName || '—'}</td>
                        <td style={{ color: 'var(--color-red-dark)', fontWeight: 600 }}>{r.daysLate}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className={styles.card}>
            <h3 style={{ marginTop: 0, fontSize: '1rem' }}>QA Failed Analysis</h3>
            {dashboard.qaFailedAnalysis.length === 0 && <p className={styles.issueMeta}>Nothing currently in QA Failed.</p>}
            {dashboard.qaFailedAnalysis.length > 0 && (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Ticket #</th>
                      <th>Title</th>
                      <th>Assignee</th>
                      <th>Project</th>
                      <th>Failed On</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dashboard.qaFailedAnalysis.map((r) => (
                      <tr key={r.issueId}>
                        <td className={styles.issueId}>#{r.issueId}</td>
                        <td className={styles.tableTitleCell}>{r.title}</td>
                        <td>{r.assigneeEmail}</td>
                        <td>{r.projectName || '—'}</td>
                        <td>{r.qaReviewedAt ? new Date(r.qaReviewedAt).toLocaleDateString() : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </AppShell>
  );
}
