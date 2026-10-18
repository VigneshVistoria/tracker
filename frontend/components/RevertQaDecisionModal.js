import { useEffect, useRef, useState } from 'react';
import Modal from './ui/Modal';
import Button from './ui/Button';
import styles from '../styles/issues.module.css';
import ReasonHint from './ReasonHint';

// Mirrors REVERT_REASON_MIN/MAX in backend/src/task-qa-reviews/dto/qa-revert-decision.dto.ts.
const REASON_MIN = 3;
const REASON_MAX = 500;

// PM/Admin undoing a mistaken QA approve/reject (2026-10-13). Same shape as
// JunkReasonModal: a required reason, the server's error shown in place,
// and the dialog stays open on failure. `decision` is 'approved' or
// 'rejected'; `submit` receives the trimmed reason.
export default function RevertQaDecisionModal({ open, taskId, decision, decidedBy, onClose, submit }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Set when Confirm is clicked with too short a reason - shows the hint.
  const [attempted, setAttempted] = useState(false);
  const reasonRef = useRef(null);

  useEffect(() => {
    if (open) {
      setReason('');
      setAttempted(false);
      setError('');
      setBusy(false);
    }
  }, [open]);

  const trimmed = reason.trim();
  const valid = trimmed.length >= REASON_MIN && trimmed.length <= REASON_MAX;
  const what = decision === 'approved' ? 'approval' : 'rejection';

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
      title={`Revert QA ${what}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleConfirm} aria-disabled={!valid} loading={busy}>
            Revert {what}
          </Button>
        </>
      }
    >
      <p className={styles.issueMeta} style={{ marginTop: 0 }}>
        Task #{taskId} goes back to waiting for QA with the same submission, as if the {what}
        {decidedBy ? ` by ${decidedBy}` : ''} never happened. It stops counting in KPIs and the QA Summary
        {decision === 'rejected' ? ', and any defect raised with this rejection is moved to Junk' : ''}. The {what} stays in the
        review history, marked as reverted. This can only be done once per decision.
      </p>
      <label className={styles.label} htmlFor="revertReason">
        Reason (required)
      </label>
      <textarea
        id="revertReason"
        ref={reasonRef}
        className={styles.textarea}
        rows={3}
        maxLength={REASON_MAX}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        aria-required="true"
        aria-invalid={(reason.length > 0 || attempted) && !valid}
        aria-describedby="revertReasonHint"
        placeholder="e.g. QA rejected this by mistake"
      />
      <ReasonHint id="revertReasonHint" length={trimmed.length} min={REASON_MIN} max={REASON_MAX} attempted={attempted} />
      {error && (
        <div className={styles.error} role="alert" style={{ marginTop: 'var(--ds-space-3)', marginBottom: 0 }}>
          {error}
        </div>
      )}
    </Modal>
  );
}
