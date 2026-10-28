import { useCallback, useEffect, useRef, useState } from 'react';
import Modal from './ui/Modal';
import Button from './ui/Button';
import Badge from './ui/Badge';
import SearchSelectField from './SearchSelectField';
import styles from '../styles/issues.module.css';
import { apiFetch } from '../lib/api';
import { formatDate, formatDateTime } from '../lib/formatDate';
import ReasonHint from './ReasonHint';

// Mirrors backend/src/task-flags/task-flags.ts.
const TEXT_MAX = 1000;
const EXTERNAL_MAX = 200;

const KIND_LABEL = { risk: 'At risk', blocker: 'Blocked' };

function clearText(f) {
  if (!f.clearedAt) return '';
  if (f.clearReason && f.clearReason.startsWith('status:')) return `cleared when the task moved to ${f.clearReason.slice(7)}`;
  return `cleared by ${f.clearedByName || 'someone'}${f.clearNote ? `: "${f.clearNote}"` : ''}`;
}

// Performance Tracking S3 (2026-10-28) on the task page: the open risk and
// blocker flags, setting and clearing them, and their history. All of it
// comes from GET /task-flags?taskId=, so the rules live on the backend.
// Renders nothing while the project's Performance Tracking is off.
// `tickets` = this task's dependency tickets (a blocker may link an open one).
export default function TaskFlagsPanel({ task, tickets, onChanged }) {
  const [state, setState] = useState(null);
  const [dialog, setDialog] = useState(null);

  const load = useCallback(() => {
    apiFetch(`/task-flags?taskId=${task.id}`)
      .then(setState)
      .catch(() => setState(null));
  }, [task.id]);
  useEffect(load, [load, task.status, task.assigneeUserId]);

  if (!state?.trackingOn) return null;
  const open = [state.risk, state.blocker].filter(Boolean);
  const done = async (message) => {
    setDialog(null);
    await onChanged(message);
    load();
  };

  return (
    <div
      className={styles.card}
      style={{ marginBottom: 'var(--space-4)', ...(open.length ? { borderLeft: '4px solid var(--ds-color-warning)' } : {}) }}
      id="flags"
    >
      <h2 className={styles.cardTitle}>Risk &amp; blockers</h2>

      {open.length === 0 && (
        <p className={styles.helpText} style={{ marginTop: 0 }}>
          Nothing flagged. Raise a risk as soon as the Due date looks unlikely, or a blocker when you are waiting on someone.
        </p>
      )}
      {open.map((f) => (
        <div key={f.id} style={{ marginBottom: 'var(--ds-space-3)' }}>
          <p style={{ margin: 0 }}>
            <Badge tone={f.kind === 'blocker' ? 'error' : 'warning'}>{KIND_LABEL[f.kind]}</Badge>{' '}
            {f.kind === 'blocker' && (
              <>
                waiting on <strong>{f.blockingOwnerName}</strong>
                {f.external && ' (external)'}
                {f.dependencyTicketId && ` - dependency #${f.dependencyTicketId}`}.{' '}
              </>
            )}
            Raised by {f.setByName || 'someone'} on {formatDateTime(f.setAt)}
            {!f.setByAssignee && ' (not the assignee)'}
            {f.likelyDueDate && <> - likely new date {formatDate(f.likelyDueDate)} (information only)</>}.
          </p>
          <p style={{ whiteSpace: 'pre-wrap', margin: 'var(--ds-space-1) 0 0' }}>{f.reason}</p>
          {f.canClear && (
            <Button variant="secondary" style={{ marginTop: 'var(--ds-space-2)' }} onClick={() => setDialog({ type: 'clear', flag: f })}>
              Clear {f.kind === 'blocker' ? 'blocker' : 'risk'}
            </Button>
          )}
        </div>
      ))}

      {(state.canSetRisk || state.canSetBlocker) && (
        <div className={styles.actions}>
          {state.canSetRisk && (
            <Button variant="secondary" onClick={() => setDialog({ type: 'risk' })}>
              Flag at risk
            </Button>
          )}
          {state.canSetBlocker && (
            <Button variant="secondary" onClick={() => setDialog({ type: 'blocker' })}>
              Flag blocked
            </Button>
          )}
        </div>
      )}

      {state.history.length > 0 && (
        <details style={{ marginTop: 'var(--ds-space-3)' }}>
          <summary className={styles.issueMeta}>Flag history ({state.history.length})</summary>
          <ul style={{ margin: 'var(--ds-space-2) 0 0', paddingLeft: 'var(--ds-space-5)' }}>
            {state.history.map((f) => (
              <li key={f.id} className={styles.issueMeta}>
                {formatDateTime(f.setAt)} - {KIND_LABEL[f.kind]} by {f.setByName || 'someone'}
                {f.kind === 'blocker' && `, waiting on ${f.blockingOwnerName}${f.external ? ' (external)' : ''}`}: "{f.reason}"
                {f.clearedAt ? ` - ${clearText(f)} on ${formatDateTime(f.clearedAt)}` : ' - open'}
              </li>
            ))}
          </ul>
        </details>
      )}

      {dialog && (
        <FlagDialog
          dialog={dialog}
          task={task}
          tickets={(tickets || []).filter((t) => t.status === 'open')}
          reasonMin={state.reasonMin}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      )}
    </div>
  );
}

function FlagDialog({ dialog, task, tickets, reasonMin, onClose, onDone }) {
  const isClear = dialog.type === 'clear';
  const isBlocker = dialog.type === 'blocker';
  const [reason, setReason] = useState('');
  const [likelyDueDate, setLikelyDueDate] = useState('');
  const [ownerType, setOwnerType] = useState('person');
  const [person, setPerson] = useState(null);
  const [externalName, setExternalName] = useState('');
  const [ticketId, setTicketId] = useState('');
  const [people, setPeople] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [attempted, setAttempted] = useState(false);
  const reasonRef = useRef(null);

  useEffect(() => {
    if (!isBlocker) return;
    apiFetch('/users/assignable')
      .then((rows) => setPeople(rows.filter((u) => u.id !== task.assigneeUserId).map((u) => ({ id: u.id, name: u.fullName || u.email }))))
      .catch(() => {});
  }, [isBlocker, task.assigneeUserId]);

  const trimmed = reason.trim();
  const reasonValid = isClear ? trimmed.length <= TEXT_MAX : trimmed.length >= reasonMin && trimmed.length <= TEXT_MAX;
  const ownerValid = !isBlocker || (ownerType === 'person' ? !!person : externalName.trim().length > 0);
  const valid = reasonValid && ownerValid;

  const linkTicket = (id) => {
    setTicketId(id);
    const t = tickets.find((x) => String(x.id) === String(id));
    // Prefill the owner from the ticket - still editable.
    if (t && ownerType === 'person' && !person) {
      const match = people.find((p) => p.id === t.ownerUserId);
      if (match) setPerson(match);
    }
  };

  const handleConfirm = async () => {
    if (busy) return;
    if (!valid) {
      setAttempted(true);
      if (!reasonValid) reasonRef.current?.focus();
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (isClear) {
        await apiFetch(`/task-flags/${dialog.flag.id}/clear`, { method: 'PATCH', body: JSON.stringify({ note: trimmed || undefined }) });
        await onDone(`${dialog.flag.kind === 'blocker' ? 'Blocker' : 'Risk'} cleared`);
        return;
      }
      const body = { taskId: task.id, kind: dialog.type, reason: trimmed };
      if (dialog.type === 'risk' && likelyDueDate) body.likelyDueDate = likelyDueDate;
      if (isBlocker) {
        if (ownerType === 'person') body.blockingOwnerUserId = person.id;
        else body.blockingOwnerExternal = externalName.trim();
        if (ticketId) body.dependencyTicketId = Number(ticketId);
      }
      await apiFetch('/task-flags', { method: 'POST', body: JSON.stringify(body) });
      await onDone(isBlocker ? 'Flagged as blocked - the PMs have been told' : 'Flagged at risk - the PMs have been told');
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const title = isClear
    ? `Clear the ${dialog.flag.kind === 'blocker' ? 'blocker' : 'risk'} on #${task.id}`
    : isBlocker
      ? `Flag #${task.id} as blocked`
      : `Flag #${task.id} at risk`;

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
          <Button onClick={handleConfirm} aria-disabled={!valid} loading={busy}>
            {isClear ? 'Clear flag' : 'Raise flag'}
          </Button>
        </>
      }
    >
      <p className={styles.issueMeta} style={{ marginTop: 0 }}>
        {isClear
          ? 'The flag stays in the history with when and by whom it was cleared.'
          : isBlocker
            ? 'Who or what is this task waiting on? The PMs are told, and so is the person if they are in the tracker.'
            : 'The date it was raised is recorded. The PMs are told. This does not change the Due date - ask for that in the Due date card.'}
      </p>

      {isBlocker && (
        <fieldset style={{ border: 0, padding: 0, margin: '0 0 var(--ds-space-3)' }}>
          <legend className={styles.label}>Waiting on</legend>
          <label style={{ marginRight: 'var(--ds-space-4)' }}>
            <input type="radio" name="flagOwnerType" checked={ownerType === 'person'} onChange={() => setOwnerType('person')} /> A person in the tracker
          </label>
          <label>
            <input type="radio" name="flagOwnerType" checked={ownerType === 'external'} onChange={() => setOwnerType('external')} /> An outside party (external)
          </label>
          <div style={{ marginTop: 'var(--ds-space-2)' }}>
            {ownerType === 'person' ? (
              <SearchSelectField label="Person" id="flagOwnerPerson" required value={person} onChange={setPerson} options={people} />
            ) : (
              <>
                <label className={styles.label} htmlFor="flagOwnerExternal">
                  Outside party
                </label>
                <input
                  id="flagOwnerExternal"
                  className={styles.input}
                  maxLength={EXTERNAL_MAX}
                  value={externalName}
                  onChange={(e) => setExternalName(e.target.value)}
                  placeholder="e.g. Client IT, payment gateway vendor"
                  aria-required="true"
                  aria-invalid={attempted && !ownerValid}
                />
              </>
            )}
            {attempted && !ownerValid && (
              <p className={styles.error} role="alert" style={{ marginTop: 'var(--ds-space-1)' }}>
                Say who it is waiting on.
              </p>
            )}
          </div>
          {tickets.length > 0 && (
            <div style={{ marginTop: 'var(--ds-space-3)' }}>
              <label className={styles.label} htmlFor="flagTicket">
                Dependency ticket (optional)
              </label>
              <select id="flagTicket" className={styles.input} value={ticketId} onChange={(e) => linkTicket(e.target.value)}>
                <option value="">None</option>
                {tickets.map((t) => (
                  <option key={t.id} value={t.id}>
                    #{t.id} {t.title}
                  </option>
                ))}
              </select>
            </div>
          )}
        </fieldset>
      )}

      {dialog.type === 'risk' && (
        <div style={{ marginBottom: 'var(--ds-space-3)' }}>
          <label className={styles.label} htmlFor="flagLikelyDate">
            Likely new date (optional, information only)
          </label>
          <input id="flagLikelyDate" className={styles.input} type="date" value={likelyDueDate} onChange={(e) => setLikelyDueDate(e.target.value)} />
        </div>
      )}

      <label className={styles.label} htmlFor="flagReason">
        {isClear ? 'Note (optional)' : 'Reason (required)'}
      </label>
      <textarea
        id="flagReason"
        ref={reasonRef}
        className={styles.textarea}
        rows={3}
        maxLength={TEXT_MAX}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        aria-required={!isClear}
        aria-invalid={(reason.length > 0 || attempted) && !reasonValid}
        aria-describedby="flagReasonHint"
        placeholder={isClear ? 'e.g. Test accounts arrived' : isBlocker ? 'e.g. Waiting on the client test accounts' : 'e.g. Payment API sandbox keeps failing'}
      />
      <ReasonHint id="flagReasonHint" length={trimmed.length} min={isClear ? 0 : reasonMin} max={TEXT_MAX} attempted={attempted} />
      {error && (
        <div className={styles.error} role="alert" style={{ marginTop: 'var(--ds-space-3)', marginBottom: 0 }}>
          {error}
        </div>
      )}
    </Modal>
  );
}
