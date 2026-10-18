import { useEffect, useRef, useState } from 'react';
import Modal from './ui/Modal';
import Button from './ui/Button';
import styles from '../styles/issues.module.css';
import ReasonHint, { ChoiceHint } from './ReasonHint';

// Mirrors QA_SEND_BACK_REASON_MIN/MAX in backend/src/task-qa-reviews/dto/qa-send-back.dto.ts.
const REASON_MIN = 10;
const REASON_MAX = 1000;

// PM/Admin pulling a task back from QA to the developer before QA has
// decided it (2026-10-16). Same shape as RevertQaDecisionModal: a required
// reason, the server's error shown in place, the dialog stays open on
// failure. "Send to" defaults to the current developer; `canPickOther`
// (Program Manager only - backend mirror: sendBackFromQa()) adds a choice
// of another developer from `developers` ({ id, name } - Developer/
// Designer/DevOps). With no current developer, picking one is required.
// `submit` receives (reason, assigneeUserId | undefined).
export default function SendBackToDeveloperModal({ open, taskId, currentDeveloper, developers, canPickOther, onClose, submit }) {
  const [reason, setReason] = useState('');
  const [sendTo, setSendTo] = useState('current');
  const [otherId, setOtherId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Set when Send back is clicked with something missing - shows the hints.
  const [attempted, setAttempted] = useState(false);
  const reasonRef = useRef(null);
  const otherRef = useRef(null);

  const hasCurrent = !!currentDeveloper?.id;

  useEffect(() => {
    if (open) {
      setReason('');
      setSendTo(hasCurrent ? 'current' : 'other');
      setOtherId('');
      setAttempted(false);
      setError('');
      setBusy(false);
    }
  }, [open, hasCurrent]);

  const trimmed = reason.trim();
  const reasonValid = trimmed.length >= REASON_MIN && trimmed.length <= REASON_MAX;
  const targetValid = sendTo === 'current' ? hasCurrent : !!otherId;
  const valid = reasonValid && targetValid;
  const others = (developers || []).filter((d) => d.id !== currentDeveloper?.id).sort((a, b) => a.name.localeCompare(b.name));

  const handleConfirm = async () => {
    if (busy) return;
    if (!valid) {
      setAttempted(true);
      (reasonValid ? otherRef : reasonRef).current?.focus();
      return;
    }
    setBusy(true);
    setError('');
    try {
      await submit(trimmed, sendTo === 'other' ? Number(otherId) : undefined);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title="Send back to developer"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleConfirm} aria-disabled={!valid} loading={busy}>
            Send back
          </Button>
        </>
      }
    >
      <p className={styles.issueMeta} style={{ marginTop: 0 }}>
        Task #{taskId} leaves the QA queue and goes to PM Feedback. The developer sees your reason at the top of the task until they
        submit again. This is not a QA rejection and does not count in QA numbers; their next submit counts as a first-time
        submission.
      </p>
      <label className={styles.label} htmlFor="sendBackReason">
        Reason (required)
      </label>
      <textarea
        id="sendBackReason"
        ref={reasonRef}
        className={styles.textarea}
        rows={4}
        maxLength={REASON_MAX}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        aria-required="true"
        aria-invalid={(reason.length > 0 || attempted) && !reasonValid}
        aria-describedby="sendBackReasonHint"
        placeholder="e.g. The description is not clear - add the expected behaviour"
      />
      <ReasonHint id="sendBackReasonHint" length={trimmed.length} min={REASON_MIN} max={REASON_MAX} attempted={attempted} />

      <fieldset style={{ border: 0, padding: 0, margin: 'var(--ds-space-3) 0 0' }}>
        <legend className={styles.label}>Send to</legend>
        {hasCurrent && (
          <label style={{ display: 'flex', gap: 'var(--ds-space-2)', alignItems: 'center', marginBottom: 'var(--ds-space-2)' }}>
            <input type="radio" name="sendBackTo" value="current" checked={sendTo === 'current'} onChange={() => setSendTo('current')} />
            Current developer - {currentDeveloper.name}
          </label>
        )}
        {canPickOther && (
          <>
            <label style={{ display: 'flex', gap: 'var(--ds-space-2)', alignItems: 'center', marginBottom: 'var(--ds-space-2)' }}>
              <input type="radio" name="sendBackTo" value="other" checked={sendTo === 'other'} onChange={() => setSendTo('other')} />
              {hasCurrent ? 'Another developer' : 'Pick a developer'}
            </label>
            {sendTo === 'other' && (
              <>
                <label className={styles.label} htmlFor="sendBackOther">
                  Developer
                </label>
                <select
                  id="sendBackOther"
                  ref={otherRef}
                  className={styles.input}
                  value={otherId}
                  onChange={(e) => setOtherId(e.target.value)}
                  aria-required="true"
                  aria-invalid={attempted && !otherId}
                  aria-describedby="sendBackOtherHint"
                >
                  <option value="">Choose a developer...</option>
                  {others.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
                <ChoiceHint id="sendBackOtherHint" show={attempted && !otherId}>
                  Choose the developer to send it to.
                </ChoiceHint>
              </>
            )}
          </>
        )}
        {!hasCurrent && !canPickOther && (
          <p className={styles.issueMeta} style={{ margin: 0 }}>
            This task has no developer - a Program Manager needs to pick who to send it to.
          </p>
        )}
      </fieldset>
      {error && (
        <div className={styles.error} role="alert" style={{ marginTop: 'var(--ds-space-3)', marginBottom: 0 }}>
          {error}
        </div>
      )}
    </Modal>
  );
}
