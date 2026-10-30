import { useCallback, useEffect, useState } from 'react';
import Badge from './ui/Badge';
import styles from '../styles/issues.module.css';
import { apiFetch } from '../lib/api';
import { formatDateTime } from '../lib/formatDate';

// Performance Tracking L3/L4 (2026-10-30) on a task's page: the client
// priority tier with its change history (L3 priority inversions judge each
// submission by the tier at that moment) and the UAT rounds (L4 UAT
// first-pass acceptance). The Program Manager edits; everyone who can see
// the task sees it. Rules: backend/src/client-measures/client-measures.ts.
// Renders nothing while the project's tracking is off.
export default function ClientMeasuresCard({ task, onChanged }) {
  const [state, setState] = useState(null);
  const [uat, setUat] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    apiFetch(`/tasks/${task.id}/client-measures`)
      .then(setState)
      .catch(() => setState(null));
  }, [task.id]);
  useEffect(load, [load, task.status]);

  if (!state?.trackingOn) return null;

  const send = async (method, url, body, toast) => {
    setBusy(true);
    setError('');
    try {
      setState(await apiFetch(url, { method, body: JSON.stringify(body) }));
      setUat(null);
      setNote('');
      await onChanged(toast);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const recordUat = (e) => {
    e.preventDefault();
    send('POST', `/tasks/${task.id}/uat-results`, { result: uat, note: note.trim() || null }, uat === 'passed' ? 'UAT passed recorded' : 'UAT failure recorded');
  };

  return (
    <div className={styles.card} style={{ marginBottom: 'var(--space-4)' }} id="client-measures">
      <h2 className={styles.cardTitle}>Client priority and UAT</h2>
      <div className={styles.fieldNarrow}>
        <label className={styles.label} htmlFor="cmTier">Client priority tier</label>
        {state.canEdit ? (
          <select
            id="cmTier"
            className={styles.input}
            value={state.tier ?? ''}
            disabled={busy}
            onChange={(e) => send('PATCH', `/tasks/${task.id}/client-priority-tier`, { tier: e.target.value ? Number(e.target.value) : null }, 'Client priority tier saved')}
          >
            <option value="">Not set</option>
            {state.tiers.map((t, i) => (
              <option key={t} value={i + 1}>{t}</option>
            ))}
          </select>
        ) : (
          <p id="cmTier" style={{ margin: 0 }}>{state.tierLabel ?? 'Not set'}</p>
        )}
      </div>

      {state.tierHistory.length > 0 && (
        <details style={{ marginTop: 'var(--space-2)' }}>
          <summary className={styles.helpText}>Tier history ({state.tierHistory.length}) - each submission is judged by the tier at that moment</summary>
          <ul style={{ margin: 0, paddingLeft: 'var(--space-4)' }}>
            {state.tierHistory.map((h) => (
              <li key={h.id} className={styles.issueMeta}>
                {h.previousLabel} → {h.tierLabel}, {h.changedByName}, {formatDateTime(h.changedAt)}
              </li>
            ))}
          </ul>
        </details>
      )}

      <h3 className={styles.label} style={{ marginTop: 'var(--space-3)' }}>UAT results</h3>
      {state.uatResults.length === 0 ? (
        <p style={{ margin: 0 }}>No UAT recorded.</p>
      ) : (
        <ul style={{ margin: 0, paddingLeft: 'var(--space-4)' }}>
          {state.uatResults.map((r) => (
            <li key={r.id}>
              Round {r.round}: <Badge tone={r.result === 'passed' ? 'success' : 'error'}>{r.result === 'passed' ? 'Passed' : 'Failed'}</Badge>{' '}
              <span className={styles.issueMeta}>
                {r.recordedByName}, {formatDateTime(r.recordedAt)}
              </span>
              {r.note && <div style={{ whiteSpace: 'pre-wrap' }}>{r.note}</div>}
            </li>
          ))}
        </ul>
      )}
      {state.canEdit && !uat && (
        <div className={styles.actions}>
          <button className={styles.buttonSecondary} type="button" onClick={() => setUat('passed')} disabled={busy}>
            UAT passed
          </button>
          <button className={styles.buttonSecondary} type="button" onClick={() => setUat('failed')} disabled={busy}>
            UAT failed
          </button>
        </div>
      )}
      {uat && (
        <form onSubmit={recordUat}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="cmUatNote">
              {uat === 'failed' ? 'What failed (at least 10 characters)' : 'Note (optional)'}
            </label>
            <textarea id="cmUatNote" className={styles.textarea} rows={2} maxLength={4000} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className={styles.actions}>
            <button className={`${styles.button} ${styles.buttonAccent}`} type="submit" disabled={busy}>
              {busy ? 'Saving...' : `Record UAT round ${state.uatResults.length + 1}: ${uat}`}
            </button>
            <button className={styles.buttonSecondary} type="button" onClick={() => setUat(null)} disabled={busy}>
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
