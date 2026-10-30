import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import AppShell from '../components/AppShell';
import LoadingState from '../components/ui/LoadingState';
import Badge from '../components/ui/Badge';
import styles from '../styles/issues.module.css';
import { apiFetch } from '../lib/api';
import { useToast } from '../lib/toast';
import { redirectToSignIn } from '../lib/session';
import { formatDate, formatDateTime } from '../lib/formatDate';

const STATUS = {
  on_time: { tone: 'success', text: 'On time' },
  late: { tone: 'error', text: 'Late' },
  missing: { tone: 'error', text: 'Missing' },
  not_due: { tone: 'neutral', text: 'Not due yet' },
  waiting: { tone: 'warning', text: 'Not submitted yet' },
};
const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// Weekly status report (Performance Tracking C3, 2026-10-30). Developers,
// Designers and DevOps submit their own report each week (done, plan,
// blockers) before the deadline (default Thursday 17:00 East Africa Time,
// Performance Tracking Settings); the first submission time is kept and
// judged against it. PM, Executive and Admin see everyone's for the week.
// Rules: backend/src/weekly-status/weekly-status.ts.
export default function WeeklyStatusPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [week, setWeek] = useState(null);
  const [page, setPage] = useState(null);
  const [draft, setDraft] = useState({ done: '', plan: '', blockers: '' });
  const [open, setOpen] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = (w) =>
    apiFetch(`/weekly-status${w ? `?week=${w}` : ''}`)
      .then((p) => {
        setPage(p);
        setWeek(p.week);
        setDraft({ done: p.mine?.done || '', plan: p.mine?.plan || '', blockers: p.mine?.blockers || '' });
        setError('');
      })
      .catch((err) => setError(err.message));

  useEffect(() => {
    if (!localStorage.getItem('user')) {
      redirectToSignIn(router);
      return;
    }
    load(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  const submit = async (e) => {
    e.preventDefault();
    if (draft.done.trim().length < page.minLength || draft.plan.trim().length < page.minLength) {
      setError(`"Done this week" and "Plan for next week" need at least ${page.minLength} characters each.`);
      return;
    }
    setBusy(true);
    try {
      const next = await apiFetch('/weekly-status', { method: 'PUT', body: JSON.stringify({ week, ...draft }) });
      setPage(next);
      showToast(page.mine ? 'Weekly report updated' : 'Weekly report submitted', 'success');
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const status = (s) => <Badge tone={STATUS[s].tone}>{STATUS[s].text}</Badge>;

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Weekly Status Report</h1>
          <p className={styles.pageSubtitle}>
            {page
              ? `Week of ${formatDate(page.week)}. Due ${formatDateTime(page.deadlineAt, page.timeZone)} (${page.timeZone}).`
              : 'Your weekly report, before the deadline.'}
          </p>
        </div>
        {page && (
          <div className={styles.actions}>
            <button className={styles.buttonSecondary} type="button" onClick={() => load(addDays(page.week, -7))}>
              Previous week
            </button>
            {page.week < page.currentWeek && (
              <button className={styles.buttonSecondary} type="button" onClick={() => load(addDays(page.week, 7))}>
                Next week
              </button>
            )}
          </div>
        )}
      </div>

      {error && <div className={styles.error} role="alert">{error}</div>}
      {!page && !error && <LoadingState />}

      {page?.canSubmit && (
        <div className={styles.card} style={{ marginBottom: 'var(--space-4)' }}>
          <h2 className={styles.cardTitle}>
            My report {page.mine ? status(page.mine.status) : status(page.deadlinePassed ? 'missing' : 'waiting')}
          </h2>
          {page.mine && (
            <p className={styles.helpText}>
              Submitted {formatDateTime(page.mine.submittedAt, page.timeZone)}
              {page.mine.updatedAt && page.mine.updatedAt !== page.mine.submittedAt ? `, last edited ${formatDateTime(page.mine.updatedAt, page.timeZone)}` : ''}. The first submission time is what counts.
            </p>
          )}
          {page.editable ? (
            <form onSubmit={submit}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="wsDone">Done this week</label>
                <textarea id="wsDone" className={styles.textarea} rows={4} maxLength={4000} value={draft.done} onChange={(e) => setDraft({ ...draft, done: e.target.value })} />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="wsPlan">Plan for next week</label>
                <textarea id="wsPlan" className={styles.textarea} rows={4} maxLength={4000} value={draft.plan} onChange={(e) => setDraft({ ...draft, plan: e.target.value })} />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="wsBlockers">Blockers (optional)</label>
                <textarea id="wsBlockers" className={styles.textarea} rows={2} maxLength={4000} value={draft.blockers} onChange={(e) => setDraft({ ...draft, blockers: e.target.value })} />
              </div>
              <div className={styles.actions}>
                <button className={`${styles.button} ${styles.buttonAccent}`} type="submit" disabled={busy}>
                  {busy ? 'Saving...' : page.mine ? 'Update my report' : 'Submit my weekly report'}
                </button>
              </div>
            </form>
          ) : (
            page.mine && <ReportText r={page.mine} />
          )}
          {!page.editable && !page.mine && <p className={styles.helpText}>This week can no longer be submitted.</p>}
        </div>
      )}

      {page?.team && (
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Team for the week of {formatDate(page.week)}</h2>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Status</th>
                  <th>Submitted</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {page.team.map((t) => (
                  <tr key={t.userId}>
                    <td>{t.name}</td>
                    <td>{status(t.status)}</td>
                    <td>{t.submittedAt ? formatDateTime(t.submittedAt, page.timeZone) : '—'}</td>
                    <td>
                      {t.report && (
                        <button className={styles.buttonSecondary} type="button" onClick={() => setOpen(open === t.userId ? null : t.userId)}>
                          {open === t.userId ? 'Hide' : 'Read'}
                        </button>
                      )}
                      {open === t.userId && t.report && <ReportText r={t.report} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </AppShell>
  );
}

function ReportText({ r }) {
  return (
    <div style={{ whiteSpace: 'pre-wrap', marginTop: 'var(--space-2)' }}>
      <p style={{ margin: 0 }}><strong>Done:</strong> {r.done}</p>
      <p style={{ margin: 'var(--space-1) 0 0' }}><strong>Plan:</strong> {r.plan}</p>
      {r.blockers && <p style={{ margin: 'var(--space-1) 0 0' }}><strong>Blockers:</strong> {r.blockers}</p>}
    </div>
  );
}
