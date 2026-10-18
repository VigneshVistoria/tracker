import { useCallback, useEffect, useRef, useState } from 'react';
import { Trash2, Plus, ImagePlus } from 'lucide-react';
import Modal from './ui/Modal';
import Button from './ui/Button';
import styles from '../styles/issues.module.css';
import { apiFetch } from '../lib/api';
import { formatDate } from '../lib/formatDate';
import { MAX_SCREENSHOTS, prepareScreenshot, uploadDefectScreenshots } from '../lib/defectScreenshots';
import ReasonHint, { ChoiceHint } from './ReasonHint';

// Mirrors backend/src/tasks/return-to-qa.ts and dto/return-to-qa.dto.ts.
export const RETURNED_TO_QA_STATUS = 'Returned to QA';
const REASON_MIN = 10;
const TEXT_MAX = 1000;
// Mirrors QaArtifactType (task-qa-review-qa-artifact.entity.ts).
const EVIDENCE_TYPES = [
  'Test Case / Test Plan',
  'Test Execution Report',
  'Bug Report',
  'Screenshot',
  'Screen Recording / Video',
  'Log File',
  'Staging / Test Environment URL',
  'Regression Test Results',
  'Automated Test Run',
  'Sign-off / Acceptance Report',
];

// Return to QA (2026-10-18) on the task page:
//  - Program Manager, ticket with the developer: "Send back to QA".
//  - Ticket Returned to QA: who has it and why, for everyone; the QA it
//    was returned to (or a PM) sends it back to the developer; for a
//    defect that QA can also fix its evidence links and screenshots.
// Everything it shows comes from GET /tasks/:id/return-to-qa, so the
// rules live on the backend. `onChanged` reloads the page's task data.
export default function ReturnToQaPanel({ task, user, onChanged }) {
  const [state, setState] = useState(null);
  const [returnOpen, setReturnOpen] = useState(false);
  const [sendBackOpen, setSendBackOpen] = useState(false);

  const load = useCallback(() => {
    apiFetch(`/tasks/${task.id}/return-to-qa`).then(setState).catch(() => setState(null));
  }, [task.id]);
  useEffect(load, [load, task.status]);

  if (!state) return null;
  const returned = task.status === RETURNED_TO_QA_STATUS && state.current;
  if (!state.canReturn && !returned) return null;

  const done = async (message) => {
    setReturnOpen(false);
    setSendBackOpen(false);
    await onChanged(message);
    load();
  };

  return (
    <div className={styles.card} style={{ marginBottom: 'var(--space-4)', ...(returned ? { borderLeft: '4px solid var(--ds-color-warning)' } : {}) }} id="task-return-to-qa">
      <h2 className={styles.cardTitle}>{returned ? 'With QA' : 'Send back to QA'}</h2>
      {returned ? (
        <>
          <p className={styles.issueMeta} style={{ marginTop: 0 }}>
            {state.current.returnedByEmail} sent this back to {state.current.qaEmail} on {formatDate(state.current.returnedAt)}.
          </p>
          <p style={{ whiteSpace: 'pre-wrap', marginTop: 0 }}>{state.current.reason}</p>
          <p className={styles.helpText}>
            {state.canEditEvidence
              ? 'Fix the details, evidence and screenshots below, then send it back to the developer.'
              : state.canSendBack
                ? 'When QA is done, it goes back to the developer in Development.'
                : 'The developer can carry on once QA sends it back. Days with QA do not count against the developer.'}
          </p>
          {state.canEditEvidence && <EvidenceEditor taskId={task.id} onChanged={() => onChanged()} />}
          {state.canSendBack && (
            <div className={styles.actions}>
              <button className={styles.buttonSecondary} type="button" onClick={() => setSendBackOpen(true)}>
                Send back to developer
              </button>
            </div>
          )}
          <SendBackModal
            open={sendBackOpen}
            taskId={task.id}
            onClose={() => setSendBackOpen(false)}
            submit={async (note) => {
              await apiFetch(`/tasks/${task.id}/return-to-qa/send-back`, { method: 'PATCH', body: JSON.stringify(note ? { note } : {}) });
              await done(`#${task.id} sent back to the developer`);
            }}
          />
        </>
      ) : (
        <>
          <p className={styles.helpText} style={{ marginTop: 0 }}>
            Something QA needs to fix first - for example the wrong evidence was attached? Send it back to QA with a reason. The developer
            can&apos;t submit it until QA returns it, and the days it spends with QA don&apos;t count against them.
          </p>
          <div className={styles.actions}>
            <button className={styles.buttonSecondary} type="button" onClick={() => setReturnOpen(true)}>
              Send back to QA
            </button>
          </div>
          <ReturnModal
            open={returnOpen}
            task={task}
            defaultQa={state.defaultQa}
            onClose={() => setReturnOpen(false)}
            submit={async (reason, qaUserId) => {
              await apiFetch(`/tasks/${task.id}/return-to-qa`, { method: 'PATCH', body: JSON.stringify({ reason, ...(qaUserId ? { qaUserId } : {}) }) });
              await done(`#${task.id} sent back to QA`);
            }}
          />
        </>
      )}
    </div>
  );
}

function ReturnModal({ open, task, defaultQa, onClose, submit }) {
  const [reason, setReason] = useState('');
  const [qaId, setQaId] = useState('');
  const [qaUsers, setQaUsers] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Set when the button is clicked with something missing - shows the hints.
  const [attempted, setAttempted] = useState(false);
  const reasonRef = useRef(null);
  const qaRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setReason('');
    setQaId(defaultQa ? String(defaultQa.id) : '');
    setAttempted(false);
    setError('');
    setBusy(false);
    apiFetch('/users/assignable?role=qa')
      .then((rows) => setQaUsers(rows.map((u) => ({ id: u.id, name: u.fullName || u.email })).sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => setQaUsers([]));
  }, [open, defaultQa]);

  const trimmed = reason.trim();
  const reasonValid = trimmed.length >= REASON_MIN && trimmed.length <= TEXT_MAX;
  const valid = reasonValid && !!qaId;

  const handleConfirm = async () => {
    if (busy) return;
    if (!valid) {
      setAttempted(true);
      (reasonValid ? qaRef : reasonRef).current?.focus();
      return;
    }
    setBusy(true);
    setError('');
    try {
      await submit(trimmed, Number(qaId));
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title="Send back to QA"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} aria-disabled={!valid} loading={busy}>
            Send back to QA
          </Button>
        </>
      }
    >
      <p className={styles.issueMeta} style={{ marginTop: 0 }}>
        #{task.id} moves to Returned to QA. The QA and the developer see your reason; the developer can&apos;t submit it until QA sends it
        back.
      </p>
      <label className={styles.label} htmlFor="returnToQaReason">
        Reason (required)
      </label>
      <textarea
        id="returnToQaReason"
        ref={reasonRef}
        className={styles.textarea}
        rows={4}
        maxLength={TEXT_MAX}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        aria-required="true"
        aria-invalid={(reason.length > 0 || attempted) && !reasonValid}
        aria-describedby="returnToQaReasonHint"
        placeholder="e.g. The wrong evidence is attached - please replace it"
      />
      <ReasonHint id="returnToQaReasonHint" length={trimmed.length} min={REASON_MIN} max={TEXT_MAX} attempted={attempted} />
      <label className={styles.label} htmlFor="returnToQaUser">
        Send to
      </label>
      <select
        id="returnToQaUser"
        ref={qaRef}
        className={styles.input}
        value={qaId}
        onChange={(e) => setQaId(e.target.value)}
        aria-required="true"
        aria-invalid={attempted && !qaId}
        aria-describedby="returnToQaUserHint"
      >
        {!defaultQa && <option value="">Choose a QA...</option>}
        {defaultQa && <option value={defaultQa.id}>{defaultQa.fullName || defaultQa.email} ({task.isDefect ? 'raised this defect' : 'last reviewed it'})</option>}
        {qaUsers
          .filter((u) => u.id !== defaultQa?.id)
          .map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
      </select>
      <ChoiceHint id="returnToQaUserHint" show={attempted && !qaId}>
        Choose the QA to send it to.
      </ChoiceHint>
      {!defaultQa && (
        <p className={styles.issueMeta} style={{ marginBottom: 0 }}>
          No QA has worked on this yet - pick one on its project.
        </p>
      )}
      {error && (
        <div className={styles.error} role="alert" style={{ marginTop: 'var(--ds-space-3)', marginBottom: 0 }}>
          {error}
        </div>
      )}
    </Modal>
  );
}

function SendBackModal({ open, taskId, onClose, submit }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setNote('');
      setError('');
      setBusy(false);
    }
  }, [open]);

  const handleConfirm = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await submit(note.trim());
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
          <Button onClick={handleConfirm} loading={busy}>
            Send back
          </Button>
        </>
      }
    >
      <p className={styles.issueMeta} style={{ marginTop: 0 }}>
        #{taskId} goes back to Development. The developer and the Program Manager are notified.
      </p>
      <label className={styles.label} htmlFor="returnSendBackNote">
        Note for the developer (optional)
      </label>
      <textarea
        id="returnSendBackNote"
        className={styles.textarea}
        rows={3}
        maxLength={TEXT_MAX}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="e.g. Evidence replaced with the right recording"
      />
      {error && (
        <div className={styles.error} role="alert" style={{ marginTop: 'var(--ds-space-3)', marginBottom: 0 }}>
          {error}
        </div>
      )}
    </Modal>
  );
}

// The QA a defect was returned to: remove wrong evidence links and
// screenshots, add the right ones.
function EvidenceEditor({ taskId, onChanged }) {
  const [artifacts, setArtifacts] = useState([]);
  const [shots, setShots] = useState([]);
  const [type, setType] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileInput = useRef(null);

  const load = useCallback(() => {
    apiFetch(`/tasks/${taskId}/defect-artifacts`).then(setArtifacts).catch(() => setArtifacts([]));
    apiFetch(`/tasks/${taskId}/attachments`).then(setShots).catch(() => setShots([]));
  }, [taskId]);
  useEffect(load, [load]);

  const run = async (fn) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      load();
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const usedTypes = new Set(artifacts.map((a) => a.type));

  return (
    <div style={{ margin: 'var(--ds-space-3) 0' }}>
      <h3 className={styles.label} style={{ marginBottom: 'var(--ds-space-2)' }}>
        Evidence links
      </h3>
      {artifacts.length === 0 && <p className={styles.issueMeta}>No evidence links.</p>}
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {artifacts.map((a) => (
          <li key={a.id} style={{ display: 'flex', gap: 'var(--ds-space-2)', alignItems: 'center', marginBottom: 'var(--ds-space-2)' }}>
            <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
              <strong>{a.type}:</strong>{' '}
              <a href={a.url} target="_blank" rel="noopener noreferrer">
                {a.url}
              </a>
            </span>
            <Button
              variant="ghost"
              size="sm"
              leftIcon={Trash2}
              disabled={busy}
              aria-label={`Remove ${a.type} evidence`}
              onClick={() => run(() => apiFetch(`/tasks/${taskId}/defect-artifacts/${a.id}`, { method: 'DELETE' }))}
            >
              Remove
            </Button>
          </li>
        ))}
      </ul>
      <form
        style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--ds-space-2)', alignItems: 'flex-end', marginTop: 'var(--ds-space-2)' }}
        onSubmit={(e) => {
          e.preventDefault();
          if (!type || !url.trim()) return;
          run(async () => {
            await apiFetch(`/tasks/${taskId}/defect-artifacts`, { method: 'POST', body: JSON.stringify({ type, url: url.trim() }) });
            setType('');
            setUrl('');
          });
        }}
      >
        <div>
          <label className={styles.label} htmlFor="evidenceType">
            Type
          </label>
          <select id="evidenceType" className={styles.input} value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">Choose...</option>
            {EVIDENCE_TYPES.filter((t) => !usedTypes.has(t)).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div style={{ flex: '1 1 240px' }}>
          <label className={styles.label} htmlFor="evidenceUrl">
            Link
          </label>
          <input id="evidenceUrl" className={styles.input} type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." />
        </div>
        <Button type="submit" variant="secondary" leftIcon={Plus} disabled={busy || !type || !url.trim()}>
          Add evidence
        </Button>
      </form>

      <h3 className={styles.label} style={{ margin: 'var(--ds-space-4) 0 var(--ds-space-2)' }}>
        Screenshots
      </h3>
      {shots.length === 0 && <p className={styles.issueMeta}>No screenshots.</p>}
      {shots.length > 0 && (
        <>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {shots.map((s) => (
              <li key={s.id} style={{ display: 'flex', gap: 'var(--ds-space-2)', alignItems: 'center', marginBottom: 'var(--ds-space-2)' }}>
                <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{s.fileName}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  leftIcon={Trash2}
                  disabled={busy}
                  aria-label={`Remove screenshot ${s.fileName}`}
                  onClick={() => run(() => apiFetch(`/tasks/${taskId}/attachments/${s.id}`, { method: 'DELETE' }))}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
      {shots.length < MAX_SCREENSHOTS && (
        <>
          <Button type="button" variant="secondary" leftIcon={ImagePlus} disabled={busy} onClick={() => fileInput.current?.click()}>
            Add screenshot
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              run(async () => {
                const blob = await prepareScreenshot(file);
                await uploadDefectScreenshots(taskId, [{ blob, name: file.name }]);
              });
            }}
          />
        </>
      )}
      {error && (
        <div className={styles.error} role="alert" style={{ marginTop: 'var(--ds-space-3)' }}>
          {error}
        </div>
      )}
    </div>
  );
}
