import { useCallback, useEffect, useRef, useState } from 'react';
import Modal from './ui/Modal';
import Button from './ui/Button';
import styles from '../styles/issues.module.css';
import { apiFetch } from '../lib/api';
import { formatDateTime } from '../lib/formatDate';
import ReasonHint from './ReasonHint';

// Mirrors backend/src/task-activity/task-activity.ts.
const TEXT_MAX = 2000;

// Performance Tracking B1 (2026-10-30) on the task page: the assignee's
// progress notes (C5) and the Chase button (O3). All of it comes from
// GET /tasks/:id/activity, so the rules live on the backend. Renders
// nothing while the project's Performance Tracking is off.
export default function TaskActivityPanel({ task, onChanged }) {
  const [state, setState] = useState(null);
  const [dialog, setDialog] = useState(null);

  const load = useCallback(() => {
    apiFetch(`/tasks/${task.id}/activity`)
      .then(setState)
      .catch(() => setState(null));
  }, [task.id]);
  useEffect(load, [load, task.status, task.assigneeUserId]);

  if (!state?.trackingOn) return null;
  const done = async (message) => {
    setDialog(null);
    await onChanged(message);
    load();
  };
  const lastNote = state.notes[0];

  return (
    <div className={styles.card} style={{ marginBottom: 'var(--space-4)' }} id="activity">
      <h2 className={styles.cardTitle}>Progress &amp; chases</h2>

      {lastNote ? (
        <div style={{ marginBottom: 'var(--ds-space-3)' }}>
          <p className={styles.issueMeta} style={{ margin: 0 }}>
            Latest progress note by {lastNote.authorName || 'the assignee'} on {formatDateTime(lastNote.createdAt)}
          </p>
          <p style={{ whiteSpace: 'pre-wrap', margin: 'var(--ds-space-1) 0 0' }}>{lastNote.body}</p>
        </div>
      ) : (
        <p className={styles.helpText} style={{ marginTop: 0 }}>
          No progress note yet. The assignee can post a short update so nobody has to chase for one.
        </p>
      )}

      {state.chases.length > 0 && (
        <p className={styles.issueMeta} style={{ marginTop: 0 }}>
          Chased {state.chases.length} {state.chases.length === 1 ? 'time' : 'times'}, last by {state.chases[0].chasedByName || 'someone'} on{' '}
          {formatDateTime(state.chases[0].createdAt)}.
        </p>
      )}

      {(state.canAddNote || state.canChase) && (
        <div className={styles.actions}>
          {state.canAddNote && (
            <Button variant="secondary" onClick={() => setDialog('note')}>
              Add progress note
            </Button>
          )}
          {state.canChase && (
            <Button variant="secondary" onClick={() => setDialog('chase')}>
              Chase for an update
            </Button>
          )}
        </div>
      )}
      {!state.canChase && !state.canAddNote && state.chaseBlockedReason && (
        <p className={styles.issueMeta} style={{ marginBottom: 0 }}>{state.chaseBlockedReason}</p>
      )}

      {(state.notes.length > 1 || state.chases.length > 0) && (
        <details style={{ marginTop: 'var(--ds-space-3)' }}>
          <summary className={styles.issueMeta}>
            History ({state.notes.length} {state.notes.length === 1 ? 'note' : 'notes'}, {state.chases.length}{' '}
            {state.chases.length === 1 ? 'chase' : 'chases'})
          </summary>
          <ul style={{ margin: 'var(--ds-space-2) 0 0', paddingLeft: 'var(--ds-space-5)' }}>
            {[
              ...state.notes.map((n) => ({ key: `n${n.id}`, at: n.createdAt, text: `Progress note by ${n.authorName || 'the assignee'}: "${n.body}"` })),
              ...state.chases.map((c) => ({
                key: `c${c.id}`,
                at: c.createdAt,
                text: `Chased by ${c.chasedByName || 'someone'} (assignee ${c.assigneeName || 'unknown'}, status ${c.taskStatus})${c.note ? `: "${c.note}"` : ''}`,
              })),
            ]
              .sort((a, b) => new Date(b.at) - new Date(a.at))
              .map((row) => (
                <li key={row.key} className={styles.issueMeta} style={{ whiteSpace: 'pre-wrap' }}>
                  {formatDateTime(row.at)} - {row.text}
                </li>
              ))}
          </ul>
        </details>
      )}

      {dialog && (
        <ActivityDialog
          kind={dialog}
          task={task}
          noteMin={state.progressNoteMin}
          cooldownHours={state.chaseCooldownHours}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      )}
    </div>
  );
}

function ActivityDialog({ kind, task, noteMin, cooldownHours, onClose, onDone }) {
  const isNote = kind === 'note';
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [attempted, setAttempted] = useState(false);
  const textRef = useRef(null);

  const trimmed = text.trim();
  const valid = isNote ? trimmed.length >= noteMin && trimmed.length <= TEXT_MAX : trimmed.length <= TEXT_MAX;

  const handleConfirm = async () => {
    if (busy) return;
    if (!valid) {
      setAttempted(true);
      textRef.current?.focus();
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (isNote) {
        await apiFetch(`/tasks/${task.id}/activity/notes`, { method: 'POST', body: JSON.stringify({ body: trimmed }) });
        await onDone('Progress note added');
      } else {
        await apiFetch(`/tasks/${task.id}/activity/chase`, { method: 'POST', body: JSON.stringify({ note: trimmed || undefined }) });
        await onDone('Chase sent - the assignee has been told');
      }
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={busy ? () => {} : onClose}
      title={isNote ? `Progress note on #${task.id}` : `Chase #${task.id} for an update`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} aria-disabled={!valid} loading={busy}>
            {isNote ? 'Add note' : 'Send chase'}
          </Button>
        </>
      }
    >
      <p className={styles.issueMeta} style={{ marginTop: 0 }}>
        {isNote
          ? 'What has moved since the last update, and what is next? Everyone who can see the task can read it.'
          : `The assignee gets an in-app notification asking for an update. You can chase this task once every ${cooldownHours} hours. Chases are recorded.`}
      </p>
      <label className={styles.label} htmlFor="activityText">
        {isNote ? 'Note (required)' : 'Message (optional)'}
      </label>
      <textarea
        id="activityText"
        ref={textRef}
        className={styles.textarea}
        rows={isNote ? 4 : 3}
        maxLength={TEXT_MAX}
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-required={isNote}
        aria-invalid={(text.length > 0 || attempted) && !valid}
        aria-describedby="activityTextHint"
        placeholder={isNote ? 'e.g. Payment screen done, wiring the refund call next' : 'e.g. The client demo is on Monday'}
      />
      <ReasonHint id="activityTextHint" length={trimmed.length} min={isNote ? noteMin : 0} max={TEXT_MAX} attempted={attempted} />
      {error && (
        <div className={styles.error} role="alert" style={{ marginTop: 'var(--ds-space-3)', marginBottom: 0 }}>
          {error}
        </div>
      )}
    </Modal>
  );
}
