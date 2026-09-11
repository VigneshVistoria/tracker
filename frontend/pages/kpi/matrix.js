import { useEffect, useMemo, useState } from 'react';
import AppShell from '../../components/AppShell';
import styles from '../../styles/issues.module.css';
import { apiFetch } from '../../lib/api';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parseDateOnly(value) {
  return new Date(`${value}T00:00:00`);
}

function formatShort(value) {
  return parseDateOnly(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function currentMonthValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// Same score-for-ranking convention as KpiService.scoreForRanking(): monthly
// rows are judged on headlineScore (falling back to compositeScore), every
// other period type on compositeScore directly.
function scoreOf(row) {
  const value = row.periodType === 'monthly' ? row.headlineScore ?? row.compositeScore : row.compositeScore;
  return Number(value);
}

export default function KpiMatrix() {
  const [currentUser, setCurrentUser] = useState(null);
  const [viewMode, setViewMode] = useState('weekly');
  const [anchorMonth, setAnchorMonth] = useState(currentMonthValue());
  const [projectId, setProjectId] = useState('');
  const [projects, setProjects] = useState([]);
  const [users, setUsers] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedCell, setSelectedCell] = useState(null);

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (storedUser) setCurrentUser(JSON.parse(storedUser));
  }, []);

  // Matches GET /kpi/report's own guard exactly (Admin/Executive/Program
  // Manager) - this page reads nothing else, so there is no separate
  // access boundary to keep in sync with.
  const canView = currentUser && ['admin', 'executive', 'program_manager'].includes(currentUser.role);

  useEffect(() => {
    if (!canView) return;
    apiFetch('/projects').then(setProjects).catch(() => {});
    apiFetch('/users/assignable').then(setUsers).catch(() => {});
  }, [canView]);

  useEffect(() => {
    if (!canView) return;
    setLoading(true);
    setError('');
    setSelectedCell(null);
    const params = new URLSearchParams({ periodType: viewMode });
    if (projectId) params.set('projectId', projectId);
    apiFetch(`/kpi/report?${params.toString()}`)
      .then(setRows)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [canView, viewMode, projectId]);

  const userLabelById = useMemo(() => {
    const map = new Map();
    users.forEach((u) => map.set(u.id, u.fullName || u.email));
    return map;
  }, [users]);

  const [anchorYear, anchorMonthIndex] = anchorMonth.split('-').map(Number);

  // Weeks belonging to the selected month, defined the same way
  // KpiService.generatePeriod() itself buckets a weekly row into a month
  // for the headline-score average: periodStart falls within the
  // calendar month's start/end range.
  const monthStartStr = `${anchorYear}-${String(anchorMonthIndex).padStart(2, '0')}-01`;
  const monthEndDate = new Date(anchorYear, anchorMonthIndex, 0);
  const monthEndStr = `${anchorYear}-${String(anchorMonthIndex).padStart(2, '0')}-${String(monthEndDate.getDate()).padStart(2, '0')}`;

  const columns = useMemo(() => {
    if (viewMode === 'weekly') {
      const seen = new Map();
      rows.forEach((r) => {
        if (r.periodStart >= monthStartStr && r.periodStart <= monthEndStr) {
          seen.set(`${r.periodStart}:${r.periodEnd}`, { periodStart: r.periodStart, periodEnd: r.periodEnd });
        }
      });
      return [...seen.values()]
        .sort((a, b) => (a.periodStart < b.periodStart ? -1 : 1))
        .map((c, i) => ({
          key: c.periodStart,
          title: `Week ${i + 1}`,
          subtitle: `${formatShort(c.periodStart)}–${formatShort(c.periodEnd)}`,
          match: (r) => r.periodStart === c.periodStart && r.periodEnd === c.periodEnd,
        }));
    }
    return MONTH_NAMES.map((name, i) => ({
      key: `${anchorYear}-${i}`,
      title: name,
      subtitle: String(anchorYear),
      match: (r) => {
        const d = parseDateOnly(r.periodStart);
        return d.getFullYear() === anchorYear && d.getMonth() === i;
      },
    }));
  }, [rows, viewMode, anchorYear, monthStartStr, monthEndStr]);

  // One row per (assignee, project) pair actually present in the data -
  // never invented. When a project filter is set, every pair naturally
  // collapses to one row per assignee; with "All projects" a person with
  // scores in more than one project gets one row per project instead of
  // an averaged, made-up composite.
  const memberRows = useMemo(() => {
    const seen = new Map();
    rows.forEach((r) => {
      const key = `${r.assigneeUserId}:${r.projectId}`;
      if (!seen.has(key)) {
        seen.set(key, {
          key,
          assigneeUserId: r.assigneeUserId,
          projectId: r.projectId,
          label: userLabelById.get(r.assigneeUserId) || r.assigneeEmail,
          projectName: r.projectName,
        });
      }
    });
    return [...seen.values()].sort((a, b) => {
      if (a.label !== b.label) return a.label < b.label ? -1 : 1;
      return a.projectName < b.projectName ? -1 : 1;
    });
  }, [rows, userLabelById]);

  const showProjectSubline = !projectId;

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>KPI Matrix</h1>
          <p className={styles.pageSubtitle}>
            Team member vs. time period grid of already-issued KPI scores - same generated, immutable periods as the KPI Dashboard, just laid out for at-a-glance comparison.
          </p>
        </div>
      </div>

      {!canView && <div className={styles.card}><div className={styles.error}>Only Admins, Executives, and Program Managers can view the KPI matrix.</div></div>}

      {canView && (
        <>
          <div className={styles.card}>
            <div style={{ display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div>
                <label className={styles.label}>View</label>
                <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                  <button
                    type="button"
                    className={viewMode === 'monthly' ? styles.button : styles.buttonSecondary}
                    onClick={() => setViewMode('monthly')}
                  >
                    Monthly
                  </button>
                  <button
                    type="button"
                    className={viewMode === 'weekly' ? styles.button : styles.buttonSecondary}
                    onClick={() => setViewMode('weekly')}
                  >
                    Weekly
                  </button>
                </div>
              </div>

              <div className={styles.field} style={{ margin: 0 }}>
                <label className={styles.label} htmlFor="anchorMonth">
                  {viewMode === 'weekly' ? 'Month' : 'Year'}
                </label>
                <input
                  type="month"
                  className={styles.select}
                  id="anchorMonth"
                  value={anchorMonth}
                  onChange={(e) => setAnchorMonth(e.target.value)}
                />
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
            </div>
          </div>

          {error && <div className={styles.error}>{error}</div>}
          {loading && <div className={styles.empty}>Loading...</div>}

          {!loading && !error && (
            <div className={styles.card}>
              {memberRows.length === 0 && <div className={styles.empty}>No KPI periods generated yet for this filter.</div>}
              {memberRows.length > 0 && (
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th style={{ position: 'sticky', left: 0, background: 'var(--ds-bg-surface)' }}>Team Member</th>
                        {columns.map((col) => (
                          <th key={col.key} style={{ textAlign: 'center' }}>
                            <div>{col.title}</div>
                            <div className={styles.issueMeta} style={{ fontWeight: 400 }}>{col.subtitle}</div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {memberRows.map((member) => (
                        <tr key={member.key}>
                          <td style={{ position: 'sticky', left: 0, background: 'var(--ds-bg-surface)' }}>
                            <div>{member.label}</div>
                            {showProjectSubline && <div className={styles.issueMeta}>{member.projectName}</div>}
                          </td>
                          {columns.map((col) => {
                            const row = rows.find(
                              (r) => r.assigneeUserId === member.assigneeUserId && r.projectId === member.projectId && col.match(r),
                            );
                            if (!row) {
                              return (
                                <td key={col.key} style={{ textAlign: 'center' }}>
                                  <span className={styles.issueMeta}>—</span>
                                </td>
                              );
                            }
                            return (
                              <td key={col.key} style={{ textAlign: 'center' }}>
                                <span
                                  className={`${styles.badge} ${styles[`badgeRating${row.ratingBand}`]}`}
                                  title={`Score: ${scoreOf(row)}`}
                                  style={{ cursor: 'pointer' }}
                                  onClick={() => setSelectedCell({ member, col, row })}
                                >
                                  {row.ratingBand}
                                </span>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {selectedCell && (
            <div className={styles.card}>
              <strong>{selectedCell.member.label}</strong> &middot; {selectedCell.col.title} ({selectedCell.col.subtitle})
              &middot; <span className={`${styles.badge} ${styles[`badgeRating${selectedCell.row.ratingBand}`]}`}>{selectedCell.row.ratingBand}</span>
              &middot; Score: {scoreOf(selectedCell.row)}
              {showProjectSubline && <> &middot; {selectedCell.member.projectName}</>}
            </div>
          )}
        </>
      )}
    </AppShell>
  );
}
