import { useEffect, useRef, useState } from 'react';
import Modal from './ui/Modal';
import Button from './ui/Button';
import styles from '../styles/issues.module.css';
import ReasonHint from './ReasonHint';

// Mirrors JUNK_REASON_MIN/MAX in backend/src/tasks/dto/mark-junk.dto.ts
// (DependencyTicketReasonDto reuses that rule).
const REASON_MIN = 3;
const REASON_MAX = 500;

const COPY = {
  cancel: {
    title: 'Cancel dependency ticket',
    confirm: 'Cancel ticket',
    variant: 'danger',
    text: 'The parent task stops being blocked by it. Its dependency task, if it has one, goes to Junk with this reason. The owner is told. A Program Manager can bring it back by restoring that task from Junk.',
    placeholder: 'e.g. Found another way round it - no longer needed',
  },
  reopen: {
    title: 'Reopen dependency ticket',
    confirm: 'Reopen ticket',
    variant: 'primary',
    text: 'The parent task is blocked by it again, and its dependency task goes back to In progress. The owner is told, with this reason.',
    placeholder: 'e.g. The endpoint still returns an error for claims over 10k',
  },
};

// Dependency tasks Stage 3 (2026-11-05): the reason dialog for Cancel and
// Reopen (requester or Program Manager). `mode` is 'cancel' or 'reopen';
// `submit` receives the trimmed reason and does the request - its error is
// shown here and the dialog stays open.
export default function DependencyTicketReasonModal({ mode, ticket, onClose, submit }) {
  const open = !!ticket && !!mode;
  const copy = COPY[mode] || COPY.cancel;
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [attempted, setAttempted] = useState(false);
  const reasonRef = useRef(null);

  useEffect(() => {
    if (open) {
      setReason('');
      setAttempted(false);
      setError('');
      setBusy(false);
    }
  }, [open, mode, ticket?.id]);

  const trimmed = reason.trim();
  const valid = trimmed.length >= REASON_MIN && trimmed.length <= REASON_MAX;

  const handleConfirm = async () => {
    if (busy) return;
    if (!valid) {
      setAttempted(true);
      reasonRef.current?.focus();
      return;
    }
    setBusy(true);
    setError('');
    try {
      await submit(trimmed);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title={copy.title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Back
          </Button>
          <Button variant={copy.variant} onClick={handleConfirm} aria-disabled={!valid} loading={busy}>
            {copy.confirm}
          </Button>
        </>
      }
    >
      {ticket && (
        <p style={{ marginTop: 0, fontWeight: 600 }}>{ticket.title || `Ticket #${ticket.id}`}</p>
      )}
      <p className={styles.issueMeta}>{copy.text}</p>
      <label className={styles.label} htmlFor="dependencyTicketReason">
        Reason (required)
      </label>
      <textarea
        id="dependencyTicketReason"
        ref={reasonRef}
        className={styles.textarea}
        rows={3}
        maxLength={REASON_MAX}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        aria-required="true"
        aria-invalid={(reason.length > 0 || attempted) && !valid}
        aria-describedby="dependencyTicketReasonHint"
        placeholder={copy.placeholder}
      />
      <ReasonHint id="dependencyTicketReasonHint" length={trimmed.length} min={REASON_MIN} max={REASON_MAX} attempted={attempted} />
      {error && (
        <div className={styles.error} role="alert" style={{ marginTop: 'var(--ds-space-3)', marginBottom: 0 }}>
          {error}
        </div>
      )}
    </Modal>
  );
}
