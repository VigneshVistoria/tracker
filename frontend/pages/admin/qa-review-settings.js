import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import AppShell from '../../components/AppShell';
import LoadingState from '../../components/ui/LoadingState';
import styles from '../../styles/issues.module.css';
import { apiFetch } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { redirectToSignIn } from '../../lib/session';

// QA "Not ready for testing" reasons (2026-10-27) - Admin and Program
// Manager (backend: QaReviewSettingsController). The list QA picks from
// when they reject a task as "Not ready for testing". Each task keeps the
// reason as it was picked, so renaming or removing one here never changes
// history. Mirrors QA_NOT_READY_REASON_MAX / _MAX_COUNT in
// backend/src/tasks/qa-not-ready.ts.
const REASON_MAX = 100;
const MAX_REASONS = 30;
const EDIT_ROLES = ['admin', 'program_manager'];

export default function QaReviewSettingsPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [reasons, setReasons] = useState(null);
  const [newReason, setNewReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const stored = localStorage.getItem('user');
    if (!stored) {
      redirectToSignIn(router);
      return;
    }
    if (!EDIT_ROLES.includes(JSON.parse(stored).role)) {
      router.replace('/dashboard');
      return;
    }
    apiFetch('/qa-review/not-ready-reasons')
      .then((res) => setReasons(res.reasons))
      .catch((err) => setError(err.message));
  }, [router]);

  const save = async (next, message) => {
    setBusy(true);
    setError('');
    try {
      const res = await apiFetch('/qa-review/not-ready-reasons', { method: 'PATCH', body: JSON.stringify({ reasons: next }) });
      setReasons(res.reasons);
      showToast(message, 'success');
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async (e) => {
    e.preventDefault();
    const r = newReason.trim();
    if (!r) return;
    if (reasons.some((x) => x.toLowerCase() === r.toLowerCase())) {
      setError(`"${r}" is already on the list.`);
      return;
    }
    if (await save([...reasons, r], `Added "${r}"`)) setNewReason('');
  };

  const remove = (r) => save(reasons.filter((x) => x !== r), `Removed "${r}"`);

  const move = (index, delta) => {
    const next = [...reasons];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item);
    save(next, 'Order saved');
  };

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>QA Review Settings</h1>
          <p className={styles.pageSubtitle}>
            When QA rejects a task as &quot;Not ready for testing&quot;, they pick one of these reasons and write a comment. It goes back
            to the developer, is not counted as a rejection, and shows as an incomplete submission on the Non-compliance report.
          </p>
        </div>
      </div>

      {error && <div className={styles.error} role="alert">{error}</div>}
      {!reasons && !error && <LoadingState />}

      {reasons && (
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Not ready for testing - reasons</h2>
          <p className={styles.helpText} style={{ marginTop: 0 }}>
            Shown to QA in this order. Renaming or removing a reason never changes tasks that already used it. At least one reason is
            needed.
          </p>
          <ol style={{ margin: '0 0 var(--space-4)', paddingLeft: 'var(--space-5)' }}>
            {reasons.map((r, i) => (
              <li key={r} style={{ marginBottom: 'var(--space-2)' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                  <span>{r}</span>
                  <button
                    className={styles.buttonSecondary}
                    type="button"
                    onClick={() => move(i, -1)}
                    disabled={busy || i === 0}
                    aria-label={`Move "${r}" up`}
                  >
                    Up
                  </button>
                  <button
                    className={styles.buttonSecondary}
                    type="button"
                    onClick={() => move(i, 1)}
                    disabled={busy || i === reasons.length - 1}
                    aria-label={`Move "${r}" down`}
                  >
                    Down
                  </button>
                  <button
                    className={styles.buttonSecondary}
                    type="button"
                    onClick={() => remove(r)}
                    disabled={busy || reasons.length === 1}
                    aria-label={`Remove "${r}"`}
                  >
                    Remove
                  </button>
                </span>
              </li>
            ))}
          </ol>
          <form onSubmit={add} className={styles.actions} style={{ alignItems: 'end' }}>
            <div className={styles.field} style={{ marginBottom: 0, flex: '1 1 260px' }}>
              <label className={styles.label} htmlFor="qaNotReadyNewReason">New reason</label>
              <input
                id="qaNotReadyNewReason"
                className={styles.input}
                value={newReason}
                maxLength={REASON_MAX}
                onChange={(e) => setNewReason(e.target.value)}
                placeholder="e.g. Test data missing"
                disabled={busy || reasons.length >= MAX_REASONS}
              />
            </div>
            <button className={`${styles.button} ${styles.buttonAccent}`} type="submit" disabled={busy || !newReason.trim() || reasons.length >= MAX_REASONS}>
              {busy ? 'Saving...' : 'Add reason'}
            </button>
          </form>
        </div>
      )}
    </AppShell>
  );
}
