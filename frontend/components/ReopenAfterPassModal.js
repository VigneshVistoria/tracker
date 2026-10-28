import { useRef, useState } from 'react';
import Modal from './ui/Modal';
import Button from './ui/Button';
import styles from '../styles/issues.module.css';
import { apiFetch } from '../lib/api';
import { formatDate } from '../lib/formatDate';
import ReasonHint from './ReasonHint';

// Mirrors backend/src/tasks/qa-intake.ts.
export const REOPEN_FROM_STATUSES = ['Pass', 'Released - No Showstoppers', 'Released - With Showstoppers'];
const REASON_MIN = 10;
const TEXT_MAX = 1000;

// Performance Tracking S4 (2026-10-28): PM/Admin "Reopen after Pass" - the
// same work failing again goes back to Development with a reason and a new
// proposed Due date (the assignee confirms it or sets their own). Kept in
// the task's reopen history and charged in Q3 to the developer whose
// submission passed.
export default function ReopenAfterPassModal({ task, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [attempted, setAttempted] = useState(false);
  const dateRef = useRef(null);

  const trimmed = reason.trim();
  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(dueDate);
  const valid = dateValid && trimmed.length >= REASON_MIN && trimmed.length <= TEXT_MAX;

  const handleConfirm = async () => {
    if (busy) return;
    if (!valid) {
      setAttempted(true);
      if (!dateValid) dateRef.current?.focus();
      return;
    }
    setBusy(true);
    setError('');
    try {
      await apiFetch(`/tasks/${task.id}/reopen-after-pass`, { method: 'POST', body: JSON.stringify({ reason: trimmed, dueDate }) });
      await onDone(`#${task.id} reopened - proposed Due date ${formatDate(dueDate)}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={busy ? () => {} : onClose}
      title={`Reopen #${task.id} after ${task.status === 'Pass' ? 'Pass' : 'release'}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleConfirm} aria-disabled={!valid} loading={busy}>
            Reopen
          </Button>
        </>
      }
    >
      <p className={styles.issueMeta} style={{ marginTop: 0 }}>
        Only for the same work failing again - a new problem should be raised as a new defect. The task goes back to Development; the
        developer whose work passed is counted for the reopen. The date below is proposed - the assignee confirms it or sets their own.
      </p>
      <label className={styles.label} htmlFor="reopenDueDate">
        New Due date (proposed)
      </label>
      <input
        id="reopenDueDate"
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
      <label className={styles.label} htmlFor="reopenReason" style={{ marginTop: 'var(--ds-space-3)' }}>
        Reason (required)
      </label>
      <textarea
        id="reopenReason"
        className={styles.textarea}
        rows={3}
        maxLength={TEXT_MAX}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        aria-required="true"
        aria-describedby="reopenReasonHint"
        placeholder="e.g. The same save bug is back on production"
      />
      <ReasonHint id="reopenReasonHint" length={trimmed.length} min={REASON_MIN} max={TEXT_MAX} attempted={attempted} />
      {error && (
        <div className={styles.error} role="alert" style={{ marginTop: 'var(--ds-space-3)', marginBottom: 0 }}>
          {error}
        </div>
      )}
    </Modal>
  );
}
