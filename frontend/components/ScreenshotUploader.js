import { useState } from 'react';
import { ImagePlus } from 'lucide-react';
import ScreenshotAttach from './ScreenshotAttach';
import styles from '../styles/issues.module.css';
import { apiUpload } from '../lib/api';

// The shared screenshot box for something that already exists (an existing
// defect, a defect returned to QA): pick/capture/paste/mark up, then
// "Attach" uploads them to `uploadPath` (multipart, field "files").
// `collapsed` starts as just an "Add screenshots" button. `onUploaded`
// gets the server's response so the page can refresh what it shows.
export default function ScreenshotUploader({ uploadPath, onUploaded, collapsed = false, max, itemNoun = 'defect', label = 'Add screenshots' }) {
  const [open, setOpen] = useState(!collapsed);
  const [shots, setShots] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!open) {
    return (
      <div className={styles.actions} style={{ marginTop: 'var(--space-3)' }}>
        <button className={styles.buttonSecondary} type="button" onClick={() => setOpen(true)}>
          <ImagePlus size={16} aria-hidden="true" /> {label}
        </button>
      </div>
    );
  }

  const attach = async () => {
    if (!shots.length || busy) return;
    setBusy(true);
    setError('');
    try {
      const form = new FormData();
      for (const shot of shots) form.append('files', shot.blob, shot.name);
      const result = await apiUpload(uploadPath, form);
      shots.forEach((s) => URL.revokeObjectURL(s.url));
      setShots([]);
      if (collapsed) setOpen(false);
      onUploaded?.(result);
    } catch (err) {
      // Kept on screen so nothing is lost - try again or remove some.
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginTop: 'var(--space-3)' }} data-screenshot-scope>
      <ScreenshotAttach
        screenshots={shots}
        onChange={setShots}
        disabled={busy}
        max={max}
        itemNoun={itemNoun}
        hint="They're attached when you click Attach."
      />
      {error && (
        <p className={styles.fieldErrorText} role="alert">
          {error}
        </p>
      )}
      <div className={styles.actions}>
        <button className={`${styles.button} ${styles.buttonAccent}`} type="button" onClick={attach} disabled={busy || shots.length === 0}>
          {busy ? 'Attaching...' : shots.length ? `Attach ${shots.length} screenshot${shots.length === 1 ? '' : 's'}` : 'Attach screenshots'}
        </button>
        {collapsed && (
          <button
            className={styles.buttonSecondary}
            type="button"
            disabled={busy}
            onClick={() => {
              shots.forEach((s) => URL.revokeObjectURL(s.url));
              setShots([]);
              setError('');
              setOpen(false);
            }}
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
