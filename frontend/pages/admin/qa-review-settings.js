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
  const [allowed, setAllowed] = useState(false);

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
    setAllowed(true);
  }, [router]);

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

      {allowed && (
        <>
          <ReasonListEditor
            endpoint="/qa-review/not-ready-reasons"
            idPrefix="qaNotReady"
            title="Not ready for testing - reasons"
            placeholder="e.g. Test data missing"
          />
          {/* Performance Tracking S4 (2026-10-28) - backend/src/tasks/qa-intake.ts. */}
          <ReasonListEditor
            endpoint="/qa-review/test-failed-reasons"
            idPrefix="qaTestFailed"
            title="Test failed - reasons"
            intro="On projects with Performance Tracking on, QA picks one of these when rejecting a task (Test failed). Peer Review rejections have none."
            placeholder="e.g. Fix does not work"
          />
        </>
      )}
    </AppShell>
  );
}

// One editable reasons list (Admin and Program Manager).
function ReasonListEditor({ endpoint, idPrefix, title, intro, placeholder }) {
  const { showToast } = useToast();
  const [reasons, setReasons] = useState(null);
  // Not-ready list only (Performance Tracking S4): the reason with the
  // fixed "blocked by a dependency" code - renamable, never removable.
  const [dependencyReason, setDependencyReason] = useState(null);
  const [renaming, setRenaming] = useState(null);
  const [newReason, setNewReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    apiFetch(endpoint)
      .then((res) => {
        setReasons(res.reasons);
        setDependencyReason(res.dependencyReason ?? null);
      })
      .catch((err) => setError(err.message));
  }, [endpoint]);

  const save = async (next, message, nextDependencyReason = dependencyReason) => {
    setBusy(true);
    setError('');
    try {
      const body = { reasons: next, ...(nextDependencyReason ? { dependencyReason: nextDependencyReason } : {}) };
      const res = await apiFetch(endpoint, { method: 'PATCH', body: JSON.stringify(body) });
      setReasons(res.reasons);
      setDependencyReason(res.dependencyReason ?? null);
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

  const rename = async (e) => {
    e.preventDefault();
    const label = renaming.trim();
    if (!label || label === dependencyReason) {
      setRenaming(null);
      return;
    }
    if (reasons.some((x) => x !== dependencyReason && x.toLowerCase() === label.toLowerCase())) {
      setError(`"${label}" is already on the list.`);
      return;
    }
    if (await save(reasons.map((x) => (x === dependencyReason ? label : x)), `Renamed to "${label}"`, label)) setRenaming(null);
  };

  const move = (index, delta) => {
    const next = [...reasons];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item);
    save(next, 'Order saved');
  };

  return (
    <>
      {error && <div className={styles.error} role="alert">{error}</div>}
      {!reasons && !error && <LoadingState />}

      {reasons && (
        <div className={styles.card} style={{ marginBottom: 'var(--space-4)' }}>
          <h2 className={styles.cardTitle}>{title}</h2>
          {intro && <p className={styles.helpText} style={{ marginTop: 0 }}>{intro}</p>}
          <p className={styles.helpText} style={{ marginTop: 0 }}>
            Shown to QA in this order. Renaming or removing a reason never changes tasks that already used it. At least one reason is
            needed.
          </p>
          <ol style={{ margin: '0 0 var(--space-4)', paddingLeft: 'var(--space-5)' }}>
            {reasons.map((r, i) => (
              <li key={r} style={{ marginBottom: 'var(--space-2)' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                  {r === dependencyReason && renaming !== null ? (
                    <form onSubmit={rename} style={{ display: 'inline-flex', gap: 'var(--space-2)' }}>
                      <input
                        id={`${idPrefix}Rename`}
                        aria-label="New label for this reason"
                        className={styles.input}
                        value={renaming}
                        maxLength={REASON_MAX}
                        onChange={(e) => setRenaming(e.target.value)}
                        autoFocus
                      />
                      <button className={styles.buttonSecondary} type="submit" disabled={busy}>Save</button>
                      <button className={styles.buttonSecondary} type="button" onClick={() => setRenaming(null)} disabled={busy}>Cancel</button>
                    </form>
                  ) : (
                    <span>
                      {r}
                      {r === dependencyReason && (
                        <span className={styles.issueMeta}> (used for the dependency rule - can be renamed, not removed)</span>
                      )}
                    </span>
                  )}
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
                  {r === dependencyReason ? (
                    renaming === null && (
                      <button className={styles.buttonSecondary} type="button" onClick={() => setRenaming(r)} disabled={busy} aria-label={`Rename "${r}"`}>
                        Rename
                      </button>
                    )
                  ) : (
                    <button
                      className={styles.buttonSecondary}
                      type="button"
                      onClick={() => remove(r)}
                      disabled={busy || reasons.length === 1}
                      aria-label={`Remove "${r}"`}
                    >
                      Remove
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ol>
          <form onSubmit={add} className={styles.actions} style={{ alignItems: 'end' }}>
            <div className={styles.field} style={{ marginBottom: 0, flex: '1 1 260px' }}>
              <label className={styles.label} htmlFor={`${idPrefix}NewReason`}>New reason</label>
              <input
                id={`${idPrefix}NewReason`}
                className={styles.input}
                value={newReason}
                maxLength={REASON_MAX}
                onChange={(e) => setNewReason(e.target.value)}
                placeholder={placeholder}
                disabled={busy || reasons.length >= MAX_REASONS}
              />
            </div>
            <button className={`${styles.button} ${styles.buttonAccent}`} type="submit" disabled={busy || !newReason.trim() || reasons.length >= MAX_REASONS}>
              {busy ? 'Saving...' : 'Add reason'}
            </button>
          </form>
        </div>
      )}
    </>
  );
}
