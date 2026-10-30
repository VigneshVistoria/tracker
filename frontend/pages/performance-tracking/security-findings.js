import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import AppShell from '../../components/AppShell';
import LoadingState from '../../components/ui/LoadingState';
import Modal from '../../components/ui/Modal';
import Badge from '../../components/ui/Badge';
import styles from '../../styles/issues.module.css';
import { apiFetch } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { redirectToSignIn } from '../../lib/session';
import { formatDate, formatDateTime } from '../../lib/formatDate';

const SEVERITY_LABEL = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };
const SEVERITY_TONE = { critical: 'error', high: 'error', medium: 'warning', low: 'neutral' };
const STATUS_LABEL = { open: 'Open', fix_submitted: 'Fix waiting for verification', verified: 'Verified fixed', risk_accepted: 'Risk accepted' };
const STATUS_TONE = { open: 'warning', fix_submitted: 'info', verified: 'success', risk_accepted: 'neutral' };
const emptyDraft = (today) => ({ projectId: '', taskId: '', title: '', severity: 'high', source: '', details: '', ownerUserId: '', foundOn: today });

// Security Findings (Performance Tracking P3/P4, 2026-10-30). Recorded by
// hand by QA, Program Manager or Admin (setting); the owner submits the
// fix, someone else verifies it; PM/Admin can accept the risk. The fix is
// due within the SLA working days for its severity. Rules:
// backend/src/security-findings/security-findings.ts.
export default function SecurityFindingsPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [page, setPage] = useState(null);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState(null);
  const [draft, setDraft] = useState(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () =>
    apiFetch('/security-findings')
      .then((p) => {
        setPage(p);
        setError('');
      })
      .catch((err) => setError(err.message));

  useEffect(() => {
    if (!localStorage.getItem('user')) {
      redirectToSignIn(router);
      return;
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  const open = (type, finding = null) => {
    setError('');
    setText('');
    if (type === 'edit') {
      setDraft(
        finding
          ? { title: finding.title, severity: finding.severity, source: finding.source || '', details: finding.details || '', ownerUserId: String(finding.ownerUserId), foundOn: finding.foundOn }
          : { ...emptyDraft(page.today), projectId: page.projects.length === 1 ? String(page.projects[0].id) : '' },
      );
    }
    setDialog({ type, finding });
  };

  const send = async (url, method, body, done) => {
    setBusy(true);
    setError('');
    try {
      setPage(await apiFetch(url, { method, body: JSON.stringify(body) }));
      setDialog(null);
      showToast(done, 'success');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const save = (e) => {
    e.preventDefault();
    const f = dialog.finding;
    if (!draft.title.trim() || !draft.ownerUserId) {
      setError('Give the finding a title and pick the owner.');
      return;
    }
    if (!f && !draft.taskId.trim() && !draft.projectId) {
      setError('Pick the project, or give a task number.');
      return;
    }
    const body = {
      title: draft.title.trim(),
      severity: draft.severity,
      source: draft.source.trim() || null,
      details: draft.details.trim() || null,
      ownerUserId: Number(draft.ownerUserId),
      foundOn: draft.foundOn,
    };
    if (f) send(`/security-findings/${f.id}`, 'PATCH', body, 'Finding saved');
    else send('/security-findings', 'POST', { ...body, ...(draft.taskId.trim() ? { taskId: Number(draft.taskId) } : { projectId: Number(draft.projectId) }) }, 'Finding recorded');
  };

  const act = (e) => {
    e.preventDefault();
    const f = dialog.finding;
    if (dialog.type === 'fix') send(`/security-findings/${f.id}/fix`, 'POST', { note: text }, 'Fix submitted for verification');
    if (dialog.type === 'pass') send(`/security-findings/${f.id}/verify`, 'POST', { passed: true, note: text || undefined }, 'Fix verified');
    if (dialog.type === 'fail') send(`/security-findings/${f.id}/verify`, 'POST', { passed: false, note: text }, 'Fix failed - finding reopened');
    if (dialog.type === 'risk') send(`/security-findings/${f.id}/accept-risk`, 'POST', { reason: text }, 'Risk accepted');
  };

  const ACTION = {
    fix: { title: 'Submit fix', label: 'What was fixed (at least 10 characters)', button: 'Submit fix' },
    pass: { title: 'Verified fixed', label: 'Note (optional)', button: 'Verified fixed' },
    fail: { title: 'Fix did not work', label: 'Why it failed (at least 10 characters)', button: 'Fix failed' },
    risk: { title: 'Accept the risk', label: 'Reason (at least 10 characters)', button: 'Accept risk' },
  };

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Security Findings</h1>
          <p className={styles.pageSubtitle}>
            Each finding has an SLA
            {page ? ` (Critical ${page.slaDays.critical}, High ${page.slaDays.high}, Medium ${page.slaDays.medium}, Low ${page.slaDays.low} working days)` : ''}, counted from the day it
            was found, and the owner is charged from the day it was assigned to them (reassigning restarts it). Accepted risks are never charged. The owner submits the fix; someone
            else verifies it.
          </p>
        </div>
        <div className={styles.actions}>
          {page?.canRecord && (
            <button className={`${styles.button} ${styles.buttonAccent}`} type="button" onClick={() => open('edit')}>
              New finding
            </button>
          )}
        </div>
      </div>

      {error && !dialog && <div className={styles.error} role="alert">{error}</div>}
      {!page && !error && <LoadingState />}

      {page && (
        <div className={styles.card}>
          {page.findings.length === 0 ? (
            <p style={{ margin: 0 }}>No security findings.</p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Finding</th>
                    <th>Severity</th>
                    <th>Owner</th>
                    <th>Found</th>
                    <th>SLA due (from found)</th>
                    <th>Owner due (from assigned)</th>
                    <th>Status</th>
                    <th aria-label="Actions"></th>
                  </tr>
                </thead>
                <tbody>
                  {page.findings.map((f) => (
                    <tr key={f.id} id={`finding-${f.id}`}>
                      <td>
                        <strong>{f.title}</strong>
                        {f.taskId && (
                          <>
                            {' '}
                            (<Link href={`/tasks/${f.taskId}`}>#{f.taskId}</Link>)
                          </>
                        )}
                        <div className={styles.issueMeta}>
                          {f.projectName}
                          {f.source ? ` · ${f.source}` : ''} · recorded by {f.createdByName}
                        </div>
                        {f.details && <div style={{ whiteSpace: 'pre-wrap' }}>{f.details}</div>}
                        {f.fixNote && <div className={styles.issueMeta}>Fix: {f.fixNote}</div>}
                        {f.riskReason && <div className={styles.issueMeta}>Risk accepted by {f.riskAcceptedByName}: {f.riskReason}</div>}
                      </td>
                      <td>
                        <Badge tone={SEVERITY_TONE[f.severity]}>{SEVERITY_LABEL[f.severity]}</Badge>
                      </td>
                      <td>{f.ownerName}</td>
                      <td>{formatDate(f.foundOn)}</td>
                      <td>
                        {formatDate(f.dueOn)}
                        {f.slaMissed && (
                          <>
                            {' '}
                            <Badge tone="error">SLA missed</Badge>
                          </>
                        )}
                      </td>
                      <td>
                        {formatDate(f.ownerDueOn)}
                        {f.ownerBreached && (
                          <>
                            {' '}
                            <Badge tone="error">Late (charged)</Badge>
                          </>
                        )}
                        <div className={styles.issueMeta}>assigned {formatDate(f.assignedOn)}</div>
                      </td>
                      <td>
                        <Badge tone={STATUS_TONE[f.status]}>{STATUS_LABEL[f.status]}</Badge>
                        {f.verifyAttempts > 0 && <div className={styles.issueMeta}>{f.verifyAttempts} verification(s), first {f.firstVerifyResult}</div>}
                        {f.verifiedAt && <div className={styles.issueMeta}>by {f.verifiedByName}, {formatDateTime(f.verifiedAt)}</div>}
                      </td>
                      <td>
                        <div className={styles.actions} style={{ margin: 0, flexWrap: 'wrap' }}>
                          {f.canSubmitFix && (
                            <button className={styles.buttonSecondary} type="button" onClick={() => open('fix', f)}>Submit fix</button>
                          )}
                          {f.canVerify && (
                            <>
                              <button className={styles.buttonSecondary} type="button" onClick={() => open('pass', f)}>Verified</button>
                              <button className={styles.buttonSecondary} type="button" onClick={() => open('fail', f)}>Failed</button>
                            </>
                          )}
                          {f.canEdit && (
                            <button className={styles.buttonSecondary} type="button" onClick={() => open('edit', f)}>Edit</button>
                          )}
                          {f.canAcceptRisk && (
                            <button className={styles.buttonSecondary} type="button" onClick={() => open('risk', f)}>Accept risk</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {dialog?.type === 'edit' && draft && (
        <Modal title={dialog.finding ? 'Edit finding' : 'New security finding'} onClose={() => setDialog(null)}>
          <form onSubmit={save}>
            {!dialog.finding && (
              <>
                <div className={styles.fieldNarrow}>
                  <label className={styles.label} htmlFor="sfProject">Project (the task&apos;s, if a task is given)</label>
                  <select id="sfProject" className={styles.input} value={draft.projectId} onChange={(e) => setDraft({ ...draft, projectId: e.target.value })}>
                    <option value="">Pick...</option>
                    {page.projects.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <div className={styles.fieldNarrow}>
                  <label className={styles.label} htmlFor="sfTask">Task # (optional)</label>
                  <input id="sfTask" className={styles.input} inputMode="numeric" maxLength={10} value={draft.taskId} onChange={(e) => setDraft({ ...draft, taskId: e.target.value })} />
                </div>
              </>
            )}
            <div className={styles.field}>
              <label className={styles.label} htmlFor="sfTitle">Finding</label>
              <input id="sfTitle" className={styles.input} maxLength={200} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            </div>
            <div className={styles.fieldNarrow}>
              <label className={styles.label} htmlFor="sfSeverity">Severity</label>
              <select id="sfSeverity" className={styles.input} value={draft.severity} onChange={(e) => setDraft({ ...draft, severity: e.target.value })}>
                {page.severities.map((s) => (
                  <option key={s} value={s}>{SEVERITY_LABEL[s]} ({page.slaDays[s]} working days)</option>
                ))}
              </select>
            </div>
            <div className={styles.fieldNarrow}>
              <label className={styles.label} htmlFor="sfOwner">Owner (charged for the fix)</label>
              <select id="sfOwner" className={styles.input} value={draft.ownerUserId} onChange={(e) => setDraft({ ...draft, ownerUserId: e.target.value })}>
                <option value="">Pick...</option>
                {page.people.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div className={styles.fieldNarrow}>
              <label className={styles.label} htmlFor="sfFound">Found on</label>
              <input id="sfFound" type="date" className={styles.input} max={page.today} value={draft.foundOn} onChange={(e) => setDraft({ ...draft, foundOn: e.target.value })} />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="sfSource">Source, e.g. pen test or scanner (optional)</label>
              <input id="sfSource" className={styles.input} maxLength={100} value={draft.source} onChange={(e) => setDraft({ ...draft, source: e.target.value })} />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="sfDetails">Details (optional)</label>
              <textarea id="sfDetails" className={styles.textarea} rows={3} maxLength={4000} value={draft.details} onChange={(e) => setDraft({ ...draft, details: e.target.value })} />
            </div>
            {error && <div className={styles.error} role="alert">{error}</div>}
            <div className={styles.actions}>
              <button className={`${styles.button} ${styles.buttonAccent}`} type="submit" disabled={busy}>
                {busy ? 'Saving...' : 'Save'}
              </button>
              <button className={styles.buttonSecondary} type="button" onClick={() => setDialog(null)} disabled={busy}>
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      )}

      {dialog && ACTION[dialog.type] && (
        <Modal title={`${ACTION[dialog.type].title}: ${dialog.finding.title}`} onClose={() => setDialog(null)}>
          <form onSubmit={act}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="sfText">{ACTION[dialog.type].label}</label>
              <textarea id="sfText" className={styles.textarea} rows={3} maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} />
            </div>
            {error && <div className={styles.error} role="alert">{error}</div>}
            <div className={styles.actions}>
              <button className={`${styles.button} ${styles.buttonAccent}`} type="submit" disabled={busy}>
                {busy ? 'Saving...' : ACTION[dialog.type].button}
              </button>
              <button className={styles.buttonSecondary} type="button" onClick={() => setDialog(null)} disabled={busy}>
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      )}
    </AppShell>
  );
}
