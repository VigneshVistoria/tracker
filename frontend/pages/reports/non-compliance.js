import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import AppShell from '../../components/AppShell';
import SearchSelectField from '../../components/SearchSelectField';
import Badge from '../../components/ui/Badge';
import styles from '../../styles/issues.module.css';
import nc from '../../styles/nonCompliance.module.css';
import { apiFetch, apiDownload } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { formatDate } from '../../lib/formatDate';
import LoadingState from '../../components/ui/LoadingState';
import { redirectToSignIn } from '../../lib/session';
import PerformanceMetricsSection from '../../components/reports/PerformanceMetricsSection';

// Same tier as KPI Matrix (GET /kpi/report) - Admin/Executive/Program
// Manager only. A developer never sees this report about themselves or
// teammates (confirmed with the user).
const VIEW_ROLES = ['admin', 'executive', 'program_manager'];
// Performance metrics (2026-10-27): a Developer/Designer/DevOps opens this
// page too, but sees only their own Performance metrics section - none of
// the report above it (backend: PerformanceMetricsController).
const OWN_METRICS_ROLES = ['developer', 'designer', 'devops'];

const LATE_TO_QA_REASON_LABEL = {
  submitted_late: 'Submitted late',
  still_with_developer: 'Not yet submitted',
};

// One-sentence rules, shown as the column tooltips and in the "How these
// are counted" note (2026-10-27, approved by the user).
const LATE_TO_QA_RULE =
  'Tasks whose final submission for review came after their Due date (plus any days waiting on the PM), or that are still with the developer past it; each task counts once, and time waiting on QA, a peer or the PM is not counted.';

// QA "Not ready for testing" (2026-10-27, approved by the user) - shown for
// information only, never part of Flagged.
const INCOMPLETE_RULE =
  'Submissions QA returned as "Not ready for testing" (could not start testing: build not deployed, steps or evidence missing, ...). Not a rejection and never flagged.';
const TEST_FAILED_RULE =
  'QA and Peer Review rejections where the test was run and failed - the same rejections the Rejection Rate counts. Shown for information, never flagged on its own.';

// Defect triage (2026-10-27) - information only, never part of Flagged and
// never a KPI penalty. See backend/src/tasks/defect-triage.ts.
const LATE_TRIAGE_RULE =
  'Defects accepted or disputed after their triage due date, or still waiting past it (not on Hold or Closed), by due date. A defect that moved to another developer, or a dispute whose reason never counts (e.g. wrong assignee), is not counted.';
const DISPUTES_RULE =
  'Defects the developer disputed in the period, and how the PM decided: agreed (closed, reassigned or converted to a task), rejected (the developer fixes it) or still waiting. Never a QA rejection.';
const PM_DISPUTE_DECISION_LABEL = { rejected: 'rejected', closed: 'agreed, closed', reassigned: 'agreed, reassigned', converted: 'agreed, converted to a task' };

function LateTriageList({ items }) {
  if (items.length === 0) return null;
  return (
    <details className={nc.taskList}>
      <summary>view {items.length}</summary>
      <ul>
        {items.map((item, i) => (
          <li key={`${item.taskId}-${i}`}>
            <a href={`/tasks/${item.taskId}`} target="_blank" rel="noopener noreferrer">#{item.taskId}</a> {item.title}{' '}
            <span className={nc.tag}>
              due {formatDate(item.dueDate)}, {item.decidedAt ? `${item.decision} ${formatDate(item.decidedAt)}` : 'still waiting'} -{' '}
              {item.workingDaysLate} working day{item.workingDaysLate === 1 ? '' : 's'} late
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function DisputeList({ items }) {
  if (items.length === 0) return null;
  return (
    <details className={nc.taskList}>
      <summary>view {items.length}</summary>
      <ul>
        {items.map((item, i) => (
          <li key={`${item.taskId}-${i}`}>
            <a href={`/tasks/${item.taskId}`} target="_blank" rel="noopener noreferrer">#{item.taskId}</a> {item.title}{' '}
            <span className={nc.tag}>
              {item.reason || 'Disputed'}
              {item.disputedAt ? ` on ${formatDate(item.disputedAt)}` : ''} - {item.pmDecision ? PM_DISPUTE_DECISION_LABEL[item.pmDecision] : 'waiting for the PM'}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function TestFailedList({ items }) {
  if (items.length === 0) return null;
  return (
    <details className={nc.taskList}>
      <summary>view {items.length}</summary>
      <ul>
        {items.map((item, i) => (
          <li key={`${item.taskId}-${i}`}>
            <a href={`/tasks/${item.taskId}`} target="_blank" rel="noopener noreferrer">#{item.taskId}</a> {item.title}{' '}
            <span className={nc.tag}>
              {item.reviewType === 'peer' ? 'Peer review' : 'QA'}
              {item.reviewerName ? `, by ${item.reviewerName}` : ''}
              {item.rejectedAt ? ` on ${formatDate(item.rejectedAt)}` : ''}
            </span>
            {item.comment ? <span className={nc.tag}> - &quot;{item.comment}&quot;</span> : null}
          </li>
        ))}
      </ul>
    </details>
  );
}

function IncompleteList({ items }) {
  if (items.length === 0) return null;
  return (
    <details className={nc.taskList}>
      <summary>view {items.length}</summary>
      <ul>
        {items.map((item, i) => (
          <li key={`${item.taskId}-${i}`}>
            <a href={`/tasks/${item.taskId}`} target="_blank" rel="noopener noreferrer">#{item.taskId}</a> {item.title}{' '}
            <span className={nc.tag}>
              {item.reason || 'Not ready'}
              {item.qaName ? `, by ${item.qaName}` : ''}
              {item.markedAt ? ` on ${formatDate(item.markedAt)}` : ''}
            </span>
            {item.comment ? <span className={nc.tag}> - &quot;{item.comment}&quot;</span> : null}
          </li>
        ))}
      </ul>
    </details>
  );
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function startOfWeekISO() {
  const d = new Date();
  const day = d.getDay(); // 0=Sun, 1=Mon, ... 6=Sat
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diffToMonday);
  return d.toISOString().slice(0, 10);
}

function startOfMonthISO() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

function devName(dev) {
  return dev.fullName || dev.email;
}

// Bars are scaled to the current dataset's own max, not a fixed 0-100/
// 0-N scale, so relative severity is scannable at a glance (a threshold
// marker at, say, 20% only sits near the left edge if someone's actual
// rate is far past it). A zero-value bar still gets a thin visible sliver
// rather than disappearing entirely.
function barWidthPercent(value, max) {
  if (max <= 0) return '2%';
  return `${Math.max((value / max) * 100, 2)}%`;
}

function thresholdPositionPercent(threshold, max) {
  if (max <= 0) return null;
  return `${Math.min((threshold / max) * 100, 100)}%`;
}

export default function NonComplianceReportPage() {
  const router = useRouter();
  const { showToast } = useToast();

  const [user, setUser] = useState(null);
  const [projects, setProjects] = useState([]);
  const [project, setProject] = useState(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (!storedUser) {
      redirectToSignIn(router);
      return;
    }
    const parsed = JSON.parse(storedUser);
    if (!VIEW_ROLES.includes(parsed.role) && !OWN_METRICS_ROLES.includes(parsed.role)) {
      router.replace('/dashboard');
      return;
    }
    setUser(parsed);
    if (!VIEW_ROLES.includes(parsed.role)) {
      setLoading(false);
      return;
    }
    apiFetch('/projects').then(setProjects).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  const buildParams = () => {
    const params = new URLSearchParams();
    if (project) params.set('projectId', project.id);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    return params;
  };

  useEffect(() => {
    if (!user || !VIEW_ROLES.includes(user.role)) return;
    setLoading(true);
    setError('');
    apiFetch(`/non-compliance-report?${buildParams().toString()}`)
      .then(setReport)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, project, from, to]);

  if (!user) return null;

  if (!VIEW_ROLES.includes(user.role)) {
    return (
      <AppShell>
        <div className={styles.pageHeader}>
          <div>
            <h1 className={styles.pageTitle}>My Performance Metrics</h1>
            <p className={styles.pageSubtitle}>Your own figures only - Due date set on time, Due date changes and QA acceptance.</p>
          </div>
        </div>
        <div className={styles.filterBar}>
          <div className={styles.filterGroup}>
            <label className={styles.filterLabel} htmlFor="ncrToOwn">Period ending</label>
            <input id="ncrToOwn" type="date" className={styles.filterSelect} value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
        <PerformanceMetricsSection to={to} role={user.role} />
      </AppShell>
    );
  }

  const applyPreset = (preset) => {
    if (preset === 'week') {
      setFrom(startOfWeekISO());
      setTo(todayISO());
    } else if (preset === 'month') {
      setFrom(startOfMonthISO());
      setTo(todayISO());
    } else {
      setFrom('');
      setTo('');
    }
  };

  const handleDownloadPdf = async () => {
    setDownloading(true);
    setError('');
    try {
      await apiDownload(`/non-compliance-report/pdf?${buildParams().toString()}`, 'developer-non-compliance-report.pdf');
      showToast('PDF downloaded', 'success');
    } catch (err) {
      setError(err.message);
    } finally {
      setDownloading(false);
    }
  };

  const developers = report?.developers ?? [];
  const flaggedDevelopers = developers.filter((d) => d.flagged);
  const compliantDevelopers = developers.filter((d) => !d.flagged);

  const lateSorted = [...developers].sort((a, b) => b.lateToQa.count - a.lateToQa.count);
  const lateMax = Math.max(...lateSorted.map((d) => d.lateToQa.count), 1);
  const lateThresholdPos = report ? thresholdPositionPercent(report.thresholds.lateToQaCount, lateMax) : null;

  const rateEligible = developers.filter((d) => d.rejectionRate.submissions >= (report?.thresholds.rejectionRateMinSubmissions ?? 3));
  const rateIneligible = developers.filter((d) => d.rejectionRate.submissions < (report?.thresholds.rejectionRateMinSubmissions ?? 3));
  const rateSorted = [...rateEligible].sort((a, b) => b.rejectionRate.rate - a.rejectionRate.rate).concat(rateIneligible);
  const rateMax = Math.max(...rateEligible.map((d) => d.rejectionRate.rate), 1);
  const rateThresholdPos = report ? thresholdPositionPercent(report.thresholds.rejectionRatePercent, rateMax) : null;

  const vagueSorted = [...developers].sort((a, b) => b.resolutionQuality.count - a.resolutionQuality.count);
  const vagueMax = Math.max(...vagueSorted.map((d) => d.resolutionQuality.count), 1);
  const vagueThresholdPos = report ? thresholdPositionPercent(report.thresholds.vagueNotesCount, vagueMax) : null;

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Developer Non-Compliance Report</h1>
          <p className={styles.pageSubtitle}>
            Late to QA, QA/Peer Review rejection rate, PM interventions, and vague resolution notes, per developer.
          </p>
        </div>
        <div className={styles.actions}>
          <button
            className={`${styles.button} ${styles.buttonAccent}`}
            type="button"
            onClick={handleDownloadPdf}
            disabled={downloading}
          >
            {downloading ? 'Preparing PDF...' : 'Export PDF'}
          </button>
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.filterBar}>
        <div className={styles.filterGroup} style={{ minWidth: 220 }}>
          <SearchSelectField
            label="Project"
            id="ncrProject"
            value={project}
            onChange={setProject}
            options={projects}
            placeholder="All Projects"
          />
        </div>
        <div className={styles.filterGroup}>
          <label className={styles.filterLabel} htmlFor="ncrFrom">From</label>
          <input id="ncrFrom" type="date" className={styles.filterSelect} value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className={styles.filterGroup}>
          <label className={styles.filterLabel} htmlFor="ncrTo">To</label>
          <input id="ncrTo" type="date" className={styles.filterSelect} value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className={styles.filterGroup} style={{ alignSelf: 'end', display: 'flex', gap: 'var(--space-2)' }}>
          <button className={styles.buttonSecondary} type="button" onClick={() => applyPreset('week')}>This Week</button>
          <button className={styles.buttonSecondary} type="button" onClick={() => applyPreset('month')}>This Month</button>
          <button className={styles.buttonSecondary} type="button" onClick={() => applyPreset('all')}>All Time</button>
        </div>
      </div>

      <PerformanceMetricsSection projectId={project?.id} to={to} role={user.role} />

      {loading && <LoadingState />}

      {!loading && report && (
        <>
          {/* --- KPI row --- */}
          <div className={nc.kpiRow}>
            <div className={nc.kpiTile}>
              <div className={nc.kpiLabel}>Developers Flagged</div>
              <div className={`${nc.kpiValue} ${report.summary.flaggedCount > 0 ? nc.critical : ''}`}>
                {report.summary.flaggedCount}
                <span style={{ fontSize: 16, color: 'var(--color-ink-soft)', fontWeight: 600 }}> / {report.summary.totalDevelopers}</span>
              </div>
              <div className={nc.kpiSub}>{report.summary.flaggedNames.join(', ') || 'None'}</div>
            </div>
            <div className={nc.kpiTile}>
              <div className={nc.kpiLabel} title={LATE_TO_QA_RULE}>Late to QA</div>
              <div className={nc.kpiValue}>{report.summary.lateToQaTotal}</div>
              <div className={nc.kpiSub}>across flagged developers</div>
            </div>
            <div className={nc.kpiTile}>
              <div className={nc.kpiLabel}>Rejections / Submissions</div>
              <div className={nc.kpiValue}>
                {report.summary.rejectionsTotal}
                <span style={{ fontSize: 16, color: 'var(--color-ink-soft)', fontWeight: 600 }}> / {report.summary.submissionsTotal}</span>
              </div>
              <div className={nc.kpiSub}>{report.summary.blendedRejectionRate}% blended rate, across flagged developers</div>
            </div>
            <div className={nc.kpiTile}>
              <div className={nc.kpiLabel}>PM Interventions</div>
              <div className={nc.kpiValue}>{report.summary.escalationsTotal}</div>
              <div className={nc.kpiSub}>across flagged developers</div>
            </div>
            <div className={nc.kpiTile}>
              <div className={nc.kpiLabel}>Vague Resolution Notes</div>
              <div className={nc.kpiValue}>{report.summary.vagueNotesTotal}</div>
              <div className={nc.kpiSub}>across flagged developers &middot; AI pilot check</div>
            </div>
          </div>

          {/* --- bar charts --- */}
          <div className={styles.card} style={{ marginBottom: 'var(--space-4)' }}>
            <h2 className={styles.pageSubtitle} style={{ margin: '0 0 var(--space-1)', fontWeight: 600 }}>Compare by Developer</h2>
            <p className={styles.issueMeta} style={{ margin: '0 0 var(--space-3)' }}>
              Sorted highest to lowest. Dashed marker = flag threshold. Bars past the marker are colored critical.
            </p>
            <div className={nc.chartGrid}>
              <div>
                <h3 className={nc.chartTitle} title={LATE_TO_QA_RULE}>Late to QA</h3>
                {lateSorted.map((dev) => (
                  <div key={dev.userId} className={nc.barRow}>
                    <div className={nc.barName} title={devName(dev)}>{devName(dev)}</div>
                    <div className={nc.barTrack}>
                      {lateThresholdPos && <div className={nc.thresholdLine} style={{ left: lateThresholdPos }} />}
                      <div
                        className={`${nc.barFill} ${dev.lateToQa.flagged ? nc.critical : nc.good}`}
                        style={{ width: barWidthPercent(dev.lateToQa.count, lateMax) }}
                      />
                    </div>
                    <div className={nc.barValue}>{dev.lateToQa.count}</div>
                  </div>
                ))}
              </div>

              <div>
                <h3 className={nc.chartTitle}>QA / Peer Review Rejection Rate</h3>
                {rateSorted.map((dev) => {
                  const eligible = dev.rejectionRate.submissions >= report.thresholds.rejectionRateMinSubmissions;
                  return (
                    <div key={dev.userId} className={nc.barRow}>
                      <div className={nc.barName} title={devName(dev)}>{devName(dev)}</div>
                      <div className={nc.barTrack}>
                        {eligible && rateThresholdPos && <div className={nc.thresholdLine} style={{ left: rateThresholdPos }} />}
                        {eligible && (
                          <div
                            className={`${nc.barFill} ${dev.rejectionRate.flagged ? nc.critical : nc.good}`}
                            style={{ width: barWidthPercent(dev.rejectionRate.rate, rateMax) }}
                          />
                        )}
                      </div>
                      {eligible ? (
                        <div className={nc.barValue}>{dev.rejectionRate.rate}%</div>
                      ) : (
                        <div className={nc.barValueNa}>n/a</div>
                      )}
                    </div>
                  );
                })}
                <p className={styles.issueMeta} style={{ marginTop: 'var(--space-2)' }}>
                  &quot;n/a&quot; = fewer than {report.thresholds.rejectionRateMinSubmissions} submissions in this period, not
                  zero-rejection compliance - shown separately so a quiet developer doesn&apos;t look identical to a clean one.
                </p>
              </div>

              <div>
                <h3 className={nc.chartTitle}>Vague / Poor Resolution Notes</h3>
                {vagueSorted.map((dev) => (
                  <div key={dev.userId} className={nc.barRow}>
                    <div className={nc.barName} title={devName(dev)}>{devName(dev)}</div>
                    <div className={nc.barTrack}>
                      {vagueThresholdPos && <div className={nc.thresholdLine} style={{ left: vagueThresholdPos }} />}
                      <div
                        className={`${nc.barFill} ${dev.resolutionQuality.flagged ? nc.critical : nc.good}`}
                        style={{ width: barWidthPercent(dev.resolutionQuality.count, vagueMax) }}
                      />
                    </div>
                    <div className={nc.barValue}>
                      {dev.resolutionQuality.count}
                      <span style={{ fontWeight: 400, color: 'var(--color-ink-soft)' }}> /{dev.resolutionQuality.checked}</span>
                    </div>
                  </div>
                ))}
                <p className={styles.issueMeta} style={{ marginTop: 'var(--space-2)' }}>
                  Flagged / checked submissions this period - AI pilot check (Google Gemini, free tier), flag-only for now: never
                  blocks a submission, and a submission only counts as &quot;checked&quot; if the check actually ran.
                </p>
              </div>
            </div>

            <div className={nc.chartLegend}>
              <span><span className={nc.legendDot} style={{ background: 'var(--color-red-dark)' }} />Over threshold (flagged)</span>
              <span><span className={nc.legendDot} style={{ background: 'var(--color-teal-dark)' }} />Under threshold</span>
              <span><span className={nc.legendLine} />Flag threshold</span>
            </div>
          </div>

          {report.deferredDimensions?.length > 0 && (
            <div className={styles.card} style={{ marginBottom: 'var(--space-4)', background: 'var(--color-slate-tint)' }}>
              {report.deferredDimensions.map((dim) => (
                <p key={dim.key} className={styles.issueMeta} style={{ margin: 0 }}>
                  <strong>{dim.label}:</strong> Coming soon - {dim.reason}
                </p>
              ))}
            </div>
          )}

          {/* --- flagged detail table --- */}
          <div className={styles.card} style={{ marginBottom: 'var(--space-4)' }}>
            <h2 className={styles.pageSubtitle} style={{ margin: '0 0 var(--space-1)', fontWeight: 600 }}>Flagged Developers - Detail</h2>
            <p className={styles.issueMeta} style={{ margin: '0 0 var(--space-2)' }}>Click a task list to expand.</p>
            <details className={nc.taskList} style={{ margin: '0 0 var(--space-3)' }}>
              <summary>How these are counted</summary>
              <ul>
                <li>
                  <strong>Late to QA:</strong> {LATE_TO_QA_RULE} Hold, Closed and Escalated tasks are left out.
                </li>
                <li>
                  <strong>Test failed (QA + peer review, info):</strong> {TEST_FAILED_RULE}
                </li>
                <li>
                  <strong>Not ready for testing (info):</strong> {INCOMPLETE_RULE} Both are counted by submission date, like the Rejection Rate.
                </li>
                <li>
                  <strong>Flagged</strong> if any of: {report.thresholds.lateToQaCount}+ tasks late to QA; rejection rate over{' '}
                  {report.thresholds.rejectionRatePercent}% with at least {report.thresholds.rejectionRateMinSubmissions} submissions;{' '}
                  {report.thresholds.escalationCount}+ PM interventions; {report.thresholds.vagueNotesCount}+ vague notes. Thresholds are set in
                  Admin &rarr; Performance Metrics Settings.
                </li>
              </ul>
            </details>

            {flaggedDevelopers.length === 0 && <div className={styles.empty}>No developers are flagged for this period.</div>}

            {flaggedDevelopers.length > 0 && (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid var(--color-border)', fontSize: 11 }}>Developer</th>
                    <th style={{ textAlign: 'center', padding: '10px 12px', borderBottom: '1px solid var(--color-border)', fontSize: 11 }} title={LATE_TO_QA_RULE}>Late to QA</th>
                    <th style={{ textAlign: 'center', padding: '10px 12px', borderBottom: '1px solid var(--color-border)', fontSize: 11 }}>Rejection Rate</th>
                    <th style={{ textAlign: 'center', padding: '10px 12px', borderBottom: '1px solid var(--color-border)', fontSize: 11 }}>Interventions</th>
                    <th style={{ textAlign: 'center', padding: '10px 12px', borderBottom: '1px solid var(--color-border)', fontSize: 11 }}>Vague Notes</th>
                    <th style={{ textAlign: 'center', padding: '10px 12px', borderBottom: '1px solid var(--color-border)', fontSize: 11 }} title={TEST_FAILED_RULE}>Test failed (QA + peer review)</th>
                    <th style={{ textAlign: 'center', padding: '10px 12px', borderBottom: '1px solid var(--color-border)', fontSize: 11 }} title={INCOMPLETE_RULE}>Not ready for testing</th>
                    <th style={{ textAlign: 'center', padding: '10px 12px', borderBottom: '1px solid var(--color-border)', fontSize: 11 }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {flaggedDevelopers.map((dev) => (
                    <tr key={dev.userId}>
                      <td style={{ padding: '12px', borderBottom: '1px solid var(--color-border)' }}>
                        <span style={{ fontWeight: 700 }}>{devName(dev)}</span>
                        <span style={{ display: 'block', fontSize: 10.5, color: 'var(--color-ink-soft)' }}>{dev.email}</span>
                      </td>
                      <td style={{ padding: '12px', borderBottom: '1px solid var(--color-border)', textAlign: 'center' }}>
                        <span className={`${nc.metricValue} ${dev.lateToQa.flagged ? nc.flag : ''}`}>{dev.lateToQa.count}</span>
                        {dev.lateToQa.items.length > 0 && (
                          <details className={nc.taskList}>
                            <summary>view {dev.lateToQa.items.length}</summary>
                            <ul>
                              {dev.lateToQa.items.map((item) => (
                                <li key={item.taskId}>
                                  <a href={`/tasks/${item.taskId}`} target="_blank" rel="noopener noreferrer">#{item.taskId}</a>{' '}
                                  {item.title}{' '}
                                  <span className={nc.tag}>
                                    {LATE_TO_QA_REASON_LABEL[item.reason] || item.reason}, {item.daysLate} day{item.daysLate === 1 ? '' : 's'} after{' '}
                                    {formatDate(item.effectiveDueDate)}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </details>
                        )}
                      </td>
                      <td style={{ padding: '12px', borderBottom: '1px solid var(--color-border)', textAlign: 'center' }}>
                        {dev.rejectionRate.submissions >= report.thresholds.rejectionRateMinSubmissions ? (
                          <>
                            <span className={`${nc.metricValue} ${dev.rejectionRate.flagged ? nc.flag : ''}`}>{dev.rejectionRate.rate}%</span>
                            <span className={nc.metricFrac}>{dev.rejectionRate.rejections} of {dev.rejectionRate.submissions} submissions</span>
                          </>
                        ) : (
                          <span className={nc.metricNa}>{dev.rejectionRate.rejections}/{dev.rejectionRate.submissions} - below minimum</span>
                        )}
                      </td>
                      <td style={{ padding: '12px', borderBottom: '1px solid var(--color-border)', textAlign: 'center' }}>
                        <span className={`${nc.metricValue} ${dev.escalations.flagged ? nc.flag : ''}`}>{dev.escalations.count}</span>
                        {dev.escalations.items.length > 0 && (
                          <details className={nc.taskList}>
                            <summary>view</summary>
                            <ul>
                              {dev.escalations.items.map((item, i) => (
                                <li key={`${item.taskId}-${i}`}>
                                  <a href={`/tasks/${item.taskId}`} target="_blank" rel="noopener noreferrer">#{item.taskId}</a>{' '}
                                  {item.title} <span className={nc.tag}>→ PM {item.escalatedAt ? formatDate(item.escalatedAt) : ''}</span>
                                </li>
                              ))}
                            </ul>
                          </details>
                        )}
                      </td>
                      <td style={{ padding: '12px', borderBottom: '1px solid var(--color-border)', textAlign: 'center' }}>
                        <span className={`${nc.metricValue} ${dev.resolutionQuality.flagged ? nc.flag : ''}`}>{dev.resolutionQuality.count}</span>
                        <span className={nc.metricFrac}>of {dev.resolutionQuality.checked} checked</span>
                        {dev.resolutionQuality.items.length > 0 && (
                          <details className={nc.taskList}>
                            <summary>view {dev.resolutionQuality.items.length}</summary>
                            <ul>
                              {dev.resolutionQuality.items.map((item, i) => (
                                <li key={`${item.taskId}-${i}`}>
                                  <a href={`/tasks/${item.taskId}`} target="_blank" rel="noopener noreferrer">#{item.taskId}</a>{' '}
                                  {item.title} <span className={nc.tag}>&quot;{item.resolutionExcerpt}&quot;</span>
                                  {item.reason ? <span className={nc.tag}> - {item.reason}</span> : null}
                                </li>
                              ))}
                            </ul>
                          </details>
                        )}
                      </td>
                      <td style={{ padding: '12px', borderBottom: '1px solid var(--color-border)', textAlign: 'center' }}>
                        <span className={nc.metricValue}>{dev.testFailed.count}</span>
                        <TestFailedList items={dev.testFailed.items} />
                      </td>
                      <td style={{ padding: '12px', borderBottom: '1px solid var(--color-border)', textAlign: 'center' }}>
                        <span className={nc.metricValue}>{dev.incompleteSubmissions.count}</span>
                        <IncompleteList items={dev.incompleteSubmissions.items} />
                      </td>
                      <td style={{ padding: '12px', borderBottom: '1px solid var(--color-border)', textAlign: 'center' }}>
                        <Badge tone="error">Flagged</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className={styles.issueMeta} style={{ margin: 'var(--space-2) 0 0' }}>
              Not ready counts start on {formatDate(report.notReadySince)}; earlier returns were recorded as rejections and are not reclassified.
            </p>
          </div>

          {/* --- compliant chips --- */}
          <div className={styles.card}>
            <h2 className={styles.pageSubtitle} style={{ margin: '0 0 var(--space-1)', fontWeight: 600 }}>Compliant</h2>
            <p className={styles.issueMeta} style={{ margin: '0 0 var(--space-3)' }}>No metric over threshold this period.</p>
            {compliantDevelopers.length === 0 ? (
              <div className={styles.empty}>No developers found.</div>
            ) : (
              <div className={nc.compliantStrip}>
                {compliantDevelopers.map((dev) => (
                  <div key={dev.userId} className={nc.compliantChip}>
                    <Badge tone="success">Clean</Badge>
                    <span className={nc.compliantWho}>
                      {devName(dev)}
                      <span>
                        {dev.lateToQa.count} late to QA &middot;{' '}
                        {dev.rejectionRate.submissions >= report.thresholds.rejectionRateMinSubmissions
                          ? `${dev.rejectionRate.rate}% rate`
                          : 'n/a rate'}{' '}
                        &middot; {dev.escalations.count} interventions &middot; {dev.resolutionQuality.count} vague &middot;{' '}
                        {dev.testFailed.count} test failed &middot; {dev.incompleteSubmissions.count} not ready
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* --- "Not ready for testing" - information only (2026-10-27) --- */}
          <div className={styles.card} style={{ marginTop: 'var(--space-4)' }}>
            <h2 className={styles.pageSubtitle} style={{ margin: '0 0 var(--space-1)', fontWeight: 600 }}>All developers - test failed and not ready (information only)</h2>
            <p className={styles.issueMeta} style={{ margin: '0 0 var(--space-3)' }}>
              Every developer, flagged or not, by submission date. Never flagged. Not ready counts start on {formatDate(report.notReadySince)}.
            </p>

            {report.developers.length === 0 ? (
              <div className={styles.empty}>No developers found.</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 'var(--space-4)' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid var(--color-border)', fontSize: 11 }}>Developer</th>
                    <th style={{ textAlign: 'center', padding: '10px 12px', borderBottom: '1px solid var(--color-border)', fontSize: 11 }} title={TEST_FAILED_RULE}>Test failed (QA + peer review)</th>
                    <th style={{ textAlign: 'center', padding: '10px 12px', borderBottom: '1px solid var(--color-border)', fontSize: 11 }} title={INCOMPLETE_RULE}>Not ready for testing</th>
                  </tr>
                </thead>
                <tbody>
                  {[...report.developers]
                    .sort(
                      (a, b) =>
                        b.incompleteSubmissions.count - a.incompleteSubmissions.count ||
                        b.testFailed.count - a.testFailed.count ||
                        devName(a).localeCompare(devName(b)),
                    )
                    .map((dev) => (
                      <tr key={dev.userId}>
                        <td style={{ padding: '12px', borderBottom: '1px solid var(--color-border)' }}>{devName(dev)}</td>
                        <td style={{ padding: '12px', borderBottom: '1px solid var(--color-border)', textAlign: 'center' }}>
                          <span className={nc.metricValue}>{dev.testFailed.count}</span>
                          <TestFailedList items={dev.testFailed.items} />
                        </td>
                        <td style={{ padding: '12px', borderBottom: '1px solid var(--color-border)', textAlign: 'center' }}>
                          <span className={nc.metricValue}>{dev.incompleteSubmissions.count}</span>
                          <IncompleteList items={dev.incompleteSubmissions.items} />
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}

            <h3 className={styles.label} style={{ margin: '0 0 var(--space-2)' }}>&quot;Not ready&quot; returns by QA</h3>
            <p className={styles.issueMeta} style={{ margin: '0 0 var(--space-2)' }}>
              Out of each QA&apos;s approvals, rejections and not-ready returns on submissions in this period - to see if the option is overused. Never flagged.
            </p>
            {(report.qaNotReadyUsage || []).length === 0 ? (
              <div className={styles.empty}>No QA users found.</div>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 'var(--space-4)' }}>
                {report.qaNotReadyUsage.map((qa) => (
                  <li key={qa.userId}>
                    <strong>{qa.name}</strong>: {qa.notReady} not ready of {qa.decisions} decision{qa.decisions === 1 ? '' : 's'}
                    {qa.percent !== null ? ` (${qa.percent}%)` : ''}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* --- Defect triage - information only (2026-10-27) --- */}
          <div className={styles.card} style={{ marginTop: 'var(--space-4)' }}>
            <h2 className={styles.pageSubtitle} style={{ margin: '0 0 var(--space-1)', fontWeight: 600 }}>All developers - defect triage (information only)</h2>
            <p className={styles.issueMeta} style={{ margin: '0 0 var(--space-3)' }}>
              Projects with defect triage on. Never flagged and never a KPI penalty.
            </p>
            {report.developers.length === 0 ? (
              <div className={styles.empty}>No developers found.</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid var(--color-border)', fontSize: 11 }}>Developer</th>
                    <th style={{ textAlign: 'center', padding: '10px 12px', borderBottom: '1px solid var(--color-border)', fontSize: 11 }} title={LATE_TRIAGE_RULE}>Late triage</th>
                    <th style={{ textAlign: 'center', padding: '10px 12px', borderBottom: '1px solid var(--color-border)', fontSize: 11 }} title={DISPUTES_RULE}>Disputes (agreed / rejected / waiting)</th>
                  </tr>
                </thead>
                <tbody>
                  {[...report.developers]
                    .sort((a, b) => b.lateTriage.count - a.lateTriage.count || b.disputes.raised - a.disputes.raised || devName(a).localeCompare(devName(b)))
                    .map((dev) => (
                      <tr key={dev.userId}>
                        <td style={{ padding: '12px', borderBottom: '1px solid var(--color-border)' }}>{devName(dev)}</td>
                        <td style={{ padding: '12px', borderBottom: '1px solid var(--color-border)', textAlign: 'center' }}>
                          <span className={nc.metricValue}>{dev.lateTriage.count}</span>
                          <LateTriageList items={dev.lateTriage.items} />
                        </td>
                        <td style={{ padding: '12px', borderBottom: '1px solid var(--color-border)', textAlign: 'center' }}>
                          <span className={nc.metricValue}>{dev.disputes.raised}</span>
                          <span className={nc.metricFrac}>
                            {dev.disputes.agreed} / {dev.disputes.rejected} / {dev.disputes.waiting}
                          </span>
                          <DisputeList items={dev.disputes.items} />
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
            <p className={styles.issueMeta} style={{ margin: 'var(--space-2) 0 0' }}>
              {LATE_TRIAGE_RULE} {DISPUTES_RULE}
            </p>
          </div>
        </>
      )}
    </AppShell>
  );
}
