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

// Same tier as KPI Matrix (GET /kpi/report) - Admin/Executive/Program
// Manager only. A developer never sees this report about themselves or
// teammates (confirmed with the user).
const VIEW_ROLES = ['admin', 'executive', 'program_manager'];

const MISSED_SLA_REASON_LABEL = {
  resolved_late: 'Resolved late',
  open_past_due: 'Open, past due',
  review_overdue: 'Pending review, past QA Review Due Date',
};

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
      router.replace('/');
      return;
    }
    const parsed = JSON.parse(storedUser);
    if (!VIEW_ROLES.includes(parsed.role)) {
      router.replace('/dashboard');
      return;
    }
    setUser(parsed);
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
    if (!user) return;
    setLoading(true);
    setError('');
    apiFetch(`/non-compliance-report?${buildParams().toString()}`)
      .then(setReport)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, project, from, to]);

  if (!user) return null;

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

  const missedSlaSorted = [...developers].sort((a, b) => b.missedSla.count - a.missedSla.count);
  const missedSlaMax = Math.max(...missedSlaSorted.map((d) => d.missedSla.count), 1);
  const missedSlaThresholdPos = report ? thresholdPositionPercent(report.thresholds.missedSlaCount, missedSlaMax) : null;

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
            Missed SLA/due dates, QA/Peer Review rejection rate, escalations, and vague resolution notes, per developer.
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

      {loading && <div className={styles.empty}>Loading...</div>}

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
              <div className={nc.kpiLabel}>Missed SLA / Due Dates</div>
              <div className={nc.kpiValue}>{report.summary.missedSlaTotal}</div>
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
              <div className={nc.kpiLabel}>Escalated to PM</div>
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
                <h3 className={nc.chartTitle}>Missed SLA / Due Dates</h3>
                {missedSlaSorted.map((dev) => (
                  <div key={dev.userId} className={nc.barRow}>
                    <div className={nc.barName} title={devName(dev)}>{devName(dev)}</div>
                    <div className={nc.barTrack}>
                      {missedSlaThresholdPos && <div className={nc.thresholdLine} style={{ left: missedSlaThresholdPos }} />}
                      <div
                        className={`${nc.barFill} ${dev.missedSla.flagged ? nc.critical : nc.good}`}
                        style={{ width: barWidthPercent(dev.missedSla.count, missedSlaMax) }}
                      />
                    </div>
                    <div className={nc.barValue}>{dev.missedSla.count}</div>
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
            <p className={styles.issueMeta} style={{ margin: '0 0 var(--space-3)' }}>Click a task list to expand.</p>

            {flaggedDevelopers.length === 0 && <div className={styles.empty}>No developers are flagged for this period.</div>}

            {flaggedDevelopers.length > 0 && (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid var(--color-border)', fontSize: 11 }}>Developer</th>
                    <th style={{ textAlign: 'center', padding: '10px 12px', borderBottom: '1px solid var(--color-border)', fontSize: 11 }}>Missed SLA</th>
                    <th style={{ textAlign: 'center', padding: '10px 12px', borderBottom: '1px solid var(--color-border)', fontSize: 11 }}>Rejection Rate</th>
                    <th style={{ textAlign: 'center', padding: '10px 12px', borderBottom: '1px solid var(--color-border)', fontSize: 11 }}>Escalated</th>
                    <th style={{ textAlign: 'center', padding: '10px 12px', borderBottom: '1px solid var(--color-border)', fontSize: 11 }}>Vague Notes</th>
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
                        <span className={`${nc.metricValue} ${dev.missedSla.flagged ? nc.flag : ''}`}>{dev.missedSla.count}</span>
                        {dev.missedSla.items.length > 0 && (
                          <details className={nc.taskList}>
                            <summary>view {dev.missedSla.items.length}</summary>
                            <ul>
                              {dev.missedSla.items.map((item, i) => (
                                <li key={`${item.taskId}-${item.reason}-${i}`}>
                                  <a href={`/tasks/${item.taskId}`} target="_blank" rel="noopener noreferrer">#{item.taskId}</a>{' '}
                                  {item.title} <span className={nc.tag}>{MISSED_SLA_REASON_LABEL[item.reason] || item.reason}</span>
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
                        <Badge tone="error">Flagged</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
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
                        {dev.missedSla.count} missed &middot;{' '}
                        {dev.rejectionRate.submissions >= report.thresholds.rejectionRateMinSubmissions
                          ? `${dev.rejectionRate.rate}% rate`
                          : 'n/a rate'}{' '}
                        &middot; {dev.escalations.count} escalated &middot; {dev.resolutionQuality.count} vague
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </AppShell>
  );
}
