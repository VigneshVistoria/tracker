import { useCallback, useEffect, useState } from 'react';
import Badge from './ui/Badge';
import styles from '../styles/issues.module.css';
import { apiFetch } from '../lib/api';
import { formatDateTime } from '../lib/formatDate';

const FIELDS = [
  ['whatDone', 'What was done'],
  ['howToTest', 'How to test'],
  ['knownIssues', 'Known issues'],
  ['dependencies', 'Dependencies'],
  ['environment', 'Environment'],
];
const TONE = { pending: 'warning', accepted: 'success', rejected: 'error', cancelled: 'neutral' };
const LABEL = { pending: 'Waiting for the next owner', accepted: 'Accepted', rejected: 'Rejected', cancelled: 'Cancelled' };
const empty = () => ({ toUserId: '', ...Object.fromEntries(FIELDS.map(([k]) => [k, ''])) });

// Handover (Performance Tracking C4, 2026-10-30) on the task page. The
// assignee (or a PM/Admin) fills the template - every field mandatory -
// and picks the next owner, who accepts (the task moves to them) or
// rejects with a reason. Rules: backend/src/task-handovers/task-handovers.ts.
// Renders nothing while the project's tracking is off.
export default function TaskHandoverPanel({ task, onChanged }) {
  const [state, setState] = useState(null);
  const [form, setForm] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    apiFetch(`/tasks/${task.id}/handovers`)
      .then(setState)
      .catch(() => setState(null));
  }, [task.id]);
  useEffect(load, [load, task.status, task.assigneeUserId]);

  if (!state?.trackingOn) return null;

  const call = async (url, body, toast) => {
    setBusy(true);
    setError('');
    try {
      const next = await apiFetch(url, { method: 'POST', body: JSON.stringify(body || {}) });
      // The next owner could see this task only through the pending
      // handover - after rejecting it, that access has ended.
      if (next && next.canViewTask === false) {
        window.location.assign('/dashboard');
        return;
      }
      setState(next);
      setForm(null);
      setRejecting(null);
      setReason('');
      await onChanged(toast);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const start = (e) => {
    e.preventDefault();
    const short = FIELDS.filter(([k]) => form[k].trim().length < state.fieldMin);
    if (!form.toUserId || short.length) {
      setError(!form.toUserId ? 'Pick the next owner.' : `Fill in every field with at least ${state.fieldMin} characters (${short.map(([, l]) => l).join(', ')}).`);
      return;
    }
    call(`/tasks/${task.id}/handovers`, { ...form, toUserId: Number(form.toUserId) }, 'Handover sent');
  };

  const latest = state.handovers.slice(0, 3);

  return (
    <div className={styles.card} style={{ marginBottom: 'var(--space-4)' }} id="handover">
      <h2 className={styles.cardTitle}>Handover</h2>
      {latest.length === 0 && !form && <p style={{ margin: 0 }}>No handovers.</p>}
      {latest.map((h) => (
        <div key={h.id} style={{ marginBottom: 'var(--space-3)' }}>
          <p style={{ margin: 0 }}>
            <Badge tone={TONE[h.status]}>{LABEL[h.status]}</Badge> {h.fromName} → {h.toName}, {formatDateTime(h.createdAt)}
            {h.decidedAt && ` · ${h.decidedByName}, ${formatDateTime(h.decidedAt)}`}
          </p>
          {h.rejectReason && <p className={styles.helpText}>Rejected: {h.rejectReason}</p>}
          {(h.status === 'pending' || h.canDecide) && (
            <dl style={{ margin: 'var(--space-2) 0 0' }}>
              {FIELDS.map(([k, l]) => (
                <div key={k} style={{ marginBottom: 'var(--space-1)' }}>
                  <dt style={{ fontWeight: 600 }}>{l}</dt>
                  <dd style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{h[k]}</dd>
                </div>
              ))}
            </dl>
          )}
          {(h.canDecide || h.canCancel) && (
            <div className={styles.actions}>
              {h.canDecide && (
                <>
                  <button className={`${styles.button} ${styles.buttonAccent}`} type="button" disabled={busy} onClick={() => call(`/task-handovers/${h.id}/accept`, {}, 'Handover accepted - the task is yours')}>
                    Accept
                  </button>
                  <button className={styles.buttonSecondary} type="button" disabled={busy} onClick={() => setRejecting(h.id)}>
                    Reject
                  </button>
                </>
              )}
              {h.canCancel && (
                <button className={styles.buttonSecondary} type="button" disabled={busy} onClick={() => call(`/task-handovers/${h.id}/cancel`, {}, 'Handover cancelled')}>
                  Cancel handover
                </button>
              )}
            </div>
          )}
          {rejecting === h.id && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                call(`/task-handovers/${h.id}/reject`, { reason }, 'Handover rejected');
              }}
            >
              <div className={styles.field}>
                <label className={styles.label} htmlFor={`hoReason${h.id}`}>What is missing (at least {state.fieldMin} characters)</label>
                <textarea id={`hoReason${h.id}`} className={styles.textarea} rows={2} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} />
              </div>
              <div className={styles.actions}>
                <button className={`${styles.button} ${styles.buttonAccent}`} type="submit" disabled={busy}>Reject handover</button>
                <button className={styles.buttonSecondary} type="button" onClick={() => setRejecting(null)} disabled={busy}>Back</button>
              </div>
            </form>
          )}
        </div>
      ))}

      {state.canStart && !form && (
        <button className={styles.buttonSecondary} type="button" onClick={() => { setForm(empty()); setError(''); }}>
          Hand over this task
        </button>
      )}
      {form && (
        <form onSubmit={start}>
          <div className={styles.fieldNarrow}>
            <label className={styles.label} htmlFor="hoTo">Next owner</label>
            <select id="hoTo" className={styles.input} value={form.toUserId} onChange={(e) => setForm({ ...form, toUserId: e.target.value })}>
              <option value="">Pick...</option>
              {state.candidates.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          {FIELDS.map(([k, l]) => (
            <div key={k} className={styles.field}>
              <label className={styles.label} htmlFor={`ho${k}`}>{l} (required)</label>
              <textarea id={`ho${k}`} className={styles.textarea} rows={2} maxLength={4000} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
            </div>
          ))}
          <p className={styles.helpText}>The task moves only when the next owner accepts. Write &quot;None known&quot; where there is nothing.</p>
          <div className={styles.actions}>
            <button className={`${styles.button} ${styles.buttonAccent}`} type="submit" disabled={busy}>{busy ? 'Sending...' : 'Send handover'}</button>
            <button className={styles.buttonSecondary} type="button" onClick={() => setForm(null)} disabled={busy}>Cancel</button>
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
