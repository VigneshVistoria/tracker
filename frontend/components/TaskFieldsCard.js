import { useCallback, useEffect, useState } from 'react';
import Modal from './ui/Modal';
import Button from './ui/Button';
import Badge from './ui/Badge';
import styles from '../styles/issues.module.css';
import { apiFetch } from '../lib/api';
import { formatDate } from '../lib/formatDate';
import ReasonHint from './ReasonHint';
import { CLIENT_IMPACT_MIN, TASK_TYPE_OPTIONS } from './CreateTaskForm';

const TYPE_LABEL = Object.fromEntries(TASK_TYPE_OPTIONS.map((t) => [t.value, t.label]));
const DECLINE_MIN = 10;

// Performance Tracking S4b (2026-10-28) on the task page: Type, Requirement
// ID, Client impact (internal), what's still needed before QA submission,
// and - on an Improvement a developer created - the PM's Accept / Decline.
// Rules live in backend/src/tasks/task-fields.ts; GET /tasks/:id/tracking-
// fields says what this viewer may do. Renders nothing while the project's
// tracking is off (and for defects).
export default function TaskFieldsCard({ task, onChanged }) {
  const [state, setState] = useState(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ taskType: '', requirementId: '', clientImpact: '' });
  const [declining, setDeclining] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    apiFetch(`/tasks/${task.id}/tracking-fields`)
      .then(setState)
      .catch(() => setState(null));
  }, [task.id]);
  useEffect(load, [load, task.status]);

  if (!state?.trackingOn) return null;

  const startEdit = () => {
    setDraft({ taskType: state.taskType || '', requirementId: state.requirementId || '', clientImpact: state.clientImpact || '' });
    setError('');
    setEditing(true);
  };

  const save = async (e) => {
    e.preventDefault();
    const impact = draft.clientImpact.trim();
    if (impact && impact.length < CLIENT_IMPACT_MIN) {
      setError(`Client impact must be at least ${CLIENT_IMPACT_MIN} characters.`);
      return;
    }
    const body = {};
    if (state.canEditType && draft.taskType && draft.taskType !== state.taskType) body.taskType = draft.taskType;
    if (state.canEditTexts) {
      body.requirementId = draft.requirementId;
      body.clientImpact = draft.clientImpact;
    }
    setBusy(true);
    setError('');
    try {
      const next = await apiFetch(`/tasks/${task.id}/tracking-fields`, { method: 'PATCH', body: JSON.stringify(body) });
      setState(next);
      setEditing(false);
      await onChanged('Saved');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const decide = async (decision, reason) => {
    setBusy(true);
    setError('');
    try {
      const next = await apiFetch(`/tasks/${task.id}/improvement-decision`, { method: 'PATCH', body: JSON.stringify({ decision, reason }) });
      setState(next);
      setDeclining(false);
      await onChanged(decision === 'accepted' ? 'Improvement accepted' : 'Improvement declined');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.card} style={{ marginBottom: 'var(--space-4)' }} id="task-fields">
      <h2 className={styles.cardTitle}>Type and requirement</h2>

      {!editing ? (
        <>
          <p style={{ margin: 0 }}>
            <strong>Type:</strong> {state.taskType ? TYPE_LABEL[state.taskType] : 'Not set'} &middot; <strong>Requirement ID:</strong>{' '}
            {state.requirementId || '—'}
          </p>
          <p style={{ margin: 'var(--space-1) 0 0', whiteSpace: 'pre-wrap' }}>
            <strong>Client impact (internal):</strong> {state.clientImpact || '—'}
          </p>
          {state.missingBeforeSubmission.length > 0 && (
            <p className={styles.helpText}>Before QA submission this needs {state.missingBeforeSubmission.join(' and ')}.</p>
          )}
          {(state.canEditType || state.canEditTexts) && (
            <button className={styles.buttonSecondary} type="button" style={{ marginTop: 'var(--space-2)' }} onClick={startEdit}>
              Edit
            </button>
          )}
        </>
      ) : (
        <form onSubmit={save}>
          {state.canEditType && (
            <div className={styles.fieldNarrow}>
              <label className={styles.label} htmlFor="tfType">Type</label>
              <select id="tfType" className={styles.input} value={draft.taskType} onChange={(e) => setDraft({ ...draft, taskType: e.target.value })}>
                {!draft.taskType && <option value="">Not set</option>}
                {TASK_TYPE_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
          )}
          {state.canEditTexts && (
            <>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="tfRequirementId">Requirement ID</label>
                <input
                  id="tfRequirementId"
                  className={styles.input}
                  maxLength={100}
                  value={draft.requirementId}
                  onChange={(e) => setDraft({ ...draft, requirementId: e.target.value })}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="tfClientImpact">Client impact (internal, at least {CLIENT_IMPACT_MIN} characters)</label>
                <textarea
                  id="tfClientImpact"
                  className={styles.textarea}
                  rows={3}
                  maxLength={2000}
                  value={draft.clientImpact}
                  onChange={(e) => setDraft({ ...draft, clientImpact: e.target.value })}
                />
              </div>
            </>
          )}
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

      {state.selfInitiatedImprovement && (
        <div style={{ marginTop: 'var(--space-3)', borderTop: '1px solid var(--color-border)', paddingTop: 'var(--space-3)' }}>
          <p style={{ margin: 0 }}>
            <strong>Self-initiated improvement:</strong>{' '}
            {state.improvementDecision === 'accepted' && <Badge tone="success">Accepted</Badge>}
            {state.improvementDecision === 'declined' && <Badge tone="error">Declined</Badge>}
            {!state.improvementDecision && <Badge tone="warning">Waiting for a PM</Badge>}
            {state.improvementDecidedByName && ` by ${state.improvementDecidedByName} on ${formatDate(state.improvementDecidedAt)}`}
            {state.improvementDeclineReason && `: "${state.improvementDeclineReason}"`}
          </p>
          {state.canDecide && (
            <div className={styles.actions}>
              {state.improvementDecision !== 'accepted' && (
                <Button onClick={() => decide('accepted')} loading={busy}>
                  Accept improvement
                </Button>
              )}
              {state.improvementDecision !== 'declined' && (
                <Button variant="secondary" onClick={() => setDeclining(true)} disabled={busy}>
                  Decline
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {error && (
        <div className={styles.error} role="alert" style={{ marginTop: 'var(--space-2)' }}>
          {error}
        </div>
      )}
      {declining && <DeclineDialog taskId={task.id} busy={busy} onClose={() => setDeclining(false)} onConfirm={(reason) => decide('declined', reason)} />}
    </div>
  );
}

function DeclineDialog({ taskId, busy, onClose, onConfirm }) {
  const [reason, setReason] = useState('');
  const [attempted, setAttempted] = useState(false);
  const trimmed = reason.trim();
  const valid = trimmed.length >= DECLINE_MIN;
  return (
    <Modal
      open
      onClose={busy ? () => {} : onClose}
      title={`Decline the improvement #${taskId}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={busy}
            aria-disabled={!valid}
            onClick={() => {
              if (!valid) {
                setAttempted(true);
                return;
              }
              onConfirm(trimmed);
            }}
          >
            Decline
          </Button>
        </>
      }
    >
      <p className={styles.issueMeta} style={{ marginTop: 0 }}>
        It stays an Improvement but does not count as a self-initiated improvement. The developer sees your reason.
      </p>
      <label className={styles.label} htmlFor="declineReason">Reason (required)</label>
      <textarea
        id="declineReason"
        className={styles.textarea}
        rows={3}
        maxLength={1000}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        aria-required="true"
        aria-describedby="declineReasonHint"
      />
      <ReasonHint id="declineReasonHint" length={trimmed.length} min={DECLINE_MIN} max={1000} attempted={attempted} />
    </Modal>
  );
}
