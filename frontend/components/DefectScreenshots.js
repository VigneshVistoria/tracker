import { useEffect, useState } from 'react';
import Modal from './ui/Modal';
import styles from '../styles/issues.module.css';
import { apiBlob, apiFetch } from '../lib/api';

// Image loaded with the login token - defect screenshots are never public,
// so a plain <img src> to the API can't work.
function useAuthedImage(attachmentId) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let objectUrl = null;
    let cancelled = false;
    apiBlob(`/tasks/attachments/${attachmentId}`)
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
  }, [attachmentId]);
  return url;
}

function Thumbnail({ file, onOpen }) {
  const url = useAuthedImage(file.id);
  return (
    <li className={styles.screenshotItem}>
      <button type="button" className={styles.screenshotOpen} onClick={() => onOpen(file, url)} disabled={!url} aria-label={`View ${file.fileName}`}>
        {url ? <img src={url} alt="" className={styles.screenshotThumb} /> : <span className={styles.screenshotThumb} aria-hidden="true" />}
      </button>
      <span className={styles.screenshotName}>{file.fileName}</span>
    </li>
  );
}

// Screenshots QA attached when filing this defect (pasted or captured on
// Create Defect). Shown to anyone who can view the task; renders nothing
// when there are none.
export default function DefectScreenshots({ taskId }) {
  const [files, setFiles] = useState([]);
  const [open, setOpen] = useState(null);

  useEffect(() => {
    apiFetch(`/tasks/${taskId}/attachments`).then(setFiles).catch(() => setFiles([]));
  }, [taskId]);

  if (files.length === 0) return null;

  return (
    <div style={{ marginTop: 'var(--space-2)' }}>
      <span className={styles.issueMeta} id={`defectScreenshots-${taskId}`}>Screenshots:</span>
      <ul className={styles.screenshotList} aria-labelledby={`defectScreenshots-${taskId}`}>
        {files.map((file) => (
          <Thumbnail key={file.id} file={file} onOpen={(f, url) => setOpen({ file: f, url })} />
        ))}
      </ul>
      <Modal open={!!open} onClose={() => setOpen(null)} title={open?.file.fileName} size="lg">
        {open && <img src={open.url} alt={open.file.fileName} className={styles.screenshotPreview} />}
      </Modal>
    </div>
  );
}
