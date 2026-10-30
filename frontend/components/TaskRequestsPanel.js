import { useCallback, useEffect, useRef, useState } from 'react';
import Modal from './ui/Modal';
import Button from './ui/Button';
import Badge from './ui/Badge';
import SearchSelectField from './SearchSelectField';
import ReasonHint from './ReasonHint';
import styles from '../styles/issues.module.css';
import { apiFetch } from '../lib/api';
import { formatDateTime } from '../lib/formatDate';

// Mirrors backend/src/task-requests/task-requests.ts.
const TEXT_MAX = 2000;

// Performance Tracking B4 (2026-10-30) on the task page: requests to a
// named person (C1 response time), and answering a dependency ticket you
// own without resolving it. All from GET /tasks/:id/requests; renders
// nothing while the project's Performance Tracking is off.
export default function TaskRequestsPanel({ task, onChanged }) {
  const [state, setState] = useState(null);
  const [dialog, setDialog] = useState(null);

  const load = useCallback(() => {
    apiFetch(`/tasks/${task.id}/requests`)
      .then(setState)
      .catch(() => setState(null));
  }, [task.id]);
  useEffect(load, [load, task.status]);

  if (!state?.trackingOn) return null;
  const done = async (next, message) => {
    setDialog(null);
    setState(next);
    await onChanged(message);
  };
  const requests = state.requests.filter((r) => r.source === 'request');
  const waiting = requests.filter((r) => !r.respondedAt);

  return (
    <div className={styles.card} style={{ marginBottom: 'var(--space-4)' }} id="requests">
      <h2 className={styles.cardTitle}>Requests</h2>
      {requests.length === 0 && state.dependenciesToAnswer.length === 0 && (
        <p className={styles.helpText} style={{ marginTop: 0 }}>Need something from someone for this task? Ask them here - they are told, and their answer is kept with the task.</p>
      )}

      {state.dependenciesToAnswer.map((d) => (
        <div key={`d${d.id}`} style={{ marginBottom: 'var(--ds-space-3)' }}>
          <p style={{ margin: 0 }}>
            <Badge tone="warning">Waiting on you</Badge> Dependency #{d.id} &quot;{d.title}&quot;, filed {formatDateTime(d.createdAt)}.
          </p>
          <Button variant="secondary" style={{ marginTop: 'var(--ds-space-2)' }} onClick={() => setDialog({ type: 'dependency', item: d })}>
            Answer
          </Button>
        </div>
      ))}

      {requests.map((r) => (
        <div key={r.id} style={{ marginBottom: 'var(--ds-space-3)' }}>
          <p style={{ margin: 0 }}>
            {r.respondedAt ? <Badge tone="success">Answered</Badge> : <Badge tone="warning">Waiting</Badge>} {r.requestedByName || 'Someone'} asked{' '}
            <strong>{r.requestedOfName || 'someone'}</strong> on {formatDateTime(r.requestedAt)}:
          </p>
          <p style={{ whiteSpace: 'pre-wrap', margin: 'var(--ds-space-1) 0 0' }}>{r.body}</p>
          {r.respondedAt && (
            <p className={styles.issueMeta} style={{ whiteSpace: 'pre-wrap', margin: 'var(--ds-space-1) 0 0' }}>
              Answer ({formatDateTime(r.respondedAt)}): {r.responseBody}
            </p>
          )}
          {r.canAnswer && (
            <Button variant="secondary" style={{ marginTop: 'var(--ds-space-2)' }} onClick={() => setDialog({ type: 'answer', item: r })}>
              Answer
            </Button>
          )}
        </div>
      ))}

      {state.canAsk && (
        <div className={styles.actions}>
          <Button variant="secondary" onClick={() => setDialog({ type: 'ask' })}>
            Ask someone
          </Button>
          {waiting.length > 0 && <span className={styles.issueMeta}>{waiting.length} waiting for an answer</span>}
        </div>
      )}

      {dialog && <RequestDialog dialog={dialog} task={task} state={state} onClose={() => setDialog(null)} onDone={done} />}
    </div>
  );
}

function RequestDialog({ dialog, task, state, onClose, onDone }) {
  const isAsk = dialog.type === 'ask';
  const min = isAsk ? state.textMin : state.responseMin;
  const [text, setText] = useState('');
  const [person, setPerson] = useState(null);
  const [people, setPeople] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [attempted, setAttempted] = useState(false);
  const textRef = useRef(null);

  useEffect(() => {
    if (!isAsk) return;
    const me = JSON.parse(localStorage.getItem('user') || '{}').id;
    apiFetch('/users/assignable')
      .then((rows) => setPeople(rows.filter((u) => u.id !== me && u.role !== 'client').map((u) => ({ id: u.id, name: u.fullName || u.email }))))
      .catch(() => {});
  }, [isAsk]);

  const trimmed = text.trim();
  const valid = trimmed.length >= min && trimmed.length <= TEXT_MAX && (!isAsk || !!person);

  const confirm = async () => {
    if (busy) return;
    if (!valid) {
      setAttempted(true);
      if (trimmed.length < min) textRef.current?.focus();
      return;
    }
    setBusy(true);
    setError('');
    try {
      let next;
      if (isAsk) next = await apiFetch(`/tasks/${task.id}/requests`, { method: 'POST', body: JSON.stringify({ requestedOfUserId: person.id, body: trimmed }) });
      else if (dialog.type === 'answer') next = await apiFetch(`/task-requests/${dialog.item.id}/answer`, { method: 'POST', body: JSON.stringify({ body: trimmed }) });
      else next = await apiFetch(`/task-requests/dependency/${dialog.item.id}/answer`, { method: 'POST', body: JSON.stringify({ body: trimmed }) });
      await onDone(next, isAsk ? `Request sent to ${person.name}` : 'Answer sent');
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const title = isAsk ? `Ask someone about #${task.id}` : dialog.type === 'answer' ? 'Answer the request' : `Answer dependency #${dialog.item.id}`;
  return (
    <Modal
      open
      onClose={busy ? () => {} : onClose}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={confirm} aria-disabled={!valid} loading={busy}>
            {isAsk ? 'Send request' : 'Send answer'}
          </Button>
        </>
      }
    >
      {isAsk ? (
        <>
          <SearchSelectField label="Who?" id="requestPerson" required value={person} onChange={setPerson} options={people} />
          {attempted && !person && (
            <p className={styles.error} role="alert" style={{ marginTop: 'var(--ds-space-1)' }}>
              Pick who you are asking.
            </p>
          )}
        </>
      ) : (
        <p className={styles.issueMeta} style={{ marginTop: 0, whiteSpace: 'pre-wrap' }}>
          {dialog.type === 'answer' ? dialog.item.body : `"${dialog.item.title}" - answering does not resolve it.`}
        </p>
      )}
      <label className={styles.label} htmlFor="requestText" style={{ marginTop: 'var(--ds-space-3)' }}>
        {isAsk ? 'What do you need? (required)' : 'Your answer (required)'}
      </label>
      <textarea
        id="requestText"
        ref={textRef}
        className={styles.textarea}
        rows={3}
        maxLength={TEXT_MAX}
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-required="true"
        aria-invalid={(text.length > 0 || attempted) && trimmed.length < min}
        aria-describedby="requestTextHint"
        placeholder={isAsk ? 'e.g. Can you share the payment sandbox API keys?' : 'e.g. Sent them by email, check your inbox'}
      />
      <ReasonHint id="requestTextHint" length={trimmed.length} min={min} max={TEXT_MAX} attempted={attempted} />
      {error && (
        <div className={styles.error} role="alert" style={{ marginTop: 'var(--ds-space-3)', marginBottom: 0 }}>
          {error}
        </div>
      )}
    </Modal>
  );
}
