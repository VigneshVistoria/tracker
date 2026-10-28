import { useCallback, useEffect, useRef, useState } from 'react';
import Modal from './ui/Modal';
import Button from './ui/Button';
import Badge from './ui/Badge';
import styles from '../styles/issues.module.css';
import { apiFetch } from '../lib/api';
import { formatDate, formatDateTime } from '../lib/formatDate';
import ReasonHint from './ReasonHint';

// Mirrors backend/src/tasks/due-date-change.ts.
const TEXT_MAX = 1000;

const STATUS_LABEL = {
  pending: 'Waiting for a PM',
  approved: 'Approved',
  rejected: 'Not approved',
  withdrawn: 'Withdrawn',
  cancelled: 'Cancelled',
};
const STATUS_TONE = { pending: 'warning', approved: 'success', rejected: 'error', withdrawn: 'neutral', cancelled: 'neutral' };

function cancelText(reason) {
  if (reason === 'reassigned') return 'the task was reassigned';
  if (reason === 'superseded') return 'a PM changed the date directly';
  if (reason && reason.startsWith('status:')) return `the task moved to ${reason.slice(7)}`;
  return '';
}

const EVENT_TEXT = { due_set: 'Due date set', due_changed: 'Due date changed', due_cleared: 'Due date cleared', due_committed: 'Committed' };

// Performance Tracking S2 (2026-10-28) on the task page: the committed Due
// date, the assignee's one free set/confirm after a reassignment, change
// requests (assignee asks with a reason; any PM/Admin approves or rejects),
// PM/Admin direct changes with a reason, and the full date history. All of
// it comes from GET /tasks/:id/due-date, so the rules live on the backend.
// Renders nothing while the project's Performance Tracking is off.
// onState(state) lets the page lock the form's Due date field.
export default function DueDateCommitmentPanel({ task, onChanged, onState }) {
  const [state, setState] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState(null);

  const load = useCallback(() => {
    apiFetch(`/tasks/${task.id}/due-date`)
      .then((s) => {
        setState(s);
        onState?.(s);
      })
      .catch(() => {
        setState(null);
        onState?.(null);
      });
    // onState is a state setter on the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id]);
  useEffect(load, [load, task.dueDate, task.status, task.assigneeUserId]);

  if (!state?.trackingOn) return null;
  const pending = state.pending;
  const min = state.reasonMin;

  const done = async (message) => {
    setDialog(null);
    await onChanged(message);
    load();
  };

  const withdraw = async () => {
    setBusy(true);
    setError('');
    try {
      await apiFetch(`/tasks/due-date-changes/${pending.id}/withdraw`, { method: 'PATCH' });
      await done('Date change request withdrawn');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const dialogs = {
    commit: {
      title: `Confirm the Due date of #${task.id}`,
      intro:
        'This date was proposed for you. Confirm it as it is, or pick your own date instead (once) - after that it is your commitment and any later change needs a reason and PM approval.',
      showDate: true,
      initialDate: state.dueDate,
      textMin: 0,
      confirm: 'Confirm this date',
      submit: async ({ dueDate }) => {
        await apiFetch(`/tasks/${task.id}/due-date/commit`, { method: 'POST', body: JSON.stringify({ dueDate }) });
        await done(`You committed to ${formatDate(dueDate)}`);
      },
    },
    propose: {
      title: `Propose a Due date for #${task.id}`,
      intro: `${task.assigneeEmail ? 'The assignee is told and' : 'Once assigned, the assignee'} confirms it or sets their own. Until then it is a proposal, not their commitment.`,
      showDate: true,
      initialDate: '',
      textMin: 0,
      confirm: 'Propose date',
      submit: async ({ dueDate }) => {
        await apiFetch(`/tasks/${task.id}/due-date/propose`, { method: 'POST', body: JSON.stringify({ dueDate }) });
        await done(`Proposed ${formatDate(dueDate)}`);
      },
    },
    request: {
      title: `Ask to change the Due date of #${task.id}`,
      intro: `A Program Manager or Admin approves or rejects it. Until then the Due date stays ${formatDate(state.dueDate)}.`,
      showDate: true,
      initialDate: '',
      textLabel: 'Reason (required)',
      textMin: min,
      placeholder: 'e.g. Waiting on the payment API sandbox from the client',
      confirm: 'Send request',
      submit: async ({ dueDate, text }) => {
        await apiFetch(`/tasks/${task.id}/due-date-changes`, { method: 'POST', body: JSON.stringify({ dueDate, reason: text }) });
        await done('Request sent to the Program Managers');
      },
    },
    direct: {
      title: `Change the Due date of #${task.id}`,
      intro: `Now ${formatDate(state.dueDate)}. The new date applies at once, logged with your reason, as a PROPOSAL: the assignee confirms it or sets their own.${pending ? ' The pending request is cancelled.' : ''}`,
      showDate: true,
      initialDate: '',
      textLabel: 'Reason (required)',
      textMin: min,
      placeholder: 'e.g. Client moved the release to the 20th',
      confirm: 'Change date',
      submit: async ({ dueDate, text }) => {
        await apiFetch(`/tasks/${task.id}/due-date-changes`, { method: 'POST', body: JSON.stringify({ dueDate, reason: text }) });
        await done(`Due date changed to ${formatDate(dueDate)}`);
      },
    },
    approve: pending && {
      title: `Approve ${formatDate(pending.requestedDueDate)} for #${task.id}`,
      intro: `The Due date moves from ${formatDate(pending.currentDueDate)} to ${formatDate(pending.requestedDueDate)}.`,
      textLabel: 'Note (optional)',
      textMin: 0,
      confirm: 'Approve',
      submit: async ({ text }) => {
        await apiFetch(`/tasks/due-date-changes/${pending.id}/approve`, { method: 'PATCH', body: JSON.stringify({ note: text }) });
        await done('Date change approved');
      },
    },
    reject: pending && {
      title: `Reject the date change for #${task.id}`,
      intro: `The Due date stays ${formatDate(pending.currentDueDate)}. Tell ${pending.requestedByName || 'the developer'} why.`,
      textLabel: 'Note (required)',
      textMin: min,
      placeholder: 'e.g. Keep the buffer for QA - talk to me if the API is still blocked',
      confirm: 'Reject',
      danger: true,
      submit: async ({ text }) => {
        await apiFetch(`/tasks/due-date-changes/${pending.id}/reject`, { method: 'PATCH', body: JSON.stringify({ note: text }) });
        await done('Date change rejected');
      },
    },
  };

  const needsAction = state.canCommit || state.canDecide;
  const history = [
    ...state.requests.map((r) => ({ at: r.createdAt, key: `r${r.id}`, r })),
    ...state.events.map((e) => ({ at: e.occurredAt, key: `e${e.id}`, e })),
  ].sort((a, b) => new Date(b.at) - new Date(a.at));

  return (
    <div
      className={styles.card}
      style={{ marginBottom: 'var(--space-4)', ...(needsAction ? { borderLeft: '4px solid var(--ds-color-warning)' } : {}) }}
      id="due-date"
    >
      <h2 className={styles.cardTitle}>Due date commitment</h2>

      <CommitmentLine state={state} task={task} />

      {pending && (
        <div style={{ marginBottom: 'var(--ds-space-3)' }}>
          <p style={{ margin: 0 }}>
            <Badge tone="warning">Waiting for a PM</Badge> {pending.requestedByName || 'The developer'} asked on {formatDate(pending.createdAt)} to
            move it {pending.requestedDueDate > pending.currentDueDate ? 'later' : 'earlier'} to <strong>{formatDate(pending.requestedDueDate)}</strong>.
            The Due date stays {formatDate(pending.currentDueDate)} until it is approved.
          </p>
          <p style={{ whiteSpace: 'pre-wrap', margin: 'var(--ds-space-1) 0 0' }}>{pending.reason}</p>
        </div>
      )}

      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}

      {(state.canCommit || state.canPropose || state.canRequest || state.canWithdraw || state.canChangeDirect || state.canDecide) && (
        <div className={styles.actions}>
          {state.canCommit && <Button onClick={() => setDialog('commit')}>Confirm or set my own date</Button>}
          {state.canPropose && <Button onClick={() => setDialog('propose')}>Propose a date</Button>}
          {state.canRequest && (
            <Button variant="secondary" onClick={() => setDialog('request')}>
              Ask to change date
            </Button>
          )}
          {state.canWithdraw && (
            <Button variant="secondary" onClick={withdraw} loading={busy}>
              Withdraw request
            </Button>
          )}
          {state.canDecide && <Button onClick={() => setDialog('approve')}>Approve</Button>}
          {state.canDecide && (
            <Button variant="secondary" onClick={() => setDialog('reject')}>
              Reject
            </Button>
          )}
          {state.canChangeDirect && (
            <Button variant="secondary" onClick={() => setDialog('direct')}>
              Change date
            </Button>
          )}
        </div>
      )}

      {history.length > 0 && (
        <details style={{ marginTop: 'var(--ds-space-3)' }}>
          <summary className={styles.issueMeta}>Date history ({history.length})</summary>
          <ul style={{ margin: 'var(--ds-space-2) 0 0', paddingLeft: 'var(--ds-space-5)' }}>
            {history.map((h) => (
              <li key={h.key} className={styles.issueMeta}>
                {formatDateTime(h.at)} - {h.r ? <RequestText r={h.r} /> : <EventText e={h.e} />}
              </li>
            ))}
          </ul>
        </details>
      )}

      {dialog && dialogs[dialog] && <ReasonDialog spec={dialogs[dialog]} onClose={() => setDialog(null)} />}
    </div>
  );
}

function CommitmentLine({ state, task }) {
  if (state.state === 'none') {
    return (
      <p className={styles.helpText} style={{ marginTop: 0 }}>
        No Due date yet. The first date the assignee sets on the form above becomes their commitment.
      </p>
    );
  }
  if (state.state === 'unassigned') {
    return <p style={{ marginTop: 0 }}>Due {formatDate(state.dueDate)}. Nobody is assigned, so nobody has committed to it yet.</p>;
  }
  if (state.state === 'needs_commitment') {
    return (
      <p style={{ marginTop: 0 }}>
        <Badge tone="warning">Proposed</Badge> {formatDate(state.dueDate)}
        {state.proposedByName ? ` by ${state.proposedByName}` : ''}
        {state.proposedAt ? ` on ${formatDate(state.proposedAt)}` : ''} - <strong>not committed yet</strong>.{' '}
        {state.canCommit
          ? 'Confirm it, or set your own date instead (once). Until you do, it still counts as your Due date.'
          : `Waiting for ${task.assigneeEmail || 'the assignee'} to confirm it or set their own.`}
      </p>
    );
  }
  return (
    <p style={{ marginTop: 0 }}>
      Due <strong>{formatDate(state.dueDate)}</strong>, committed by {state.committedByName || 'the assignee'}
      {state.committedAt ? ` on ${formatDate(state.committedAt)}` : ''}.{' '}
      {state.frozen ? `It no longer changes (the task is ${task.status}).` : 'A change needs a reason and PM or Admin approval.'}
    </p>
  );
}

function RequestText({ r }) {
  const what =
    r.kind === 'direct'
      ? `${r.requestedByName || 'A PM'} changed it from ${formatDate(r.currentDueDate)} to ${formatDate(r.requestedDueDate)}`
      : `${r.requestedByName || 'The developer'} asked to move ${formatDate(r.currentDueDate)} to ${formatDate(r.requestedDueDate)}`;
  return (
    <>
      {what}: "{r.reason}"{' '}
      {r.kind === 'request' && <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>}
      {r.kind === 'request' && r.decidedByName && r.status !== 'withdrawn' && ` by ${r.decidedByName}`}
      {r.status === 'cancelled' && cancelText(r.cancelReason) && ` - ${cancelText(r.cancelReason)}`}
      {r.decisionNote && `: "${r.decisionNote}"`}
    </>
  );
}

function EventText({ e }) {
  const dates =
    e.kind === 'due_changed'
      ? ` from ${formatDate(e.oldDueDate)} to ${formatDate(e.newDueDate)}`
      : e.kind === 'due_set'
        ? ` to ${formatDate(e.newDueDate)}`
        : '';
  return (
    <>
      {EVENT_TEXT[e.kind] || e.kind}
      {dates}
      {e.actorName ? ` by ${e.actorName}` : ''}
    </>
  );
}

function ReasonDialog({ spec, onClose }) {
  const [dueDate, setDueDate] = useState(spec.initialDate || '');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [attempted, setAttempted] = useState(false);
  const dateRef = useRef(null);
  const textRef = useRef(null);

  const trimmed = text.trim();
  const dateValid = !spec.showDate || /^\d{4}-\d{2}-\d{2}$/.test(dueDate);
  const textValid = trimmed.length >= spec.textMin && trimmed.length <= TEXT_MAX;
  const valid = dateValid && textValid;

  const handleConfirm = async () => {
    if (busy) return;
    if (!valid) {
      setAttempted(true);
      (!dateValid ? dateRef : textRef).current?.focus();
      return;
    }
    setBusy(true);
    setError('');
    try {
      await spec.submit({ dueDate, text: trimmed });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={busy ? () => {} : onClose}
      title={spec.title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant={spec.danger ? 'danger' : 'primary'} onClick={handleConfirm} aria-disabled={!valid} loading={busy}>
            {spec.confirm}
          </Button>
        </>
      }
    >
      <p className={styles.issueMeta} style={{ marginTop: 0 }}>
        {spec.intro}
      </p>
      {spec.showDate && (
        <>
          <label className={styles.label} htmlFor="dueDateDialogDate">
            New Due date
          </label>
          <input
            id="dueDateDialogDate"
            ref={dateRef}
            className={styles.input}
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            aria-required="true"
            aria-invalid={attempted && !dateValid}
          />
          {attempted && !dateValid && (
            <p className={styles.error} role="alert" style={{ marginTop: 'var(--ds-space-1)' }}>
              Pick a date.
            </p>
          )}
        </>
      )}
      {spec.textLabel && (
        <>
          <label className={styles.label} htmlFor="dueDateDialogText" style={{ marginTop: 'var(--ds-space-3)' }}>
            {spec.textLabel}
          </label>
          <textarea
            id="dueDateDialogText"
            ref={textRef}
            className={styles.textarea}
            rows={3}
            maxLength={TEXT_MAX}
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-required={spec.textMin > 0}
            aria-invalid={(text.length > 0 || attempted) && !textValid}
            aria-describedby="dueDateDialogTextHint"
            placeholder={spec.placeholder}
          />
          <ReasonHint id="dueDateDialogTextHint" length={trimmed.length} min={spec.textMin} max={TEXT_MAX} attempted={attempted} />
        </>
      )}
      {error && (
        <div className={styles.error} role="alert" style={{ marginTop: 'var(--ds-space-3)', marginBottom: 0 }}>
          {error}
        </div>
      )}
    </Modal>
  );
}
