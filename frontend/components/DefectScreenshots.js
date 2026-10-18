import { useEffect, useState } from 'react';
import Modal from './ui/Modal';
import styles from '../styles/issues.module.css';
import { apiBlob, apiFetch } from '../lib/api';

// Image loaded with the login token - defect screenshots are never public,
// so a plain <img src> to the API can't work.
function useAuthedImage(path) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let objectUrl = null;
    let cancelled = false;
    apiBlob(path)
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
  }, [path]);
  return url;
}

function Thumbnail({ file, filePath, onOpen }) {
  const url = useAuthedImage(filePath(file.id));
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

  useEffect(() => {
    apiFetch(`/tasks/${taskId}/attachments`).then(setFiles).catch(() => setFiles([]));
  }, [taskId]);

  return <ScreenshotGallery id={`defectScreenshots-${taskId}`} files={files} filePath={(id) => `/tasks/attachments/${id}`} />;
}

// Thumbnails (click to enlarge) for any list of stored screenshots -
// `filePath(id)` is the API path that serves one. Renders nothing for an
// empty list. Also used for QA decision screenshots (ReviewTimeline).
export function ScreenshotGallery({ id, files, filePath, label = 'Screenshots:' }) {
  const [open, setOpen] = useState(null);
  if (!files || files.length === 0) return null;
  return (
    <div style={{ marginTop: 'var(--space-2)' }}>
      <span className={styles.issueMeta} id={id}>{label}</span>
      <ul className={styles.screenshotList} aria-labelledby={id}>
        {files.map((file) => (
          <Thumbnail key={file.id} file={file} filePath={filePath} onOpen={(f, url) => setOpen({ file: f, url })} />
        ))}
      </ul>
      <Modal open={!!open} onClose={() => setOpen(null)} title={open?.file.fileName} size="lg">
        {open && <img src={open.url} alt={open.file.fileName} className={styles.screenshotPreview} />}
      </Modal>
    </div>
  );
}
