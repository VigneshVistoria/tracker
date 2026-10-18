import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Camera, ImagePlus, PenLine, X } from 'lucide-react';
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

// Several boxes can be on one page (a QA decision plus each linked defect,
// 2026-10-18). Ctrl+V goes to ONE of them: the box whose section of the
// page (its closest [data-screenshot-scope], else the box itself) was
// last clicked or typed in; before any of that, the first box on the page.
const boxes = new Map(); // id -> () => the box's scope element
let activeBoxId = null;
let tracking = false;
function scopeOf(id) {
  return boxes.get(id)?.() || null;
}
// The innermost section wins: a linked-defect row inside the QA card
// takes the paste, not the card around it.
function trackActivity(e) {
  let best = null;
  for (const id of boxes.keys()) {
    const scope = scopeOf(id);
    if (scope && scope.contains(e.target) && (!best || best.scope.contains(scope))) best = { id, scope };
  }
  if (best) activeBoxId = best.id;
}
function pasteTarget() {
  if (activeBoxId && boxes.has(activeBoxId) && scopeOf(activeBoxId)?.isConnected) return activeBoxId;
  let first = null;
  for (const id of boxes.keys()) {
    const scope = scopeOf(id);
    if (!scope?.isConnected) continue;
    if (!first || first.scope.compareDocumentPosition(scope) & Node.DOCUMENT_POSITION_PRECEDING) first = { id, scope };
  }
  return first?.id ?? null;
}
function register(id, getScope) {
  boxes.set(id, getScope);
  if (!tracking) {
    document.addEventListener('pointerdown', trackActivity, true);
    document.addEventListener('focusin', trackActivity, true);
    tracking = true;
  }
  return () => {
    boxes.delete(id);
    if (activeBoxId === id) activeBoxId = null;
    if (boxes.size === 0 && tracking) {
      document.removeEventListener('pointerdown', trackActivity, true);
      document.removeEventListener('focusin', trackActivity, true);
      tracking = false;
    }
  };
}

// Screenshots for Create Defect and every QA action (2026-10-18): Capture
// screen (one frame, previewed first), paste (Ctrl+V), Choose file, or
// drag a file in - each can be marked up (highlight, arrow, blur, crop...)
// before it's sent. Controlled: `screenshots` is an array of
// { id, blob, name, url } kept in the page's state until the page uploads
// them. `children` (e.g. the page's own "+ Add Artifact" button) is
// rendered first in the same row. `itemNoun` names what they attach to
// ("defect", "decision") in the limit message; `hint` replaces the help
// line's last sentence.
export default function ScreenshotAttach({
  screenshots,
  onChange,
  disabled = false,
  children,
  max = MAX_SCREENSHOTS,
  itemNoun = 'defect',
  hint = "Screenshots aren't saved in drafts, so they'll be lost if you leave or refresh this page.",
}) {
  const boxId = useId();
  const rootRef = useRef(null);
  const fileInputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
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
    if (!replaceId && latest.current.length >= max) {
      setError(`You can attach at most ${max} screenshots to one ${itemNoun}.`);
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
    const unregister = register(boxId, () => rootRef.current?.closest('[data-screenshot-scope]') || rootRef.current);
    const onPaste = (e) => {
      if (pasteTarget() !== boxId) return;
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
    return () => {
      document.removeEventListener('paste', onPaste);
      unregister();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled]);

  // Choose file / drag and drop: images only, added one by one through the
  // same checks as a paste (type, size, the limit).
  const addFiles = async (fileList) => {
    const images = Array.from(fileList || []).filter((f) => f.type.startsWith('image/'));
    if (fileList?.length && images.length === 0) {
      setError('Only PNG, JPEG, WebP or GIF images can be attached.');
      return;
    }
    for (const file of images) {
      if (latest.current.length >= max) {
        setError(`You can attach at most ${max} screenshots to one ${itemNoun}.`);
        break;
      }
      // eslint-disable-next-line no-await-in-loop
      await add(file);
    }
  };
  const onDragOver = (e) => {
    if (disabled || !Array.from(e.dataTransfer?.types || []).includes('Files')) return;
    e.preventDefault();
    setDragOver(true);
  };
  const onDrop = (e) => {
    if (disabled) return;
    e.preventDefault();
    setDragOver(false);
    addFiles(e.dataTransfer?.files);
  };

  const capture = async () => {
    setError('');
    if (latest.current.length >= max) {
      setError(`You can attach at most ${max} screenshots to one ${itemNoun}.`);
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
    <div
      ref={rootRef}
      className={styles.screenshotAttach}
      onDragOver={onDragOver}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      style={dragOver ? { outline: '2px dashed var(--ds-border-focus)', outlineOffset: 4 } : undefined}
    >
      <div className={styles.screenshotControls}>
        {children}
        {captureSupported && (
          <button className={styles.buttonSecondary} type="button" onClick={capture} disabled={disabled || capturing}>
            <Camera size={16} aria-hidden="true" /> {capturing ? 'Choose a window or tab...' : 'Capture screen'}
          </button>
        )}
        <button className={styles.buttonSecondary} type="button" onClick={() => fileInputRef.current?.click()} disabled={disabled}>
          <ImagePlus size={16} aria-hidden="true" /> Choose file
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          hidden
          onChange={(e) => {
            const files = e.target.files;
            addFiles(files).finally(() => {
              e.target.value = '';
            });
          }}
        />
      </div>
      <p className={styles.helpText}>
        Or paste (Ctrl+V) or drag a screenshot here – up to {max}, 10 MB each. {hint}
      </p>
      {error && <p className={styles.fieldErrorText} role="alert">{error}</p>}
      {notice && <p className={styles.helpText}>{notice}</p>}
      <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
      {screenshots.length > 0 && <span className={styles.label} id={`${boxId}-label`} style={{ marginTop: 'var(--ds-space-3)' }}>Screenshots to attach</span>}
      {screenshots.length > 0 && (
        <ul className={styles.screenshotList} aria-labelledby={`${boxId}-label`} style={{ marginTop: 0 }}>
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
