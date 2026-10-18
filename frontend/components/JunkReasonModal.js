import { useEffect, useRef, useState } from 'react';
import Modal from './ui/Modal';
import Button from './ui/Button';
import styles from '../styles/issues.module.css';
import ReasonHint from './ReasonHint';
import { statusLabel } from '../lib/taskTableShared';

// Mirrors JUNK_REASON_MIN/MAX in backend/src/tasks/dto/mark-junk.dto.ts.
const REASON_MIN = 3;
const REASON_MAX = 500;

// The one dialog for every way into Junk (Team Tasks bulk selection, the
// task page, Interventions' "Close as Junk") - a reason is always
// required. `tasks` is what's being junked ({ id, title, status }) and is
// listed so the PM can check the selection before confirming. `submit`
// receives the trimmed reason and does the actual request; its error
// message is shown here and the dialog stays open.
export default function JunkReasonModal({ open, tasks, onClose, submit, title }) {
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
  const count = tasks?.length || 0;

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
      title={title || (count === 1 ? 'Mark ticket as Junk' : `Mark ${count} tickets as Junk`)}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleConfirm} aria-disabled={!valid} loading={busy}>
            {count === 1 ? 'Mark as Junk' : `Mark ${count} as Junk`}
          </Button>
        </>
      }
    >
      <p className={styles.issueMeta} style={{ marginTop: 0 }}>
        {count === 1 ? 'This ticket' : 'These tickets'} will be hidden from Developers and QA and left out of every count, report and
        KPI. Nothing is deleted - a Program Manager can restore {count === 1 ? 'it' : 'them'} from the Junk list.
      </p>
      <ul
        style={{
          margin: '0 0 var(--ds-space-4)',
          paddingLeft: 'var(--ds-space-5)',
          maxHeight: '12rem',
          overflowY: 'auto',
          lineHeight: 'var(--ds-leading-normal)',
        }}
      >
        {(tasks || []).map((t) => (
          <li key={t.id}>
            <strong>#{t.id}</strong> {t.title} <span className={styles.issueMeta}>({statusLabel(t.status)})</span>
          </li>
        ))}
      </ul>
      <label className={styles.label} htmlFor="junkReason">
        Reason (required)
      </label>
      <textarea
        id="junkReason"
        ref={reasonRef}
        className={styles.textarea}
        rows={3}
        maxLength={REASON_MAX}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        aria-required="true"
        aria-invalid={(reason.length > 0 || attempted) && !valid}
        aria-describedby="junkReasonHint"
        placeholder="e.g. Created by mistake - duplicate of #48"
      />
      <ReasonHint id="junkReasonHint" length={trimmed.length} min={REASON_MIN} max={REASON_MAX} attempted={attempted} />
      {error && (
        <div className={styles.error} role="alert" style={{ marginTop: 'var(--ds-space-3)', marginBottom: 0 }}>
          {error}
        </div>
      )}
    </Modal>
  );
}
