import { useEffect, useState } from 'react';
import AppShell from '../../components/AppShell';
import styles from '../../styles/issues.module.css';
import { apiFetch } from '../../lib/api';
import { useToast } from '../../lib/toast';

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 'var(--space-4)' }}>
      <h4 style={{ marginBottom: 'var(--space-2)', fontSize: '0.9rem' }}>{title}</h4>
      {children}
    </div>
  );
}

function IssueList({ items }) {
  if (!items || items.length === 0) {
    return <p className={styles.helpText}>None.</p>;
  }
  return (
    <ul className={styles.suggestionList}>
      {items.map((i) => (
        <li key={i.id}>
          #{i.id} {i.title} {i.assigneeEmail ? `\u2014 ${i.assigneeEmail}` : ''}
          {i.storyPoints != null ? ` (${i.storyPoints} pts)` : ''}
        </li>
      ))}
    </ul>
  );
}

function ReportCard({ report, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen);
  const d = report.data;

  return (
    <div className={styles.card} style={{ marginBottom: 'var(--space-4)' }}>
      <div
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
        onClick={() => setOpen((v) => !v)}
      >
        <div>
          <strong>{d.weekStartDate} to {d.weekEndDate}</strong>
          <span className={styles.issueMeta} style={{ marginLeft: 'var(--space-3)' }}>
            {d.overall.completionPercent}% overall completion
          </span>
        </div>
        <span className={styles.issueMeta}>{open ? '\u2013' : '+'}</span>
      </div>

      {open && (
        <div style={{ marginTop: 'var(--space-4)' }}>
          <Section title={`Completed previous week (${d.previousWeekStartDate} to ${d.previousWeekEndDate})`}>
            <IssueList items={d.completedPreviousWeek} />
          </Section>
          <Section title="Carry-forward items">
            <IssueList items={d.carryForward} />
          </Section>
          <Section title="New items this week">
            <IssueList items={d.newThisWeek} />
          </Section>
          <Section title="Assignee-wise completion & performance">
            {d.assigneeStats.length === 0 && <p className={styles.helpText}>No assigned issues yet.</p>}
            {d.assigneeStats.length > 0 && (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Assignee</th>
                      <th>Completed / Total</th>
                      <th>Completion %</th>
                      <th>Open now</th>
                      <th>Performance %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.assigneeStats.map((a) => (
                      <tr key={a.assigneeEmail}>
                        <td>{a.assigneeEmail}</td>
                        <td>{a.completedAllTime} / {a.totalAssigned}</td>
                        <td>{a.completionPercent}%</td>
                        <td>{a.currentOpenCount}</td>
                        <td>{a.performancePercent}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
          <Section title="Overall progress">
            <p className={styles.issueMeta}>
              {d.overall.totalCompleted} of {d.overall.totalIssues} issues completed ({d.overall.completionPercent}%)
            </p>
            <p className={styles.issueMeta}>
              Backlog: {d.overall.statusBreakdown.Backlog} &middot; In Progress: {d.overall.statusBreakdown['In Progress']} &middot; In Review: {d.overall.statusBreakdown['In Review']} &middot; Completed: {d.overall.statusBreakdown.Completed}
            </p>
          </Section>
        </div>
      )}
    </div>
  );
}

export default function WeeklyReportsPage() {
  const { showToast } = useToast();
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');

  const load = () => {
    apiFetch('/reports/weekly/history')
      .then(setHistory)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleGenerate = async () => {
    setError('');
    setGenerating(true);
    try {
      const report = await apiFetch('/reports/weekly/generate', { method: 'POST' });
      showToast('Weekly report generated', 'success');
      setHistory((prev) => [report, ...prev.filter((r) => r.id !== report.id)]);
    } catch (err) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Weekly Reports</h1>
          <p className={styles.pageSubtitle}>
            Business week (Mon\u2013Fri). Also generated automatically every Monday morning and
            emailed to any configured executives.
          </p>
        </div>
        <button className={`${styles.button} ${styles.buttonAccent}`} type="button" onClick={handleGenerate} disabled={generating}>
          {generating ? 'Generating...' : 'Generate Report Now'}
        </button>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {loading && <div className={styles.empty}>Loading...</div>}
      {!loading && history.length === 0 && (
        <div className={styles.empty}>No reports yet - click "Generate Report Now" above.</div>
      )}

      {history.map((r, i) => (
        <ReportCard key={r.id} report={r} defaultOpen={i === 0} />
      ))}
    </AppShell>
  );
}
