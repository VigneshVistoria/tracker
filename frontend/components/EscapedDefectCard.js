import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import Badge from './ui/Badge';
import styles from '../styles/issues.module.css';
import { apiFetch } from '../lib/api';
import { formatDate } from '../lib/formatDate';

// Performance Tracking Q4 (2026-10-30) on a defect's page: "Found in
// production", the released task it escaped from and that release's date.
// QA, Program Manager and Admin edit it; everyone who can see the defect
// sees it. Left empty, the release date comes from the source task's
// Release Log entry. Rules: backend/src/tasks/escaped-defect.ts. Renders
// nothing while the project's tracking is off.
export default function EscapedDefectCard({ task, onChanged }) {
  const [state, setState] = useState(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ escapedFromTaskId: '', productionReleaseDate: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    apiFetch(`/tasks/${task.id}/escaped-defect`)
      .then(setState)
      .catch(() => setState(null));
  }, [task.id]);
  useEffect(load, [load, task.status]);

  if (!state?.trackingOn) return null;

  const startEdit = () => {
    setDraft({
      escapedFromTaskId: state.escapedFromTaskId ? String(state.escapedFromTaskId) : '',
      productionReleaseDate: state.productionReleaseDate || '',
    });
    setError('');
    setEditing(true);
  };

  const send = async (body, toast) => {
    setBusy(true);
    setError('');
    try {
      const next = await apiFetch(`/tasks/${task.id}/escaped-defect`, { method: 'PATCH', body: JSON.stringify(body) });
      setState(next);
      setEditing(false);
      await onChanged(toast);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const save = (e) => {
    e.preventDefault();
    const source = draft.escapedFromTaskId.replace('#', '').trim();
    if (source && !/^\d+$/.test(source)) {
      setError('Source task must be a task number, e.g. 253.');
      return;
    }
    send(
      { foundInProduction: true, escapedFromTaskId: source ? Number(source) : null, productionReleaseDate: draft.productionReleaseDate || null },
      'Marked as found in production',
    );
  };

  return (
    <div className={styles.card} style={{ marginBottom: 'var(--space-4)' }} id="escaped-defect">
      <h2 className={styles.cardTitle}>Found in production</h2>
      {!editing ? (
        <>
          {state.foundInProduction ? (
            <p style={{ margin: 0 }}>
              <Badge tone="error">Found in production</Badge>{' '}
              {state.escapedFromTaskId ? (
                <>
                  escaped from <Link href={`/tasks/${state.escapedFromTaskId}`}>#{state.escapedFromTaskId}</Link>
                  {state.escapedFromTaskTitle ? ` ${state.escapedFromTaskTitle}` : ''},
                </>
              ) : (
                'no source task (charged to nobody),'
              )}{' '}
              released {formatDate(state.productionReleaseDate)}
              {state.markedByName && `. Marked by ${state.markedByName} on ${formatDate(state.markedAt)}`}
            </p>
          ) : (
            <p style={{ margin: 0 }}>Not marked as found in production.</p>
          )}
          {state.canEdit && (
            <div className={styles.actions}>
              <button className={styles.buttonSecondary} type="button" onClick={startEdit} disabled={busy}>
                {state.foundInProduction ? 'Edit' : 'Mark as found in production'}
              </button>
              {state.foundInProduction && (
                <button className={styles.buttonSecondary} type="button" onClick={() => send({ foundInProduction: false }, 'Production mark removed')} disabled={busy}>
                  Remove mark
                </button>
              )}
            </div>
          )}
        </>
      ) : (
        <form onSubmit={save}>
          <div className={styles.fieldNarrow}>
            <label className={styles.label} htmlFor="edSource">Escaped from task # (optional)</label>
            <input
              id="edSource"
              className={styles.input}
              inputMode="numeric"
              maxLength={10}
              value={draft.escapedFromTaskId}
              onChange={(e) => setDraft({ ...draft, escapedFromTaskId: e.target.value })}
            />
          </div>
          <div className={styles.fieldNarrow}>
            <label className={styles.label} htmlFor="edReleaseDate">Release date</label>
            <input
              id="edReleaseDate"
              type="date"
              className={styles.input}
              value={draft.productionReleaseDate}
              onChange={(e) => setDraft({ ...draft, productionReleaseDate: e.target.value })}
            />
            <p className={styles.helpText}>Leave empty to take it from the source task&apos;s Release Log entry.</p>
          </div>
          <div className={styles.actions}>
            <button className={`${styles.button} ${styles.buttonAccent}`} type="submit" disabled={busy}>
              {busy ? 'Saving...' : 'Save'}
            </button>
            <button className={styles.buttonSecondary} type="button" onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {error && (
        <div className={styles.error} role="alert" style={{ marginTop: 'var(--space-2)' }}>
          {error}
        </div>
      )}
    </div>
  );
}
