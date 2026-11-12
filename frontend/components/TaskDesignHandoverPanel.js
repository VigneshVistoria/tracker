import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import Badge from './ui/Badge';
import styles from '../styles/issues.module.css';
import { apiFetch } from '../lib/api';
import { formatDateTime } from '../lib/formatDate';
import { DESIGN_ARTIFACT_TYPES } from '../lib/artifactTypes';

const TONE = { pending: 'warning', accepted: 'success', rejected: 'error', cancelled: 'neutral' };
const LABEL = { pending: 'Waiting for the developer', accepted: 'Accepted', rejected: 'Rejected', cancelled: 'Cancelled' };
const emptyLink = () => ({ type: '', url: '' });

function Links({ artifacts }) {
  if (!artifacts?.length) return null;
  return (
    <ul style={{ margin: 'var(--space-1) 0 0', paddingLeft: 'var(--space-5)' }}>
      {artifacts.map((a, i) => (
        <li key={i}>
          {a.type}:{' '}
          <a href={a.url} target="_blank" rel="noopener noreferrer">
            {a.url}
          </a>
        </li>
      ))}
    </ul>
  );
}

// "Hand over to development" (2026-11-12, Option A): on a Designer's task
// the designer (or a PM) hands the design to a Developer/DevOps person with
// notes and links; the developer links one of their tasks or creates one,
// and the design task moves to Pass. On the developer's linked task it
// shows the design that was handed over. Rules:
// backend/src/task-handovers/design-handovers.ts. Renders nothing on
// other tasks.
export default function TaskDesignHandoverPanel({ task, onChanged }) {
  const router = useRouter();
  const [state, setState] = useState(null);
  const [form, setForm] = useState(null);
  const [accepting, setAccepting] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    apiFetch(`/tasks/${task.id}/design-handover`)
      .then(setState)
      .catch(() => setState(null));
  }, [task.id]);
  useEffect(load, [load, task.status, task.assigneeUserId]);

  if (!state || (!state.isDesignTask && state.linkedFrom.length === 0)) return null;

  const typeOptions = [...DESIGN_ARTIFACT_TYPES, ...state.artifactTypes.filter((t) => !DESIGN_ARTIFACT_TYPES.includes(t))];

  const call = async (url, body, toast) => {
    setBusy(true);
    setError('');
    try {
      const next = await apiFetch(url, { method: 'POST', body: JSON.stringify(body || {}) });
      // The developer saw this task only through the pending handover.
      if (next && next.canViewTask === false) {
        window.location.assign('/dashboard');
        return;
      }
      setForm(null);
      setAccepting(null);
      setRejecting(null);
      setReason('');
      if (next?.linkedTaskId) {
        await onChanged(toast);
        router.push(`/tasks/${next.linkedTaskId}#design-handover`);
        return;
      }
      setState(next);
      await onChanged(toast);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const start = (e) => {
    e.preventDefault();
    const links = form.links.filter((l) => l.type || l.url.trim());
    if (!form.toUserId) return setError('Pick the developer.');
    if (form.notes.trim().length < state.fieldMin) return setError(`Write handover notes (at least ${state.fieldMin} characters).`);
    if (!links.length || links.some((l) => !l.type || !/^https?:\/\/\S+$/i.test(l.url.trim()))) {
      return setError('Add at least one link, each with a type and a full https:// URL.');
    }
    call(`/tasks/${task.id}/design-handover`, { toUserId: Number(form.toUserId), notes: form.notes, artifacts: links.map((l) => ({ type: l.type, url: l.url.trim() })) }, 'Handed over - waiting for the developer');
  };

  const accept = (e, h) => {
    e.preventDefault();
    if (accepting.mode === 'link') {
      if (!accepting.linkTaskId) return setError('Pick the task to link.');
      call(`/design-handovers/${h.id}/accept`, { linkTaskId: Number(accepting.linkTaskId) }, 'Design accepted and linked to your task');
    } else {
      if (!accepting.title.trim()) return setError('Give the new task a title.');
      call(`/design-handovers/${h.id}/accept`, { newTaskTitle: accepting.title.trim() }, 'Design accepted - new task created for you');
    }
  };

  const setLink = (i, key, value) => setForm({ ...form, links: form.links.map((l, j) => (j === i ? { ...l, [key]: value } : l)) });

  return (
    <div className={styles.card} style={{ marginBottom: 'var(--space-4)' }} id="design-handover" tabIndex={-1}>
      <h2 className={styles.cardTitle}>{state.isDesignTask ? 'Hand over to development' : 'Design handed over to you'}</h2>

      {state.linkedFrom.map((h) => (
        <div key={h.id} style={{ marginBottom: 'var(--space-3)' }}>
          <p style={{ margin: 0 }}>
            From <Link href={`/tasks/${h.taskId}`}>design task #{h.taskId}</Link> by {h.fromName}, accepted {formatDateTime(h.decidedAt)}
          </p>
          <p style={{ margin: 'var(--space-1) 0 0', whiteSpace: 'pre-wrap' }}>{h.notes}</p>
          <Links artifacts={h.artifacts} />
        </div>
      ))}

      {state.isDesignTask && state.handovers.length === 0 && !form && (
        <p className={styles.helpText} style={{ marginTop: 0 }}>
          When the design is ready, hand it to the developer who builds it. Once they accept, this task moves to Pass - no QA round needed.
        </p>
      )}

      {state.handovers.slice(0, 3).map((h) => (
        <div key={h.id} style={{ marginBottom: 'var(--space-3)' }}>
          <p style={{ margin: 0 }}>
            <Badge tone={TONE[h.status]}>{LABEL[h.status]}</Badge> {h.fromName} → {h.toName}, {formatDateTime(h.createdAt)}
            {h.decidedAt && ` · ${h.decidedByName}, ${formatDateTime(h.decidedAt)}`}
          </p>
          {h.linkedTaskId && (
            <p className={styles.helpText}>
              Being built in <Link href={`/tasks/${h.linkedTaskId}`}>task #{h.linkedTaskId}</Link>.
            </p>
          )}
          {h.rejectReason && <p className={styles.helpText}>Rejected: {h.rejectReason}</p>}
          {(h.status === 'pending' || h.status === 'accepted') && (
            <>
              <p style={{ margin: 'var(--space-1) 0 0', whiteSpace: 'pre-wrap' }}>{h.notes}</p>
              <Links artifacts={h.artifacts} />
            </>
          )}
          {(h.canDecide || h.canCancel) && !accepting && rejecting !== h.id && (
            <div className={styles.actions}>
              {h.canDecide && (
                <>
                  <button
                    className={`${styles.button} ${styles.buttonAccent}`}
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setError('');
                      setAccepting({ id: h.id, mode: state.linkableTasks.length ? 'link' : 'new', linkTaskId: '', title: `Build: ${task.title}`.slice(0, 150) });
                    }}
                  >
                    Accept
                  </button>
                  <button className={styles.buttonSecondary} type="button" disabled={busy} onClick={() => { setError(''); setRejecting(h.id); }}>
                    Reject
                  </button>
                </>
              )}
              {h.canCancel && (
                <button className={styles.buttonSecondary} type="button" disabled={busy} onClick={() => call(`/design-handovers/${h.id}/cancel`, {}, 'Handover cancelled')}>
                  Cancel handover
                </button>
              )}
            </div>
          )}
          {accepting?.id === h.id && (
            <form onSubmit={(e) => accept(e, h)}>
              <fieldset style={{ border: 0, padding: 0, margin: 'var(--space-2) 0' }}>
                <legend className={styles.label}>Where will you build it?</legend>
                <label style={{ display: 'block' }}>
                  <input type="radio" name={`dhMode${h.id}`} checked={accepting.mode === 'link'} disabled={!state.linkableTasks.length} onChange={() => setAccepting({ ...accepting, mode: 'link' })} /> One of my tasks
                  {!state.linkableTasks.length && ' (you have no open task in this project)'}
                </label>
                <label style={{ display: 'block' }}>
                  <input type="radio" name={`dhMode${h.id}`} checked={accepting.mode === 'new'} onChange={() => setAccepting({ ...accepting, mode: 'new' })} /> A new task for me
                </label>
              </fieldset>
              {accepting.mode === 'link' ? (
                <div className={styles.field}>
                  <label className={styles.label} htmlFor={`dhLink${h.id}`}>Your task</label>
                  <select id={`dhLink${h.id}`} className={styles.input} value={accepting.linkTaskId} onChange={(e) => setAccepting({ ...accepting, linkTaskId: e.target.value })}>
                    <option value="">Pick...</option>
                    {state.linkableTasks.map((t) => (
                      <option key={t.id} value={t.id}>
                        #{t.id} {t.title} ({t.status})
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className={styles.field}>
                  <label className={styles.label} htmlFor={`dhTitle${h.id}`}>New task title</label>
                  <input id={`dhTitle${h.id}`} className={styles.input} maxLength={150} value={accepting.title} onChange={(e) => setAccepting({ ...accepting, title: e.target.value })} />
                  <p className={styles.helpText}>Same project, module and phase as the design; the notes and links go into its description.</p>
                </div>
              )}
              <div className={styles.actions}>
                <button className={`${styles.button} ${styles.buttonAccent}`} type="submit" disabled={busy}>{busy ? 'Accepting...' : 'Accept design'}</button>
                <button className={styles.buttonSecondary} type="button" onClick={() => setAccepting(null)} disabled={busy}>Back</button>
              </div>
            </form>
          )}
          {rejecting === h.id && (
            <form onSubmit={(e) => { e.preventDefault(); call(`/design-handovers/${h.id}/reject`, { reason }, 'Handover rejected'); }}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor={`dhReason${h.id}`}>What is missing (at least {state.fieldMin} characters)</label>
                <textarea id={`dhReason${h.id}`} className={styles.textarea} rows={2} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} />
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
        <button className={`${styles.button} ${styles.buttonAccent}`} type="button" onClick={() => { setForm({ toUserId: '', notes: '', links: [{ type: 'Prototype', url: '' }] }); setError(''); }}>
          Hand over to development
        </button>
      )}
      {!state.canStart && state.startBlockedReason && state.handovers.every((h) => h.status !== 'pending' && h.status !== 'accepted') && (
        <p className={styles.helpText}>Hand over to development: {state.startBlockedReason}</p>
      )}
      {form && (
        <form onSubmit={start}>
          <div className={styles.fieldNarrow}>
            <label className={styles.label} htmlFor="dhTo">Developer</label>
            <select id="dhTo" className={styles.input} value={form.toUserId} onChange={(e) => setForm({ ...form, toUserId: e.target.value })}>
              <option value="">Pick...</option>
              {state.receivers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}{c.role === 'devops' ? ' (DevOps)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="dhNotes">Handover notes (required)</label>
            <textarea id="dhNotes" className={styles.textarea} rows={3} maxLength={4000} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="What is final, what to watch out for, open questions" />
          </div>
          <p className={styles.label} style={{ marginBottom: 'var(--space-1)' }}>Links (at least one)</p>
          {form.links.map((l, i) => (
            <div key={i} style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', marginBottom: 'var(--space-2)' }}>
              <select aria-label={`Link ${i + 1} type`} className={styles.input} style={{ maxWidth: 220 }} value={l.type} onChange={(e) => setLink(i, 'type', e.target.value)}>
                <option value="">Type...</option>
                {typeOptions.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <input aria-label={`Link ${i + 1} URL`} className={styles.input} style={{ flex: '1 1 240px' }} type="url" placeholder="https://..." value={l.url} onChange={(e) => setLink(i, 'url', e.target.value)} />
              {form.links.length > 1 && (
                <button className={styles.buttonSecondary} type="button" onClick={() => setForm({ ...form, links: form.links.filter((_, j) => j !== i) })}>
                  Remove
                </button>
              )}
            </div>
          ))}
          {form.links.length < 10 && (
            <button className={styles.buttonSecondary} type="button" onClick={() => setForm({ ...form, links: [...form.links, emptyLink()] })}>
              + Add link
            </button>
          )}
          <p className={styles.helpText}>Nothing changes until the developer accepts. Then this task moves to Pass and they build it in one of their tasks.</p>
          <div className={styles.actions}>
            <button className={`${styles.button} ${styles.buttonAccent}`} type="submit" disabled={busy}>{busy ? 'Sending...' : 'Send to developer'}</button>
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
