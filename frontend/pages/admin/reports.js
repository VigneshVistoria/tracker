import { useEffect, useMemo, useState } from 'react';
import AppShell from '../../components/AppShell';
import styles from '../../styles/issues.module.css';
import { apiFetch, apiDownload } from '../../lib/api';
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
              Backlog: {d.overall.statusBreakdown.Backlog} &middot; In Progress: {d.overall.statusBreakdown['In Progress']} &middot; In Review: {d.overall.statusBreakdown['In Review']} &middot; QA Testing: {d.overall.statusBreakdown['QA Testing']} &middot; QA Failed: {d.overall.statusBreakdown['QA Failed']} &middot; Ready for Production: {d.overall.statusBreakdown['Ready for Production']}
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
  const [selectedAssignee, setSelectedAssignee] = useState('');
  const [downloading, setDownloading] = useState(false);

  const load = () => {
    apiFetch('/reports/weekly/history')
      .then(setHistory)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  // Assignee list for the PDF-download picker, pulled from the most recent
  // report's stats so it always reflects who currently has assigned work -
  // no separate "list all assignees" endpoint needed.
  const assigneeOptions = useMemo(() => {
    const emails = history[0]?.data?.assigneeStats?.map((a) => a.assigneeEmail) || [];
    return [...new Set(emails)].sort();
  }, [history]);

  useEffect(() => {
    if (!selectedAssignee && assigneeOptions.length > 0) {
      setSelectedAssignee(assigneeOptions[0]);
    }
  }, [assigneeOptions, selectedAssignee]);

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

  // Downloads one assignee's Performance Report PDF directly - generates it
  // fresh from current data and streams it back as a file, with no email
  // sent to anyone. Useful for previewing a report or grabbing one to send
  // manually, without triggering the mass auto-email that the Saturday job
  // (or the "Generate Report Now" + email flow) causes for every assignee.
  const handleDownloadPdf = async () => {
    if (!selectedAssignee) {
      return;
    }
    setError('');
    setDownloading(true);
    try {
      await apiDownload(
        `/reports/weekly/performance-pdf?assigneeEmail=${encodeURIComponent(selectedAssignee)}`,
        `weekly-performance-report-${selectedAssignee}.pdf`,
      );
      showToast('PDF downloaded', 'success');
    } catch (err) {
      setError(err.message);
    } finally {
      setDownloading(false);
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

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
          marginBottom: 'var(--space-4)',
        }}
      >
        <select
          className={styles.select}
          value={selectedAssignee}
          onChange={(e) => setSelectedAssignee(e.target.value)}
          disabled={assigneeOptions.length === 0}
          aria-label="Assignee for performance PDF download"
        >
          {assigneeOptions.length === 0 && <option value="">No assignees yet</option>}
          {assigneeOptions.map((email) => (
            <option key={email} value={email}>
              {email}
            </option>
          ))}
        </select>
        <button
          className={styles.buttonSecondary}
          type="button"
          onClick={handleDownloadPdf}
          disabled={downloading || !selectedAssignee}
        >
          {downloading ? 'Downloading...' : 'Download Performance PDF'}
        </button>
        <span className={styles.helpText}>
          Downloads that assignee&apos;s report as a PDF file - no email is sent.
        </span>
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
