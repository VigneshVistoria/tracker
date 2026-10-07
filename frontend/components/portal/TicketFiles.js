import { useEffect, useId, useRef, useState } from 'react';
import { Download, FileText, Lock, Paperclip, X } from 'lucide-react';
import { apiBlob, apiDownload } from '../../lib/api';
import { FILE_ACCEPT, FILE_TYPES_HINT, checkFiles, formatBytes, isImage } from '../../lib/clientTickets';
import styles from '../../styles/portal.module.css';

// Attachments on client portal tickets (Stage 3).

// Choose files to attach. Controlled: `files` is an array of File.
export function FilePicker({ files, onChange, disabled = false }) {
  const id = useId();
  const input = useRef(null);
  const [error, setError] = useState('');

  const add = (e) => {
    const next = [...files, ...Array.from(e.target.files || [])];
    e.target.value = '';
    const problem = checkFiles(next);
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
        ref={input}
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
        <Paperclip size={16} aria-hidden="true" /> Attach files
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
              <button type="button" className={styles.chipRemove} onClick={() => remove(i)} aria-label={`Remove ${file.name}`}>
                <X size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Image preview loaded with the login token (attachments are never public).
function Thumbnail({ file }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let objectUrl = null;
    let cancelled = false;
    apiBlob(`/client-portal/attachments/${file.id}`)
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
  if (!url) return <span className={styles.thumbPlaceholder} aria-hidden="true" />;
  return <img src={url} alt="" className={styles.thumb} />;
}

// Attached files with download buttons. `showUploader` adds who/when.
export function FileList({ files, showUploader = true }) {
  const [error, setError] = useState('');
  if (!files || files.length === 0) return null;

  const download = async (file) => {
    setError('');
    try {
      await apiDownload(`/client-portal/attachments/${file.id}`, file.fileName);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <>
      <ul className={styles.fileList} aria-label="Attached files">
        {files.map((file) => (
          <li key={file.id} className={`${styles.fileRow} ${file.isInternal ? styles.fileInternal : ''}`}>
            {isImage(file.mimeType) ? <Thumbnail file={file} /> : <FileText size={20} className={styles.fileIcon} aria-hidden="true" />}
            <div className={styles.fileInfo}>
              <span className={styles.fileName}>{file.fileName}</span>
              <span className={styles.fileSize}>
                {formatBytes(file.sizeBytes)}
                {showUploader && file.uploadedByName ? ` · ${file.uploadedByName}` : ''}
                {file.isInternal && (
                  <>
                    {' · '}
                    <Lock size={11} aria-hidden="true" /> Team only
                  </>
                )}
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
