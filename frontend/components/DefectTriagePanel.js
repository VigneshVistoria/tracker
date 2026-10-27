import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Modal from './ui/Modal';
import Button from './ui/Button';
import Badge from './ui/Badge';
import styles from '../styles/issues.module.css';
import { apiFetch } from '../lib/api';
import { formatDate } from '../lib/formatDate';
import ReasonHint, { ChoiceHint } from './ReasonHint';
import DefectClassificationFields, {
  CLASSIFICATION_FIELDS,
  CLASSIFICATION_LABELS,
  EMPTY_CLASSIFICATION,
  classificationPayload,
  missingClassification,
} from './DefectClassificationFields';

// Mirrors backend/src/tasks/defect-triage.ts.
export const DISPUTED_STATUS = 'Disputed';
const COMMENT_MIN = 10;
const TEXT_MAX = 2000;

const DECISIONS = [
  { value: 'rejected', label: 'Reject the dispute - the developer fixes it', help: 'Back to the developer in Development, accepted. Tell them why.' },
  { value: 'closed', label: 'Agree - close the defect', help: 'The defect is closed with the dispute on record. A PM can reopen it later.' },
  { value: 'reassigned', label: 'Agree - reassign to another developer', help: 'The new developer gets the defect fresh and triages it on a new clock.' },
  { value: 'converted', label: 'Agree - convert to a Backlog task', help: 'The defect is closed and a new task with the same text goes to the Task Backlog.' },
];

// Defect triage (2026-10-27) on the task page: the classification, where
// triage stands, Accept/Dispute for the developer, the PM's decision on a
// dispute, and the history. Everything comes from GET
// /defect-triage/tasks/:id, so the rules live on the backend. Renders nothing
// for tasks and for defects triage never applied to.
export default function DefectTriagePanel({ task, onChanged }) {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [decideOpen, setDecideOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const load = useCallback(() => {
    apiFetch(`/defect-triage/tasks/${task.id}`).then(setState).catch(() => setState(null));
  }, [task.id]);
  useEffect(load, [load, task.status, task.triageStatus, task.assigneeUserId]);

  if (!state?.applies) return null;
  const current = state.history[0] || null;
  const waitingForPm = task.status === DISPUTED_STATUS;

  const done = async (message) => {
    setDisputeOpen(false);
    setDecideOpen(false);
    setEditOpen(false);
    await onChanged(message);
    load();
  };

  const accept = async () => {
    setBusy(true);
    setError('');
    try {
      await apiFetch(`/defect-triage/tasks/${task.id}/accept`, { method: 'PATCH' });
      await done(`Defect #${task.id} accepted - you can work on it and submit it for QA`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={styles.card}
      style={{ marginBottom: 'var(--space-4)', ...(state.canAccept || waitingForPm ? { borderLeft: '4px solid var(--ds-color-warning)' } : {}) }}
      id="defect-triage"
    >
      <h2 className={styles.cardTitle}>Defect triage</h2>

      <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 'var(--ds-space-2) var(--ds-space-4)', margin: '0 0 var(--ds-space-3)' }}>
        {CLASSIFICATION_FIELDS.map((f) => (
          <div key={f}>
            <dt className={styles.issueMeta}>{CLASSIFICATION_LABELS[f]}</dt>
            <dd style={{ margin: 0 }}>{state.classification[f] || '—'}</dd>
          </div>
        ))}
      </dl>

      <TriageStatusLine state={state} current={current} task={task} />

      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}

      {(state.canAccept || state.canDispute || state.canDecide || state.canEditClassification) && (
        <div className={styles.actions}>
          {state.canAccept && (
            <Button onClick={accept} loading={busy}>
              Accept
            </Button>
          )}
          {state.canDispute && (
            <Button variant="secondary" onClick={() => setDisputeOpen(true)} disabled={busy}>
              Dispute
            </Button>
          )}
          {state.canDecide && <Button onClick={() => setDecideOpen(true)}>Decide the dispute</Button>}
          {state.canEditClassification && (
            <Button variant="secondary" onClick={() => setEditOpen(true)} disabled={busy}>
              Edit classification
            </Button>
          )}
        </div>
      )}

      {state.history.length > 1 && (
        <details style={{ marginTop: 'var(--ds-space-3)' }}>
          <summary className={styles.issueMeta}>Triage history ({state.history.length})</summary>
          <ul style={{ margin: 'var(--ds-space-2) 0 0', paddingLeft: 'var(--ds-space-5)' }}>
            {state.history.map((r) => (
              <li key={r.id} className={styles.issueMeta}>
                {r.assigneeName}: {historyText(r)}
              </li>
            ))}
          </ul>
        </details>
      )}

      <DisputeModal
        open={disputeOpen}
        taskId={task.id}
        reasons={state.disputeReasons}
        onClose={() => setDisputeOpen(false)}
        submit={async (body) => {
          await apiFetch(`/defect-triage/tasks/${task.id}/dispute`, { method: 'PATCH', body: JSON.stringify(body) });
          await done(`Defect #${task.id} disputed - a Program Manager will decide`);
        }}
      />
      <DecideModal
        open={decideOpen}
        task={task}
        current={current}
        onClose={() => setDecideOpen(false)}
        submit={async (body) => {
          const res = await apiFetch(`/defect-triage/tasks/${task.id}/decide`, { method: 'PATCH', body: JSON.stringify(body) });
          await done(
            body.decision === 'converted' && res.convertedTaskId
              ? `Defect #${task.id} closed - task #${res.convertedTaskId} created in the Task Backlog`
              : `Dispute on #${task.id} decided`,
          );
        }}
      />
      <ClassificationModal
        open={editOpen}
        taskId={task.id}
        initial={state.classification}
        options={state.options}
        onClose={() => setEditOpen(false)}
        submit={async (body) => {
          await apiFetch(`/defect-triage/tasks/${task.id}/classification`, { method: 'PATCH', body: JSON.stringify(body) });
          await done('Classification saved');
        }}
      />
    </div>
  );
}

function historyText(r) {
  if (r.decision === 'superseded') return `moved on before triage (due ${formatDate(r.dueDate)})`;
  if (!r.decision) return `waiting, due ${formatDate(r.dueDate)}${r.late ? ' - late' : ''}`;
  if (r.decision === 'accepted') return `accepted ${formatDate(r.decidedAt)}${r.late ? ' (late)' : ''}`;
  const pm = r.pmDecisionLabel ? ` - ${r.pmDecisionLabel}${r.pmDecidedByEmail ? ` by ${r.pmDecidedByEmail}` : ''}` : ' - waiting for the PM';
  return `disputed ${formatDate(r.decidedAt)} (${r.disputeReason})${pm}`;
}

function TriageStatusLine({ state, current, task }) {
  if (!state.triageStatus && !current) {
    return (
      <p className={styles.helpText} style={{ marginTop: 0 }}>
        Filed before defect triage was on for this project (or while it was off) - no triage needed.
      </p>
    );
  }
  if (state.triageStatus === 'pending' && current && !current.decision) {
    return (
      <p style={{ marginTop: 0 }}>
        {state.canAccept ? 'Accept this defect, or dispute it with a reason,' : `Waiting for ${current.assigneeName} to accept or dispute it`} by{' '}
        <strong>{formatDate(current.dueDate)}</strong>.{' '}
        {current.late && <Badge tone="error">Late</Badge>}
        {state.canAccept && (
          <span className={styles.helpText} style={{ display: 'block' }}>
            It can be submitted for QA once you accept it. A dispute goes to a Program Manager and is not a QA rejection; the time it
            waits does not count against you.
          </span>
        )}
      </p>
    );
  }
  if (!current) return null;
  if (current.decision === 'accepted') {
    return (
      <p style={{ marginTop: 0 }}>
        Accepted by {current.assigneeName} on {formatDate(current.decidedAt)}. {current.late && <Badge tone="warning">Accepted late</Badge>}
      </p>
    );
  }
  if (current.decision === 'disputed') {
    return (
      <div style={{ marginBottom: 'var(--ds-space-3)' }}>
        <p style={{ marginTop: 0, marginBottom: 'var(--ds-space-1)' }}>
          Disputed by {current.assigneeName} on {formatDate(current.decidedAt)}: <strong>{current.disputeReason}</strong>
          {current.duplicateOfTaskId && (
            <>
              {' '}
              of <Link href={`/tasks/${current.duplicateOfTaskId}`}>#{current.duplicateOfTaskId}</Link>
            </>
          )}
        </p>
        <p style={{ whiteSpace: 'pre-wrap', marginTop: 0 }}>{current.disputeComment}</p>
        {current.pmDecision ? (
          <p style={{ marginBottom: 0 }}>
            <strong>{current.pmDecisionLabel}</strong> by {current.pmDecidedByEmail} on {formatDate(current.pmDecidedAt)}
            {current.reassignedToName ? ` (to ${current.reassignedToName})` : ''}
            {current.convertedTaskId && (
              <>
                {' '}
                - <Link href={`/tasks/${current.convertedTaskId}`}>task #{current.convertedTaskId}</Link>
              </>
            )}
            {current.pmComment && <span style={{ display: 'block', whiteSpace: 'pre-wrap' }}>{current.pmComment}</span>}
          </p>
        ) : (
          <p className={styles.helpText} style={{ marginBottom: 0 }}>
            {task.status === DISPUTED_STATUS
              ? 'Waiting for a Program Manager to decide. This time does not count against the developer.'
              : 'Not decided.'}
          </p>
        )}
      </div>
    );
  }
  return null;
}

function DisputeModal({ open, taskId, reasons, onClose, submit }) {
  const [reason, setReason] = useState('');
  const [ticket, setTicket] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [attempted, setAttempted] = useState(false);
  const reasonRef = useRef(null);
  const ticketRef = useRef(null);
  const commentRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setReason('');
    setTicket('');
    setComment('');
    setAttempted(false);
    setError('');
    setBusy(false);
  }, [open]);

  const picked = reasons.find((r) => r.label === reason);
  const trimmed = comment.trim();
  const commentValid = trimmed.length >= COMMENT_MIN && trimmed.length <= TEXT_MAX;
  const ticketValid = !picked?.needsTicket || /^\d+$/.test(ticket.trim().replace(/^#/, ''));
  const valid = !!picked && ticketValid && commentValid;

  const handleConfirm = async () => {
    if (busy) return;
    if (!valid) {
      setAttempted(true);
      (!picked ? reasonRef : !ticketValid ? ticketRef : commentRef).current?.focus();
      return;
    }
    setBusy(true);
    setError('');
    try {
      await submit({
        reason: picked.label,
        comment: trimmed,
        ...(picked.needsTicket ? { duplicateOfTaskId: Number(ticket.trim().replace(/^#/, '')) } : {}),
      });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title={`Dispute defect #${taskId}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} aria-disabled={!valid} loading={busy}>
            Dispute
          </Button>
        </>
      }
    >
      <p className={styles.issueMeta} style={{ marginTop: 0 }}>
        It moves to Disputed and a Program Manager decides. It is not counted as a QA rejection, and the time it waits does not count
        against you.
      </p>
      <label className={styles.label} htmlFor="disputeReason">
        Reason
      </label>
      <select
        id="disputeReason"
        ref={reasonRef}
        className={styles.input}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        aria-required="true"
        aria-invalid={attempted && !picked}
        aria-describedby="disputeReasonHint"
      >
        <option value="">Choose a reason...</option>
        {reasons.map((r) => (
          <option key={r.label} value={r.label}>
            {r.label}
          </option>
        ))}
      </select>
      <ChoiceHint id="disputeReasonHint" show={attempted && !picked}>
        Choose a reason.
      </ChoiceHint>
      {picked?.needsTicket && (
        <>
          <label className={styles.label} htmlFor="disputeTicket">
            Ticket number it duplicates
          </label>
          <input
            id="disputeTicket"
            ref={ticketRef}
            className={styles.input}
            inputMode="numeric"
            value={ticket}
            onChange={(e) => setTicket(e.target.value)}
            placeholder="e.g. 123"
            aria-required="true"
            aria-invalid={attempted && !ticketValid}
            aria-describedby="disputeTicketHint"
          />
          <ChoiceHint id="disputeTicketHint" show={attempted && !ticketValid}>
            Enter the ticket number.
          </ChoiceHint>
        </>
      )}
      <label className={styles.label} htmlFor="disputeComment">
        Explain (required)
      </label>
      <textarea
        id="disputeComment"
        ref={commentRef}
        className={styles.textarea}
        rows={4}
        maxLength={TEXT_MAX}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        aria-required="true"
        aria-invalid={(comment.length > 0 || attempted) && !commentValid}
        aria-describedby="disputeCommentHint"
        placeholder="e.g. Cannot reproduce on build 2.4.1 in QA - steps followed exactly"
      />
      <ReasonHint id="disputeCommentHint" length={trimmed.length} min={COMMENT_MIN} max={TEXT_MAX} attempted={attempted} />
      {error && (
        <div className={styles.error} role="alert" style={{ marginTop: 'var(--ds-space-3)', marginBottom: 0 }}>
          {error}
        </div>
      )}
    </Modal>
  );
}

function DecideModal({ open, task, current, onClose, submit }) {
  const [decision, setDecision] = useState('');
  const [comment, setComment] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [developers, setDevelopers] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [attempted, setAttempted] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDecision('');
    setComment('');
    setAssigneeId('');
    setAttempted(false);
    setError('');
    setBusy(false);
    apiFetch('/users/assignable?role=developer')
      .then((rows) =>
        setDevelopers(
          rows
            .filter((u) => u.id !== task.assigneeUserId)
            .map((u) => ({ id: u.id, name: u.fullName || u.email }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        ),
      )
      .catch(() => setDevelopers([]));
  }, [open, task.assigneeUserId]);

  const trimmed = comment.trim();
  const commentNeeded = decision === 'rejected';
  const commentValid = commentNeeded ? trimmed.length >= COMMENT_MIN && trimmed.length <= TEXT_MAX : trimmed.length <= TEXT_MAX;
  const assigneeValid = decision !== 'reassigned' || !!assigneeId;
  const valid = !!decision && commentValid && assigneeValid;

  const handleConfirm = async () => {
    if (busy) return;
    if (!valid) {
      setAttempted(true);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await submit({ decision, ...(trimmed ? { comment: trimmed } : {}), ...(decision === 'reassigned' ? { assigneeUserId: Number(assigneeId) } : {}) });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title={`Decide the dispute on #${task.id}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} aria-disabled={!valid} loading={busy}>
            Confirm decision
          </Button>
        </>
      }
    >
      {current && (
        <p className={styles.issueMeta} style={{ marginTop: 0 }}>
          {current.assigneeName}: <strong>{current.disputeReason}</strong> - {current.disputeComment}
        </p>
      )}
      <fieldset style={{ border: 0, padding: 0, margin: 0 }} aria-describedby="decideChoiceHint">
        <legend className={styles.label} style={{ padding: 0 }}>
          Decision
        </legend>
        {DECISIONS.map((d) => (
          <label key={d.value} style={{ display: 'block', marginBottom: 'var(--ds-space-2)' }}>
            <input type="radio" name="disputeDecision" value={d.value} checked={decision === d.value} onChange={() => setDecision(d.value)} />{' '}
            {d.label}
            <span className={styles.helpText} style={{ display: 'block', marginLeft: 'var(--ds-space-5)' }}>
              {d.help}
            </span>
          </label>
        ))}
      </fieldset>
      <ChoiceHint id="decideChoiceHint" show={attempted && !decision}>
        Choose a decision.
      </ChoiceHint>
      {decision === 'reassigned' && (
        <>
          <label className={styles.label} htmlFor="decideAssignee">
            Reassign to
          </label>
          <select
            id="decideAssignee"
            className={styles.input}
            value={assigneeId}
            onChange={(e) => setAssigneeId(e.target.value)}
            aria-required="true"
            aria-invalid={attempted && !assigneeId}
            aria-describedby="decideAssigneeHint"
          >
            <option value="">Choose a developer...</option>
            {developers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          <ChoiceHint id="decideAssigneeHint" show={attempted && !assigneeId}>
            Choose the developer.
          </ChoiceHint>
        </>
      )}
      <label className={styles.label} htmlFor="decideComment">
        Comment {commentNeeded ? '(required - tell the developer why)' : '(optional)'}
      </label>
      <textarea
        id="decideComment"
        className={styles.textarea}
        rows={3}
        maxLength={TEXT_MAX}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        aria-required={commentNeeded}
        aria-invalid={commentNeeded && (comment.length > 0 || attempted) && !commentValid}
        aria-describedby="decideCommentHint"
      />
      {commentNeeded && <ReasonHint id="decideCommentHint" length={trimmed.length} min={COMMENT_MIN} max={TEXT_MAX} attempted={attempted} />}
      {error && (
        <div className={styles.error} role="alert" style={{ marginTop: 'var(--ds-space-3)', marginBottom: 0 }}>
          {error}
        </div>
      )}
    </Modal>
  );
}

function ClassificationModal({ open, taskId, initial, options, onClose, submit }) {
  const [value, setValue] = useState(EMPTY_CLASSIFICATION);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [attempted, setAttempted] = useState(false);

  useEffect(() => {
    if (!open) return;
    const next = { ...EMPTY_CLASSIFICATION };
    for (const f of CLASSIFICATION_FIELDS) next[f] = initial?.[f] || '';
    setValue(next);
    setAttempted(false);
    setError('');
    setBusy(false);
  }, [open, initial]);

  if (!options) return null;
  const missing = missingClassification(value, options);

  const handleConfirm = async () => {
    if (busy) return;
    if (missing.length > 0) {
      setAttempted(true);
      setError(`Classification is missing: ${missing.join(', ')}.`);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await submit(classificationPayload(value));
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title={`Classification of #${taskId}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} loading={busy}>
            Save
          </Button>
        </>
      }
    >
      <DefectClassificationFields idPrefix="editClass" value={value} onChange={setValue} options={options} attempted={attempted} disabled={busy} />
      {error && (
        <div className={styles.error} role="alert" style={{ marginTop: 'var(--ds-space-3)', marginBottom: 0 }}>
          {error}
        </div>
      )}
    </Modal>
  );
}
