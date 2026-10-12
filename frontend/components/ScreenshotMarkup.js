import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ArrowUpRight, Check, Crop, EyeOff, Grid3x3, Pencil, Redo2, RotateCcw, Square, Trash2, Type, Undo2, X } from 'lucide-react';
import ScreenshotCropBox, { MIN_CROP } from './ScreenshotCropBox';
import styles from '../styles/issues.module.css';

// Markup for a screenshot before it's attached (the "Attach this
// screenshot?" dialog). Two canvases at the image's own resolution - the
// image, and a layer on top that the marks are drawn on - scaled down
// together by CSS.
// Marks are kept as a list in image pixels, so undo/redo is just the list,
// and flatten() draws them into ONE new image at full resolution. Blur and
// Hide destroy the pixels underneath when flattened (block-averaged mosaic
// / solid box), so the hidden content is not in the uploaded file at all.
//
// Crop is one more value in the same history ({ marks, crop }), in image
// pixels - the image itself is never cut while editing, so Reset and Undo
// can bring it back. Only the crop area is shown, and flatten() copies only
// that area into the new image: what was cropped out is not in the
// uploaded file.

const TOOLS = [
  { id: 'rect', label: 'Rectangle', icon: Square, hint: 'Drag to draw a box around an area' },
  { id: 'arrow', label: 'Arrow', icon: ArrowUpRight, hint: 'Drag from the tail to the point' },
  { id: 'pen', label: 'Pen', icon: Pencil, hint: 'Draw freehand' },
  { id: 'text', label: 'Text', icon: Type, hint: 'Click where the note should go, type, then press Enter' },
  { id: 'blur', label: 'Blur', icon: Grid3x3, hint: 'Drag over private details - permanent once attached' },
  { id: 'hide', label: 'Hide', icon: EyeOff, hint: 'Drag to cover with a solid box - permanent once attached' },
];
const COLOURS = [
  { id: 'red', label: 'Red', value: '#dc2626' },
  { id: 'yellow', label: 'Yellow', value: '#facc15' },
];
// Thickness in screen pixels - converted to image pixels when drawing, so
// "Medium" looks the same on a small paste and a 4K capture.
const THICKNESS = [
  { id: 'thin', label: 'Thin', px: 2, font: 16 },
  { id: 'medium', label: 'Medium', px: 4, font: 22 },
  { id: 'thick', label: 'Thick', px: 7, font: 30 },
];
const MIN_MOSAIC_BLOCK = 16;

// Width of a text note as drawn (font as in drawMark), so a crop can tell
// whether the note is inside it.
let measureCtx = null;
function textWidth(text, size) {
  measureCtx = measureCtx || document.createElement('canvas').getContext('2d');
  measureCtx.font = `600 ${size}px system-ui, sans-serif`;
  return measureCtx.measureText(text).width;
}

// The area a mark covers, line width (and arrow head) included.
function markBounds(m) {
  if (m.type === 'text') {
    const pad = Math.max(2, m.size / 6);
    return { x1: m.x - pad, y1: m.y - pad, x2: m.x + (m.w ?? m.text.length * m.size * 0.6) + pad, y2: m.y + m.size * 1.2 + pad };
  }
  const xs = m.type === 'pen' ? m.points.map((p) => p[0]) : [m.x1, m.x2];
  const ys = m.type === 'pen' ? m.points.map((p) => p[1]) : [m.y1, m.y2];
  const pad = m.type === 'arrow' ? m.width * 4 + 8 : (m.width || 0) / 2;
  return { x1: Math.min(...xs) - pad, y1: Math.min(...ys) - pad, x2: Math.max(...xs) + pad, y2: Math.max(...ys) + pad };
}

const insideCrop = (m, c) => {
  const b = markBounds(m);
  return b.x2 > c.x && b.x1 < c.x + c.w && b.y2 > c.y && b.y1 < c.y + c.h;
};

function normaliseRect(m) {
  return {
    x: Math.round(Math.min(m.x1, m.x2)),
    y: Math.round(Math.min(m.y1, m.y2)),
    w: Math.round(Math.abs(m.x2 - m.x1)),
    h: Math.round(Math.abs(m.y2 - m.y1)),
  };
}

// Replaces the area with blocks of its own average colour - at least 16
// image pixels, and bigger for bigger areas (at most ~12 blocks across),
// so text inside can't be read or reconstructed.
function mosaic(ctx, source, r) {
  const x = Math.max(0, r.x);
  const y = Math.max(0, r.y);
  const w = Math.min(source.width - x, r.w);
  const h = Math.min(source.height - y, r.h);
  if (w <= 0 || h <= 0) return;
  const block = Math.max(MIN_MOSAIC_BLOCK, Math.ceil(Math.max(w, h) / 12));
  const data = source.getContext('2d').getImageData(x, y, w, h).data;
  for (let by = 0; by < h; by += block) {
    for (let bx = 0; bx < w; bx += block) {
      let rs = 0;
      let gs = 0;
      let bs = 0;
      let n = 0;
      const bw = Math.min(block, w - bx);
      const bh = Math.min(block, h - by);
      for (let py = by; py < by + bh; py += 1) {
        for (let px = bx; px < bx + bw; px += 1) {
          const i = (py * w + px) * 4;
          rs += data[i];
          gs += data[i + 1];
          bs += data[i + 2];
          n += 1;
        }
      }
      ctx.fillStyle = `rgb(${Math.round(rs / n)}, ${Math.round(gs / n)}, ${Math.round(bs / n)})`;
      ctx.fillRect(x + bx, y + by, bw, bh);
    }
  }
}

// Draws one mark. `source` is the canvas whose pixels Blur averages.
function drawMark(ctx, m, source) {
  ctx.save();
  ctx.strokeStyle = m.colour;
  ctx.fillStyle = m.colour;
  ctx.lineWidth = m.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (m.type === 'rect') {
    const r = normaliseRect(m);
    ctx.strokeRect(r.x, r.y, r.w, r.h);
  } else if (m.type === 'arrow') {
    const angle = Math.atan2(m.y2 - m.y1, m.x2 - m.x1);
    const head = m.width * 4 + 8;
    ctx.beginPath();
    ctx.moveTo(m.x1, m.y1);
    ctx.lineTo(m.x2 - Math.cos(angle) * head * 0.6, m.y2 - Math.sin(angle) * head * 0.6);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(m.x2, m.y2);
    ctx.lineTo(m.x2 - head * Math.cos(angle - Math.PI / 7), m.y2 - head * Math.sin(angle - Math.PI / 7));
    ctx.lineTo(m.x2 - head * Math.cos(angle + Math.PI / 7), m.y2 - head * Math.sin(angle + Math.PI / 7));
    ctx.closePath();
    ctx.fill();
  } else if (m.type === 'pen') {
    ctx.beginPath();
    m.points.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
    if (m.points.length === 1) ctx.lineTo(m.points[0][0] + 0.1, m.points[0][1]);
    ctx.stroke();
  } else if (m.type === 'text') {
    ctx.font = `600 ${m.size}px system-ui, sans-serif`;
    ctx.textBaseline = 'top';
    // Contrasting outline so the note reads on light and dark areas.
    ctx.lineWidth = Math.max(2, m.size / 6);
    ctx.strokeStyle = m.colour === '#facc15' ? '#000000' : '#ffffff';
    ctx.strokeText(m.text, m.x, m.y);
    ctx.fillText(m.text, m.x, m.y);
  } else if (m.type === 'blur') {
    mosaic(ctx, source, normaliseRect(m));
  } else if (m.type === 'hide') {
    const r = normaliseRect(m);
    ctx.fillStyle = '#000000';
    ctx.fillRect(r.x, r.y, r.w, r.h);
  }
  ctx.restore();
}

const ScreenshotMarkup = forwardRef(function ScreenshotMarkup({ blob }, ref) {
  const baseRef = useRef(null);
  const marksRef = useRef(null);
  const wrapRef = useRef(null);
  const draftRef = useRef(null);
  const [size, setSize] = useState(null);
  const [tool, setTool] = useState('rect');
  const [colour, setColour] = useState(COLOURS[0]);
  const [thickness, setThickness] = useState(THICKNESS[1]);
  // History: `marks` and `crop` are the current state; undo/redo hold
  // earlier and undone { marks, crop } states (so Clear all, a crop and
  // Reset to original are all undoable). One state object, always updated
  // from the previous one, so two commits in one event can't overwrite
  // each other.
  const [history, setHistory] = useState({ marks: [], crop: null, undo: [], redo: [] });
  const { marks, crop } = history;
  // Read by hasMarks() - current as of the last render, so an Esc pressed
  // straight after drawing still sees the new mark.
  const nowRef = useRef(history);
  nowRef.current = history;
  const [textAt, setTextAt] = useState(null);
  const [textValue, setTextValue] = useState('');
  const [loadError, setLoadError] = useState('');
  // Crop mode: the box being adjusted (image pixels), or null.
  const [cropBox, setCropBox] = useState(null);
  const cropBoxRef = useRef(cropBox);
  cropBoxRef.current = cropBox;
  // Keyboard focus: into the crop box when cropping starts, back to the
  // Crop button when it ends (the box it was on is gone).
  const cropButtonRef = useRef(null);
  const wasCropping = useRef(false);
  useEffect(() => {
    if (cropBox && !wasCropping.current) wrapRef.current?.querySelector('[data-crop="box"]')?.focus();
    if (!cropBox && wasCropping.current) cropButtonRef.current?.focus();
    wasCropping.current = !!cropBox;
  }, [cropBox]);
  // Height left for the image once the toolbar, header and footer are in.
  const [fitHeight, setFitHeight] = useState(null);

  // The part of the image on screen (and in the attached file).
  const view = size ? crop || { x: 0, y: 0, w: size.w, h: size.h } : null;

  useEffect(() => {
    let bitmap = null;
    let cancelled = false;
    createImageBitmap(blob)
      .then((b) => {
        if (cancelled) {
          b.close?.();
          return;
        }
        bitmap = b;
        const base = baseRef.current;
        base.width = b.width;
        base.height = b.height;
        base.getContext('2d').drawImage(b, 0, 0);
        setSize({ w: b.width, h: b.height });
      })
      .catch(() => setLoadError('This image could not be opened for markup.'));
    return () => {
      cancelled = true;
      bitmap?.close?.();
    };
  }, [blob]);

  // Drawn exactly like flatten(): the whole image, then each mark in turn,
  // so a Blur over an earlier box averages the box too, as it will once
  // attached. The finished marks are kept in `committedRef` (full size), so
  // a drag only redraws the mark being drawn - several Blurs on a big
  // capture stay smooth. The screen shows the `view` part of it.
  const committedRef = useRef(null);
  useEffect(() => {
    if (!size) return;
    const c = committedRef.current || document.createElement('canvas');
    c.width = size.w;
    c.height = size.h;
    const ctx = c.getContext('2d');
    ctx.drawImage(baseRef.current, 0, 0);
    for (const m of marks) drawMark(ctx, m, c);
    committedRef.current = c;
  }, [marks, size]);

  const redraw = useCallback(() => {
    const canvas = marksRef.current;
    if (!canvas || !view || !committedRef.current) return;
    if (canvas.width !== view.w) canvas.width = view.w;
    if (canvas.height !== view.h) canvas.height = view.h;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(committedRef.current, view.x, view.y, view.w, view.h, 0, 0, view.w, view.h);
    if (draftRef.current) {
      ctx.save();
      ctx.translate(-view.x, -view.y);
      drawMark(ctx, draftRef.current, committedRef.current);
      ctx.restore();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marks, size, view?.x, view?.y, view?.w, view?.h]);

  useEffect(redraw, [redraw]);

  // Fits the whole image in the dialog: everything else in it (header,
  // toolbar, hint, footer) is measured, and the image gets what's left of
  // the dialog's maximum height - re-measured when the window resizes or
  // the toolbar wraps differently. At least 200px; below that the dialog
  // scrolls.
  useEffect(() => {
    const stage = wrapRef.current;
    const dialog = stage?.closest('[role="dialog"]');
    if (!dialog) return undefined;
    let scroller = stage.parentElement;
    while (scroller && scroller !== dialog && getComputedStyle(scroller).overflowY !== 'auto') scroller = scroller.parentElement;
    const measure = () => {
      const maxHeight = parseFloat(getComputedStyle(dialog).maxHeight) || window.innerHeight;
      const body = scroller && scroller !== dialog ? scroller : dialog;
      const chrome = dialog.offsetHeight - body.clientHeight + body.scrollHeight - stage.offsetHeight;
      setFitHeight(Math.max(200, Math.floor(maxHeight - chrome - 2)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(dialog);
    Array.from(stage.parentElement.children).forEach((el) => el !== stage && observer.observe(el));
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [size, !!cropBox]);

  // `change` maps the previous { marks, crop } to the next one.
  const commitState = (change) =>
    setHistory((h) => ({ ...change({ marks: h.marks, crop: h.crop }), undo: [...h.undo, { marks: h.marks, crop: h.crop }], redo: [] }));
  const commit = (change) => commitState((st) => ({ ...st, marks: change(st.marks) }));
  const undo = () =>
    setHistory((h) => (h.undo.length === 0 ? h : { ...h.undo[h.undo.length - 1], undo: h.undo.slice(0, -1), redo: [...h.redo, { marks: h.marks, crop: h.crop }] }));
  const redo = () =>
    setHistory((h) => (h.redo.length === 0 ? h : { ...h.redo[h.redo.length - 1], undo: [...h.undo, { marks: h.marks, crop: h.crop }], redo: h.redo.slice(0, -1) }));
  const clearAll = () => {
    if (marks.length > 0) commit(() => []);
  };

  // Screen -> image pixels, measured on every event, so retina screens,
  // browser zoom (90%, 125%...) and dialog resizing all line up.
  const scale = () => view.w / marksRef.current.getBoundingClientRect().width;
  const toImage = (e) => {
    const rect = marksRef.current.getBoundingClientRect();
    return [view.x + ((e.clientX - rect.left) * view.w) / rect.width, view.y + ((e.clientY - rect.top) * view.h) / rect.height];
  };

  const commitText = () => {
    if (textAt && textValue.trim()) {
      const text = textValue.trim();
      const note = { type: 'text', x: textAt.x, y: textAt.y, text, size: textAt.size, colour: textAt.colour, w: textWidth(text, textAt.size) };
      commit((prev) => [...prev, note]);
    }
    setTextAt(null);
    setTextValue('');
  };

  // Crop starts as the whole visible image, so keyboard users have a box
  // to adjust straight away; dragging on the image draws a new one.
  const startCrop = () => {
    if (textAt) commitText();
    setCropBox({ ...view });
  };
  const cancelCrop = () => setCropBox(null);
  // Marks wholly outside the new area are dropped (as one undoable step
  // with the crop); marks partly inside are kept and cut at the edge.
  const applyCrop = () => {
    const box = cropBoxRef.current;
    if (!box) return;
    commitState((st) => ({ marks: st.marks.filter((m) => insideCrop(m, box)), crop: { ...box } }));
    setCropBox(null);
  };
  // Back to the whole image; marks drawn since the crop stay.
  const resetCrop = () => commitState((st) => ({ ...st, crop: null }));

  const onPointerDown = (e) => {
    if (!size || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    const [x, y] = toImage(e);
    if (textAt) commitText();
    if (tool === 'text') {
      const rect = marksRef.current.getBoundingClientRect();
      // Kept inside the image so a note started near the right edge isn't cut off.
      const left = Math.max(0, Math.min(e.clientX - rect.left, rect.width - Math.min(180, rect.width)));
      setTextAt({ x, y, size: thickness.font * scale(), colour: colour.value, left, top: e.clientY - rect.top });
      return;
    }
    try {
      marksRef.current.setPointerCapture(e.pointerId);
    } catch {
      // Capture is a nicety (keeps the drag going outside the canvas).
    }
    const width = thickness.px * scale();
    draftRef.current =
      tool === 'pen'
        ? { type: 'pen', points: [[x, y]], colour: colour.value, width }
        : { type: tool, x1: x, y1: y, x2: x, y2: y, colour: colour.value, width };
  };

  const onPointerMove = (e) => {
    const d = draftRef.current;
    if (!d) return;
    const [x, y] = toImage(e);
    if (d.type === 'pen') d.points.push([x, y]);
    else {
      d.x2 = x;
      d.y2 = y;
    }
    redraw();
  };

  const onPointerUp = () => {
    const d = draftRef.current;
    draftRef.current = null;
    if (!d) return;
    // Ignore accidental clicks (a box or arrow needs some size).
    const tiny = d.type !== 'pen' && Math.hypot(d.x2 - d.x1, d.y2 - d.y1) < 3 * scale();
    if (tiny) redraw();
    else commit((prev) => [...prev, d]);
  };

  // Ctrl+Z / Ctrl+Y (and Ctrl+Shift+Z), unless typing a text note.
  // Listened for on the whole page while the dialog is open: Clear all and
  // the last Undo disable their own button, which drops focus out of here.
  const onKeyDown = (e) => {
    if (textAt || cropBox || !(e.ctrlKey || e.metaKey)) return;
    if (e.target instanceof HTMLElement && e.target.matches('input, textarea, [contenteditable="true"]')) return;
    const key = e.key.toLowerCase();
    if (key === 'z' && !e.shiftKey) {
      e.preventDefault();
      undo();
    } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
      e.preventDefault();
      redo();
    }
  };

  // While cropping: Esc cancels the crop (not the dialog - this runs
  // first, in the capture phase) and Enter applies it, except on a button
  // outside the crop box (Cancel crop, the dialog's own buttons...), which
  // keeps its normal Enter.
  const onCropKey = (e) => {
    if (!cropBoxRef.current) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      cancelCrop();
    } else if (e.key === 'Enter') {
      const onOtherButton = e.target instanceof HTMLElement && e.target.closest('button') && !e.target.closest('[data-crop]');
      if (onOtherButton) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      applyCrop();
    }
  };

  const onKeyDownRef = useRef(onKeyDown);
  onKeyDownRef.current = onKeyDown;
  const onCropKeyRef = useRef(onCropKey);
  onCropKeyRef.current = onCropKey;
  useEffect(() => {
    const listener = (e) => onKeyDownRef.current(e);
    const cropListener = (e) => onCropKeyRef.current(e);
    document.addEventListener('keydown', listener);
    document.addEventListener('keydown', cropListener, true);
    return () => {
      document.removeEventListener('keydown', listener);
      document.removeEventListener('keydown', cropListener, true);
    };
  }, []);

  useImperativeHandle(ref, () => ({
    hasMarks: () => nowRef.current.marks.length > 0 || !!nowRef.current.crop,
    // One new image with every mark drawn in at full resolution, cut to the
    // crop area if there is one - or null when there are no marks and no
    // crop (the original is then attached unchanged). Refuses while a crop
    // is half done, rather than guess whether the dimmed area should go.
    async flatten() {
      if (cropBoxRef.current) throw new Error('Apply or cancel the crop first.');
      const { marks: m, crop: c } = nowRef.current;
      if (!size || (m.length === 0 && !c)) return null;
      const full = document.createElement('canvas');
      full.width = size.w;
      full.height = size.h;
      const ctx = full.getContext('2d');
      ctx.drawImage(baseRef.current, 0, 0);
      for (const mark of m) drawMark(ctx, mark, full);
      let out = full;
      if (c) {
        out = document.createElement('canvas');
        out.width = c.w;
        out.height = c.h;
        out.getContext('2d').drawImage(full, c.x, c.y, c.w, c.h, 0, 0, c.w, c.h);
      }
      return new Promise((resolve, reject) => {
        out.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not save the marked-up image.'))), 'image/png');
      });
    },
  }));

  const activeTool = TOOLS.find((t) => t.id === tool);
  const canCrop = !!view && view.w >= MIN_CROP && view.h >= MIN_CROP;

  return (
    <div className={styles.markup}>
      {cropBox ? (
        <div className={styles.markupToolbar} role="toolbar" aria-label="Crop">
          <div className={styles.markupGroup} role="group" aria-label="Crop">
            <button type="button" className={`${styles.markupButton} ${styles.markupButtonActive}`} onClick={applyCrop} title="Apply crop (Enter)">
              <Check size={16} aria-hidden="true" /> Apply crop
            </button>
            <button type="button" className={styles.markupButton} onClick={cancelCrop} title="Cancel crop (Esc)">
              <X size={16} aria-hidden="true" /> Cancel crop
            </button>
            <span className={styles.cropSize}>
              {cropBox.w} × {cropBox.h} px
            </span>
          </div>
        </div>
      ) : (
        <div className={styles.markupToolbar} role="toolbar" aria-label="Markup tools">
          <div className={styles.markupGroup} role="group" aria-label="Tool">
            <button
              ref={cropButtonRef}
              type="button"
              className={styles.markupButton}
              onClick={startCrop}
              disabled={!canCrop}
              title={canCrop ? 'Crop – keep only part of the screenshot' : `Crop – the image is smaller than ${MIN_CROP} pixels`}
            >
              <Crop size={16} aria-hidden="true" /> Crop
            </button>
            {TOOLS.map(({ id, label, icon: Icon, hint }) => (
              <button
                key={id}
                type="button"
                className={`${styles.markupButton} ${tool === id ? styles.markupButtonActive : ''}`}
                aria-pressed={tool === id}
                title={`${label} – ${hint}`}
                onClick={() => {
                  if (textAt) commitText();
                  setTool(id);
                }}
              >
                <Icon size={16} aria-hidden="true" /> {label}
              </button>
            ))}
          </div>
          <div className={styles.markupGroup} role="group" aria-label="Colour">
            {COLOURS.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`${styles.markupButton} ${colour.id === c.id ? styles.markupButtonActive : ''}`}
                aria-pressed={colour.id === c.id}
                title={`${c.label} marks`}
                onClick={() => setColour(c)}
              >
                <span className={styles.markupSwatch} style={{ background: c.value }} aria-hidden="true" /> {c.label}
              </button>
            ))}
          </div>
          <div className={styles.markupGroup} role="group" aria-label="Thickness">
            {THICKNESS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`${styles.markupButton} ${thickness.id === t.id ? styles.markupButtonActive : ''}`}
                aria-pressed={thickness.id === t.id}
                title={`${t.label} lines and text`}
                onClick={() => setThickness(t)}
              >
                <span className={styles.markupLine} style={{ height: t.px }} aria-hidden="true" /> {t.label}
              </button>
            ))}
          </div>
          <div className={styles.markupGroup} role="group" aria-label="History">
            <button type="button" className={styles.markupButton} onClick={undo} disabled={history.undo.length === 0} title="Undo (Ctrl+Z)">
              <Undo2 size={16} aria-hidden="true" /> Undo
            </button>
            <button type="button" className={styles.markupButton} onClick={redo} disabled={history.redo.length === 0} title="Redo (Ctrl+Y)">
              <Redo2 size={16} aria-hidden="true" /> Redo
            </button>
            <button type="button" className={styles.markupButton} onClick={clearAll} disabled={marks.length === 0} title="Remove all marks">
              <Trash2 size={16} aria-hidden="true" /> Clear all
            </button>
            {crop && (
              <button type="button" className={styles.markupButton} onClick={resetCrop} title="Show the whole screenshot again - your marks stay">
                <RotateCcw size={16} aria-hidden="true" /> Reset to original
              </button>
            )}
          </div>
        </div>
      )}
      <p className={styles.helpText} style={{ margin: 'var(--ds-space-2) 0' }}>
        {cropBox ? (
          <>
            Crop: drag the box or its handles, or drag on the image to draw a new box. Arrow keys move the selected box or
            handle (Shift moves further). Enter applies, Esc cancels.
            {marks.length > 0 && <strong> Marks outside the area will be removed.</strong>}
          </>
        ) : (
          <>
            {activeTool.label}: {activeTool.hint}.
          </>
        )}
      </p>
      {loadError && <p className={styles.fieldErrorText} role="alert">{loadError}</p>}
      {/* Full-size source for drawing - never shown. */}
      <canvas ref={baseRef} hidden />
      <div
        ref={wrapRef}
        // While cropping, the crop handles may stick out past the image edge.
        className={`${styles.markupStage} ${cropBox ? styles.markupStageCropping : ''}`}
        // Never larger than the image itself, so a small paste isn't blown up
        // (which would also make its marks hair-thin in the real image), and
        // never taller than the room left in the dialog.
        style={
          view
            ? { aspectRatio: `${view.w} / ${view.h}`, width: `min(100%, ${view.w}px, ${((fitHeight || window.innerHeight * 0.6) * view.w) / view.h}px)` }
            : undefined
        }
      >
        <canvas
          ref={marksRef}
          className={`${styles.markupCanvas} ${styles.markupDrawLayer}`}
          style={{ cursor: tool === 'text' ? 'text' : 'crosshair' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          role="img"
          aria-label="Screenshot being marked up"
        />
        {cropBox && <ScreenshotCropBox view={view} box={cropBox} onChange={setCropBox} />}
        {textAt && (
          <input
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            // Yellow is unreadable on the light box - it gets a dark one.
            className={`${styles.markupTextInput} ${textAt.colour === '#facc15' ? styles.markupTextInputDark : ''}`}
            style={{ left: textAt.left, top: textAt.top, color: textAt.colour, fontSize: thickness.font }}
            value={textValue}
            maxLength={80}
            aria-label="Text note"
            placeholder="Type a note, Enter to place"
            onChange={(e) => setTextValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitText();
              } else if (e.key === 'Escape') {
                // Cancel just the note - don't let Esc reach the dialog.
                e.stopPropagation();
                e.nativeEvent.stopImmediatePropagation();
                setTextAt(null);
                setTextValue('');
              }
            }}
            onBlur={commitText}
          />
        )}
      </div>
    </div>
  );
});

export default ScreenshotMarkup;
