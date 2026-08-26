import { useEffect, useState } from 'react';
import AppShell from '../components/AppShell';
import TrendBarChart from '../components/TrendBarChart';
import CompletionVsTargetBar from '../components/CompletionVsTargetBar';
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

export default function PerformanceDashboard() {
  const [currentUser, setCurrentUser] = useState(null);
  const [period, setPeriod] = useState('week');
  const [date, setDate] = useState(toDateInputValue(new Date()));
  const [projectId, setProjectId] = useState('');
  const [assigneeEmail, setAssigneeEmail] = useState('');
  const [projects, setProjects] = useState([]);
  const [users, setUsers] = useState([]);
  const [dashboard, setDashboard] = useState(null);
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
          <div className={styles.card}>
            <h3 style={{ marginTop: 0, fontSize: '1rem' }}>
              {isWideView ? 'Assignee Leaderboard' : 'Your Stats'}
            </h3>
            <p className={styles.issueMeta} style={{ marginTop: 0 }}>
              In Progress, Overdue, QA Failed reflect current status (not historical); Completed and Late Dependencies are
              scoped to the selected {PERIOD_OPTIONS.find((o) => o.value === period)?.label.toLowerCase()} window.
            </p>
            {dashboard.rows.length === 0 && <p className={styles.issueMeta}>No assigned work found for this filter.</p>}
            {dashboard.rows.length > 0 && (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      {isWideView && <th>#</th>}
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
                        {isWideView && <td>{i + 1}</td>}
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

          <div className={styles.card}>
            <h3 style={{ marginTop: 0, fontSize: '1rem' }}>
              {PERIOD_OPTIONS.find((o) => o.value === period)?.label} Progress Trend
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
