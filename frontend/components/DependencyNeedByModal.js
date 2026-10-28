import { useEffect, useRef, useState } from 'react';
import Modal from './ui/Modal';
import Button from './ui/Button';
import styles from '../styles/issues.module.css';
import { apiFetch } from '../lib/api';
import { formatDate } from '../lib/formatDate';
import ReasonHint from './ReasonHint';

// Mirrors backend/src/task-flags/task-flags.ts (FLAG_REASON_MIN/TEXT_MAX).
const REASON_MIN = 10;
const TEXT_MAX = 1000;

// Performance Tracking S3 (2026-10-28): set or change a dependency
// ticket's needed-by date - its creator or a PM/Admin, with a reason
// (logged in the dependency history). Never the ticket's owner.
export default function DependencyNeedByModal({ ticket, onClose, onDone }) {
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [attempted, setAttempted] = useState(false);
  const dateRef = useRef(null);

  useEffect(() => {
    setDate(ticket?.needByDate || '');
    setReason('');
    setError('');
    setAttempted(false);
  }, [ticket]);

  if (!ticket) return null;
  const trimmed = reason.trim();
  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(date) && date !== ticket.needByDate;
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
      await apiFetch(`/task-dependency-tickets/${ticket.id}/need-by`, { method: 'PATCH', body: JSON.stringify({ needByDate: date, reason: trimmed }) });
      await onDone(`Needed by changed to ${formatDate(date)}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={busy ? () => {} : onClose}
      title={`${ticket.needByDate ? 'Change' : 'Set'} the needed-by date of "${ticket.title}"`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} aria-disabled={!valid} loading={busy}>
            Save date
          </Button>
        </>
      }
    >
      <p className={styles.issueMeta} style={{ marginTop: 0 }}>
        {ticket.needByDate ? `Now ${formatDate(ticket.needByDate)}. ` : ''}The change and your reason are kept in the dependency history.
      </p>
      <label className={styles.label} htmlFor="needByDate">
        Needed by
      </label>
      <input
        id="needByDate"
        ref={dateRef}
        className={styles.input}
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        aria-required="true"
        aria-invalid={attempted && !dateValid}
      />
      {attempted && !dateValid && (
        <p className={styles.error} role="alert" style={{ marginTop: 'var(--ds-space-1)' }}>
          Pick a new date.
        </p>
      )}
      <label className={styles.label} htmlFor="needByReason" style={{ marginTop: 'var(--ds-space-3)' }}>
        Reason (required)
      </label>
      <textarea
        id="needByReason"
        className={styles.textarea}
        rows={3}
        maxLength={TEXT_MAX}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        aria-required="true"
        aria-describedby="needByReasonHint"
        placeholder="e.g. The client moved the release to the 20th"
      />
      <ReasonHint id="needByReasonHint" length={trimmed.length} min={REASON_MIN} max={TEXT_MAX} attempted={attempted} />
      {error && (
        <div className={styles.error} role="alert" style={{ marginTop: 'var(--ds-space-3)', marginBottom: 0 }}>
          {error}
        </div>
      )}
    </Modal>
  );
}
