import { useEffect, useId, useState } from 'react';
import { Download, FileText, Paperclip, X } from 'lucide-react';
import Modal from './ui/Modal';
import Button from './ui/Button';
import { apiBlob, apiDownload, apiFetch } from '../lib/api';
import { formatBytes, isImage } from '../lib/clientTickets';
import { formatDate } from '../lib/formatDate';
import {
  FILE_ACCEPT,
  FILE_TYPES_HINT,
  RESOLUTION_NOTE_MAX_LENGTH,
  canAddDependencyFiles,
  checkDependencyFiles,
  resolveDependencyTicket,
  uploadDependencyFiles,
} from '../lib/dependencyAttachments';
import styles from '../styles/dependencyAttachments.module.css';
import issueStyles from '../styles/issues.module.css';

// Dependency attachments (Stage 2 screens, 2026-11-14). Files on a
// dependency ticket - the requester's ('request') and the resolver's
// ('resolution') - plus the resolution note, who resolved it and the
// "Auto-resolved: ..." note. Behind the project's attachments switch;
// files already attached stay visible when it's off.

// Choose files. Controlled: `files` is an array of File.
export function DependencyFilePicker({ files, onChange, disabled = false, already = 0, label = 'Attach files' }) {
  const id = useId();
  const [error, setError] = useState('');

  const add = (e) => {
    const next = [...files, ...Array.from(e.target.files || [])];
    e.target.value = '';
    const problem = checkDependencyFiles(next, already);
    setError(problem || '');
    if (!problem) onChange(next);
  };

  const remove = (index) => {
    setError('');
    onChange(files.filter((_, i) => i !== index));
  };

  return (
    <div className={styles.filePicker}>
      <input
        id={`${id}-files`}
        type="file"
        multiple
        accept={FILE_ACCEPT}
        className="sr-only"
        onChange={add}
        disabled={disabled}
        aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`}
      />
      <label htmlFor={`${id}-files`} className={styles.attachButton}>
        <Paperclip size={16} aria-hidden="true" /> {label}
      </label>
      <p id={`${id}-hint`} className={styles.muted}>{FILE_TYPES_HINT}</p>
      {error && <p id={`${id}-error`} className={styles.fieldError} role="alert">{error}</p>}
      {files.length > 0 && (
        <ul className={styles.chosenFiles} aria-label="Files to attach">
          {files.map((file, i) => (
            <li key={`${file.name}-${i}`} className={styles.fileChip}>
              <FileText size={14} aria-hidden="true" />
              <span className={styles.fileName}>{file.name}</span>
              <span className={styles.fileSize}>{formatBytes(file.size)}</span>
              <button type="button" className={styles.chipRemove} onClick={() => remove(i)} disabled={disabled} aria-label={`Remove ${file.name}`}>
                <X size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Image preview fetched with the login token (files are never public).
function Thumbnail({ file }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let objectUrl = null;
    let cancelled = false;
    apiBlob(`/task-dependency-tickets/attachments/${file.id}`)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file.id]);
  if (!url) return <span className={styles.thumb} aria-hidden="true" />;
  return <img src={url} alt="" className={styles.thumb} />;
}

function FileRows({ files, label }) {
  const [error, setError] = useState('');
  const download = async (file) => {
    setError('');
    try {
      await apiDownload(`/task-dependency-tickets/attachments/${file.id}`, file.fileName);
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <>
      <ul className={styles.fileList} aria-label={label}>
        {files.map((file) => (
          <li key={file.id} className={styles.fileRow}>
            {isImage(file.mimeType) ? <Thumbnail file={file} /> : <FileText size={20} className={styles.fileIcon} aria-hidden="true" />}
            <div className={styles.fileInfo}>
              <span className={styles.fileName}>{file.fileName}</span>
              <span className={styles.fileSize}>
                {formatBytes(file.sizeBytes)}
                {file.uploadedByName ? ` · ${file.uploadedByName}` : ''}
                {file.createdAt ? ` · ${formatDate(file.createdAt)}` : ''}
              </span>
            </div>
            <button type="button" className={styles.iconAction} onClick={() => download(file)} aria-label={`Download ${file.fileName}`}>
              <Download size={16} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      {error && <p className={styles.fieldError} role="alert">{error}</p>}
    </>
  );
}

// Adds files to one side of an existing ticket (requester while open;
// resolver after Resolve).
function AddFiles({ ticket, side, already, onAdded }) {
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const upload = async () => {
    setBusy(true);
    setError('');
    try {
      const list = await uploadDependencyFiles(ticket.id, side, files);
      setFiles([]);
      onAdded(list);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={styles.addRow}>
      <DependencyFilePicker
        files={files}
        onChange={setFiles}
        disabled={busy}
        already={already}
        label={side === 'request' ? 'Add files to the request' : 'Add resolution files'}
      />
      {files.length > 0 && (
        <Button variant="secondary" onClick={upload} loading={busy} style={{ marginTop: 'var(--ds-space-2)' }}>
          Upload {files.length === 1 ? '1 file' : `${files.length} files`}
        </Button>
      )}
      {error && <p className={styles.fieldError} role="alert">{error}</p>}
    </div>
  );
}

// Who resolved it, the note, and both sides' files - shown on the parent
// task's ticket and on the dependency task's own page. `refreshKey` reloads
// the file list (e.g. after a Resolve with files).
export function DependencyTicketFiles({ ticket, user, attachmentsEnabled, refreshKey = 0 }) {
  const [files, setFiles] = useState([]);

  useEffect(() => {
    if (!ticket?.id) return undefined;
    let cancelled = false;
    apiFetch(`/task-dependency-tickets/${ticket.id}/attachments`)
      .then((list) => !cancelled && setFiles(list))
      .catch(() => !cancelled && setFiles([]));
    return () => {
      cancelled = true;
    };
  }, [ticket?.id, ticket?.status, refreshKey]);

  if (!ticket) return null;
  const requestFiles = files.filter((f) => f.side === 'request');
  const resolutionFiles = files.filter((f) => f.side === 'resolution');
  const addRequest = attachmentsEnabled && canAddDependencyFiles(ticket, 'request', user);
  const addResolution = attachmentsEnabled && canAddDependencyFiles(ticket, 'resolution', user);
  const resolved = ticket.status === 'resolved';

  return (
    <div className={styles.section}>
      {resolved && (ticket.systemNote || ticket.resolvedByName) && (
        <p className={issueStyles.issueMeta} style={{ margin: 0 }}>
          {ticket.systemNote || `Resolved by ${ticket.resolvedByName}${ticket.resolvedAt ? ` on ${formatDate(ticket.resolvedAt)}` : ''}`}
        </p>
      )}
      {resolved && ticket.resolutionNote && (
        <p className={styles.note}>
          <strong>Resolution note:</strong> {ticket.resolutionNote}
        </p>
      )}
      {(requestFiles.length > 0 || addRequest) && (
        <>
          <p className={styles.sideTitle}>Files from the requester</p>
          {requestFiles.length > 0 && <FileRows files={requestFiles} label={`Files from the requester of ${ticket.title}`} />}
          {addRequest && <AddFiles ticket={ticket} side="request" already={requestFiles.length} onAdded={setFiles} />}
        </>
      )}
      {(resolutionFiles.length > 0 || addResolution) && (
        <>
          <p className={styles.sideTitle}>Resolution files</p>
          {resolutionFiles.length > 0 && <FileRows files={resolutionFiles} label={`Resolution files of ${ticket.title}`} />}
          {addResolution && <AddFiles ticket={ticket} side="resolution" already={resolutionFiles.length} onAdded={setFiles} />}
        </>
      )}
    </div>
  );
}

// Resolve with an optional note and files (switch on), sent together -
// all or nothing. Errors stay in the dialog. `onResolved` gets the result.
export function DependencyResolveModal({ ticket, onClose, onResolved, consequence }) {
  const open = !!ticket;
  const [note, setNote] = useState('');
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setNote('');
      setFiles([]);
      setBusy(false);
      setError('');
    }
  }, [open, ticket?.id]);

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await resolveDependencyTicket(ticket.id, { note, files });
      await onResolved(result, files.length);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title="Resolve dependency"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Back
          </Button>
          <Button variant="primary" onClick={confirm} loading={busy}>
            Resolve
          </Button>
        </>
      }
    >
      {ticket && <p style={{ marginTop: 0, fontWeight: 600 }}>{ticket.title || `Ticket #${ticket.id}`}</p>}
      {consequence && <p className={issueStyles.issueMeta}>{consequence}</p>}
      <label className={issueStyles.label} htmlFor="dependencyResolutionNote">
        Resolution note (optional)
      </label>
      <textarea
        id="dependencyResolutionNote"
        className={issueStyles.textarea}
        rows={4}
        maxLength={RESOLUTION_NOTE_MAX_LENGTH}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        disabled={busy}
        placeholder="e.g. Endpoint deployed to staging - see the attached Postman export"
      />
      <DependencyFilePicker files={files} onChange={setFiles} disabled={busy} />
      <p className={styles.muted} style={{ marginTop: 'var(--ds-space-2)' }}>
        The requester sees the note and files on their task.
      </p>
      {error && (
        <div className={issueStyles.error} role="alert" style={{ marginTop: 'var(--ds-space-3)', marginBottom: 0 }}>
          {error}
        </div>
      )}
    </Modal>
  );
}
