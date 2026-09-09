import { useEffect, useState } from 'react';
import AppShell from '../../components/AppShell';
import styles from '../../styles/issues.module.css';
import { apiFetch } from '../../lib/api';

const PERIOD_OPTIONS = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
];

export default function KpiDashboard() {
  const [currentUser, setCurrentUser] = useState(null);
  const [periodType, setPeriodType] = useState('weekly');
  const [projectId, setProjectId] = useState('');
  const [assigneeUserId, setAssigneeUserId] = useState('');
  const [projects, setProjects] = useState([]);
  const [users, setUsers] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [generateMessage, setGenerateMessage] = useState('');

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (storedUser) setCurrentUser(JSON.parse(storedUser));
  }, []);

  // Own-data-only for everyone else - enforced server-side by /kpi/me
  // (always scoped to the caller's own JWT id), not just this UI switch.
  const isWideView = currentUser && ['admin', 'program_manager', 'executive'].includes(currentUser.role);
  // Matches the backend's actual POST /kpi/generate guard (Admin or
  // Program Manager) - a stricter admin-only UI check would hide this
  // from Program Managers who can call it just fine.
  const canGenerate = currentUser && ['admin', 'program_manager'].includes(currentUser.role);

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
    const params = new URLSearchParams({ periodType });
    if (projectId) params.set('projectId', projectId);

    const endpoint = isWideView ? '/kpi/report' : '/kpi/me';
    if (isWideView && assigneeUserId) params.set('assigneeUserId', assigneeUserId);

    apiFetch(`${endpoint}?${params.toString()}`)
      .then(setRows)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [currentUser, isWideView, periodType, projectId, assigneeUserId, refreshKey]);

  const isMonthly = periodType === 'monthly';

  // Admin-only: fires the same generation logic the nightly/weekly/monthly
  // cron jobs use (KpiService.generatePeriod via POST /kpi/generate), so
  // testing doesn't require waiting for the schedule. Uses today's date as
  // the reference, matching the currently selected View (daily/weekly/
  // monthly), so it covers whichever period contains today.
  async function handleGenerateNow() {
    setGenerating(true);
    setGenerateMessage('');
    setError('');
    try {
      const referenceDate = new Date().toISOString().slice(0, 10);
      const created = await apiFetch('/kpi/generate', {
        method: 'POST',
        body: JSON.stringify({ periodType, referenceDate }),
      });
      const label = PERIOD_OPTIONS.find((opt) => opt.value === periodType)?.label.toLowerCase();
      setGenerateMessage(`Generated ${created.length} ${label} KPI score${created.length === 1 ? '' : 's'} for the period containing ${referenceDate}.`);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>KPI Dashboard</h1>
          <p className={styles.pageSubtitle}>
            {isWideView
              ? 'Project-wise KPI scores, generated on a fixed schedule and never recalculated once issued.'
              : 'Your own KPI scores - only you can see this data, even indirectly.'}
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
                  className={opt.value === periodType ? styles.button : styles.buttonSecondary}
                  onClick={() => setPeriodType(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.field} style={{ margin: 0 }}>
            <label className={styles.label} htmlFor="projectFilter">Project</label>
            <select className={styles.select} id="projectFilter" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">All projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          {isWideView && (
            <div className={styles.field} style={{ margin: 0 }}>
              <label className={styles.label} htmlFor="assigneeFilter">Assignee</label>
              <select className={styles.select} id="assigneeFilter" value={assigneeUserId} onChange={(e) => setAssigneeUserId(e.target.value)}>
                <option value="">All assignees</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.fullName || u.email}</option>
                ))}
              </select>
            </div>
          )}

          {canGenerate && (
            <div className={styles.field} style={{ margin: 0 }}>
              <label className={styles.label}>&nbsp;</label>
              <button
                type="button"
                className={styles.buttonSecondary}
                onClick={handleGenerateNow}
                disabled={generating}
                title="Generate KPI periods now instead of waiting for the nightly/weekly/monthly schedule"
              >
                {generating ? 'Generating…' : 'Generate periods now'}
              </button>
            </div>
          )}
        </div>
      </div>

      {generateMessage && <div className={styles.empty}>{generateMessage}</div>}
      {error && <div className={styles.error}>{error}</div>}
      {loading && <div className={styles.empty}>Loading...</div>}

      {!loading && (
        <div className={styles.card}>
          {rows.length === 0 && <div className={styles.empty}>No KPI periods generated yet for this filter.</div>}
          {rows.length > 0 && (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Period</th>
                    <th>Project</th>
                    {isWideView && <th>Assignee</th>}
                    <th>Due</th>
                    <th>Completed</th>
                    <th>Completion %</th>
                    <th>Hours Exceed %</th>
                    <th>Overdue %</th>
                    <th>Target Miss %</th>
                    <th>Feedback Count</th>
                    <th>Excessive Rejections</th>
                    <th>Outbound Dep. Overdue %</th>
                    <th>Inbound Dep. Overdue (info)</th>
                    {isMonthly ? (
                      <>
                        <th>Headline Score</th>
                        <th>Audit Score</th>
                      </>
                    ) : (
                      <th>Composite Score</th>
                    )}
                    <th>Rating</th>
                    {isWideView && <th>Top Performer</th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td className={styles.issueMeta}>{r.periodStart} → {r.periodEnd}</td>
                      <td>{r.projectName}</td>
                      {isWideView && <td>{r.assigneeEmail}</td>}
                      <td>{r.ticketsDue}</td>
                      <td>{r.ticketsCompleted}</td>
                      <td>{r.completionPercent}%</td>
                      <td>{r.hoursExceedPercent}%</td>
                      <td>{r.overduePercent}%</td>
                      <td>{r.targetMissPercent}%</td>
                      <td>{r.qaRejectionCount}</td>
                      <td>{r.excessiveRejectionFlag ? 'Yes' : 'No'}</td>
                      <td>{r.outboundDependencyOverduePercent}%</td>
                      <td className={styles.issueMeta}>{r.inboundDependencyOverdueCount}</td>
                      {isMonthly ? (
                        <>
                          <td style={{ fontWeight: 600 }}>{r.headlineScore ?? '—'}</td>
                          <td className={styles.issueMeta}>{r.auditScore ?? '—'}</td>
                        </>
                      ) : (
                        <td style={{ fontWeight: 600 }}>{r.compositeScore}</td>
                      )}
                      <td>
                        <span className={`${styles.badge} ${styles[`badgeRating${r.ratingBand}`]}`}>{r.ratingBand}</span>
                      </td>
                      {isWideView && (
                        <td>{r.topPerformer && <span className={`${styles.badge} ${styles.badgeTopPerformer}`}>Top Performer</span>}</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </AppShell>
  );
}
