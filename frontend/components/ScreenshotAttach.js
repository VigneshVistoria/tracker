import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, PenLine, X } from 'lucide-react';
import Modal from './ui/Modal';
import ScreenshotMarkup from './ScreenshotMarkup';
import styles from '../styles/issues.module.css';
import {
  MAX_SCREENSHOTS,
  captureScreenFrame,
  isScreenCaptureSupported,
  prepareScreenshotDetailed,
  screenshotFileName,
} from '../lib/defectScreenshots';

const isEditable = (el) => !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));

// Screenshots for Create Defect: paste an image anywhere on the page
// (Ctrl+V), or "Capture screen" (one frame, previewed first). Controlled:
// `screenshots` is an array of { id, blob, name, url } kept in the page's
// state until the defect is created - they're never in the draft.
// `children` (the page's own "+ Add Artifact" button) is rendered first in
// the same row, so Capture screen sits right next to it.
export default function ScreenshotAttach({ screenshots, onChange, disabled = false, children }) {
  const [captureSupported, setCaptureSupported] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [announcement, setAnnouncement] = useState('');
  // Markup in the preview dialog. Closing with marks asks first, inline
  // (confirmDiscard) - a second dialog on top would also catch the same
  // Esc press.
  const markupRef = useRef(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const latest = useRef(screenshots);
  latest.current = screenshots;

  // Decided after mount - the server render can't know the browser.
  useEffect(() => setCaptureSupported(isScreenCaptureSupported()), []);

  // Object URLs for thumbnails are freed when the form goes away.
  useEffect(() => () => latest.current.forEach((shot) => URL.revokeObjectURL(shot.url)), []);

  // Says what prepareScreenshotDetailed had to do to fit the limits.
  const describeResize = ({ resizedTo, convertedToJpeg }) => {
    if (!resizedTo && !convertedToJpeg) return '';
    const parts = [];
    if (resizedTo) parts.push(`resized to ${resizedTo.width}×${resizedTo.height}`);
    if (convertedToJpeg) parts.push('saved as JPEG');
    const text = parts.join(' and ');
    return `${text.charAt(0).toUpperCase()}${text.slice(1)} to fit the size limit.`;
  };

  // Adds a new screenshot, or (replaceId) swaps a pending one for its
  // marked-up version - the unmarked original is dropped, not kept.
  const add = async (blob, replaceId = null) => {
    setError('');
    setNotice('');
    if (!replaceId && latest.current.length >= MAX_SCREENSHOTS) {
      setError(`You can attach at most ${MAX_SCREENSHOTS} screenshots to one defect.`);
      return;
    }
    try {
      const result = await prepareScreenshotDetailed(blob);
      const prepared = result.blob;
      const resized = describeResize(result);
      const others = latest.current.filter((s) => s.id !== replaceId);
      const old = replaceId ? latest.current.find((s) => s.id === replaceId) : null;
      // A marked-up screenshot keeps its name (only the extension follows
      // the image type, which the server checks against the content).
      const name = old
        ? old.name.replace(/\.[a-z]+$/, `.${screenshotFileName(prepared.type).split('.').pop()}`)
        : screenshotFileName(prepared.type, others.map((s) => s.name));
      const shot = { id: replaceId || `${Date.now()}-${Math.random()}`, blob: prepared, name, url: URL.createObjectURL(prepared) };
      if (replaceId) {
        if (old) URL.revokeObjectURL(old.url);
        onChange(latest.current.map((s) => (s.id === replaceId ? shot : s)));
      } else {
        onChange([...latest.current, shot]);
      }
      setNotice(resized);
      setAnnouncement(`${replaceId ? 'Screenshot updated' : 'Screenshot added'}: ${name}${resized ? `. ${resized}` : ''}`);
    } catch (err) {
      setError(err.message);
    }
  };

  // Paste: only takes over when there's an image and nothing else to
  // paste into a text field - copying from Excel/Word puts text AND an
  // image on the clipboard, and that text must still land in the field.
  useEffect(() => {
    if (disabled) return undefined;
    const onPaste = (e) => {
      const items = Array.from(e.clipboardData?.items || []);
      const image = items.find((item) => item.kind === 'file' && item.type.startsWith('image/'));
      if (!image) return;
      const hasText = items.some((item) => item.kind === 'string' && (item.type === 'text/plain' || item.type === 'text/html'));
      if (hasText && isEditable(document.activeElement)) return;
      e.preventDefault();
      const file = image.getAsFile();
      if (file) add(file);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled]);

  const capture = async () => {
    setError('');
    if (latest.current.length >= MAX_SCREENSHOTS) {
      setError(`You can attach at most ${MAX_SCREENSHOTS} screenshots to one defect.`);
      return;
    }
    setCapturing(true);
    try {
      const blob = await captureScreenFrame();
      setPreview({ blob, captured: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setCapturing(false);
    }
  };

  // Opens a pending (pasted or attached) screenshot in the same dialog.
  const markUp = (shot) => {
    setError('');
    setPreview({ blob: shot.blob, replaceId: shot.id });
  };

  const closePreview = () => {
    setPreview(null);
    setConfirmDiscard(false);
    setPreviewError('');
  };

  // Esc, the X and clicking outside all come here - stable identity so the
  // dialog doesn't re-run its focus handling on every change.
  const requestClose = useCallback(() => {
    if (markupRef.current?.hasMarks()) setConfirmDiscard(true);
    else closePreview();
  }, []);

  // With marks: ONE flattened image replaces the original. Without:
  // exactly what was captured/pasted, as before.
  // If the marks can't be drawn in, the dialog stays open - attaching the
  // original instead would upload whatever Blur/Hide was meant to remove.
  const attachPreview = async () => {
    const { blob, replaceId } = preview;
    setPreviewError('');
    let marked = null;
    try {
      marked = await markupRef.current?.flatten();
    } catch (err) {
      setPreviewError(err.message);
      return;
    }
    closePreview();
    if (replaceId && !marked) return;
    await add(marked || blob, replaceId);
  };

  const remove = (shot) => {
    URL.revokeObjectURL(shot.url);
    onChange(latest.current.filter((s) => s.id !== shot.id));
    setAnnouncement(`Screenshot removed: ${shot.name}`);
  };

  return (
    <div className={styles.screenshotAttach}>
      <div className={styles.screenshotControls}>
        {children}
        {captureSupported && (
          <button className={styles.buttonSecondary} type="button" onClick={capture} disabled={disabled || capturing}>
            <Camera size={16} aria-hidden="true" /> {capturing ? 'Choose a window or tab...' : 'Capture screen'}
          </button>
        )}
      </div>
      <p className={styles.helpText}>
        Or paste a screenshot (Ctrl+V) anywhere on this page – up to {MAX_SCREENSHOTS}, 10 MB each. Screenshots
        aren&apos;t saved in drafts, so they&apos;ll be lost if you leave or refresh this page.
      </p>
      {error && <p className={styles.fieldErrorText} role="alert">{error}</p>}
      {notice && <p className={styles.helpText}>{notice}</p>}
      <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
      {screenshots.length > 0 && <span className={styles.label} id="ndScreenshotsLabel" style={{ marginTop: 'var(--ds-space-3)' }}>Screenshots to attach</span>}
      {screenshots.length > 0 && (
        <ul className={styles.screenshotList} aria-labelledby="ndScreenshotsLabel" style={{ marginTop: 0 }}>
          {screenshots.map((shot) => (
            <li key={shot.id} className={styles.screenshotItem}>
              <img src={shot.url} alt={shot.name} className={styles.screenshotThumb} />
              <span className={styles.screenshotName}>{shot.name}</span>
              <button
                type="button"
                className={styles.screenshotMarkUp}
                onClick={() => markUp(shot)}
                disabled={disabled}
                title={`Mark up ${shot.name} - highlight, annotate or blur it`}
              >
                <PenLine size={14} aria-hidden="true" /> Mark up
              </button>
              <button
                type="button"
                className={styles.screenshotRemove}
                onClick={() => remove(shot)}
                disabled={disabled}
                aria-label={`Remove ${shot.name}`}
              >
                <X size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={!!preview}
        onClose={requestClose}
        title={preview?.replaceId ? 'Mark up screenshot' : 'Attach this screenshot?'}
        size="xl"
        footer={
          confirmDiscard ? (
            <div className={styles.markupConfirm} role="alert">
              <span>{preview?.replaceId ? 'Discard your marks? The screenshot stays as it was.' : 'Discard this screenshot and your marks?'}</span>
              <button className={styles.buttonSecondary} type="button" onClick={() => setConfirmDiscard(false)}>
                Keep editing
              </button>
              <button className={`${styles.button} ${styles.buttonAccent}`} type="button" onClick={closePreview}>
                Discard
              </button>
            </div>
          ) : (
            <>
              <button className={styles.buttonSecondary} type="button" onClick={requestClose}>
                {preview?.replaceId ? 'Cancel' : 'Discard'}
              </button>
              <button className={`${styles.button} ${styles.buttonAccent}`} type="button" onClick={attachPreview}>
                {preview?.replaceId ? 'Save markup' : 'Attach'}
              </button>
            </>
          )
        }
      >
        {preview?.captured && (
          <p className={styles.helpText} style={{ marginTop: 0 }}>
            Only this image is attached. Screen sharing has already stopped.
          </p>
        )}
        {previewError && <p className={styles.fieldErrorText} role="alert">{previewError}</p>}
        {preview && <ScreenshotMarkup ref={markupRef} blob={preview.blob} />}
      </Modal>
    </div>
  );
}
