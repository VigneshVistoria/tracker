import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ArrowUpRight, EyeOff, Grid3x3, Pencil, Redo2, Square, Trash2, Type, Undo2 } from 'lucide-react';
import styles from '../styles/issues.module.css';

// Markup for a screenshot before it's attached (the "Attach this
// screenshot?" dialog). Two canvases at the image's own resolution - the
// image, and a layer on top that the marks are drawn on - scaled down
// together by CSS.
// Marks are kept as a list in image pixels, so undo/redo is just the list,
// and flatten() draws them into ONE new image at full resolution. Blur and
// Hide destroy the pixels underneath when flattened (block-averaged mosaic
// / solid box), so the hidden content is not in the uploaded file at all.

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
  // History: `marks` is the current list; undo/redo hold earlier and
  // undone lists (so Clear all is undoable too). One state object, always
  // updated from the previous one, so two commits in one event can't
  // overwrite each other.
  const [history, setHistory] = useState({ marks: [], undo: [], redo: [] });
  const { marks } = history;
  // Read by hasMarks() - current as of the last render, so an Esc pressed
  // straight after drawing still sees the new mark.
  const marksNowRef = useRef(marks);
  marksNowRef.current = marks;
  const [textAt, setTextAt] = useState(null);
  const [textValue, setTextValue] = useState('');
  const [loadError, setLoadError] = useState('');

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
        marksRef.current.width = b.width;
        marksRef.current.height = b.height;
        base.getContext('2d').drawImage(b, 0, 0);
        setSize({ w: b.width, h: b.height });
      })
      .catch(() => setLoadError('This image could not be opened for markup.'));
    return () => {
      cancelled = true;
      bitmap?.close?.();
    };
  }, [blob]);

  // Drawn exactly like flatten(): the image, then each mark in turn, so a
  // Blur over an earlier box averages the box too, as it will once attached.
  // The finished marks are kept in `committedRef`, so a drag only redraws
  // the mark being drawn - several Blurs on a big capture stay smooth.
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
    if (!canvas || !size || !committedRef.current) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(committedRef.current, 0, 0);
    if (draftRef.current) drawMark(ctx, draftRef.current, canvas);
  }, [marks, size]);

  useEffect(redraw, [redraw]);

  // `change` maps the previous marks to the next ones.
  const commit = (change) =>
    setHistory((h) => ({ marks: change(h.marks), undo: [...h.undo, h.marks], redo: [] }));
  const undo = () =>
    setHistory((h) => (h.undo.length === 0 ? h : { marks: h.undo[h.undo.length - 1], undo: h.undo.slice(0, -1), redo: [...h.redo, h.marks] }));
  const redo = () =>
    setHistory((h) => (h.redo.length === 0 ? h : { marks: h.redo[h.redo.length - 1], undo: [...h.undo, h.marks], redo: h.redo.slice(0, -1) }));
  const clearAll = () => {
    if (marks.length > 0) commit(() => []);
  };

  // Screen -> image pixels, measured on every event, so retina screens,
  // browser zoom (90%, 125%...) and dialog resizing all line up.
  const scale = () => size.w / marksRef.current.getBoundingClientRect().width;
  const toImage = (e) => {
    const rect = marksRef.current.getBoundingClientRect();
    return [((e.clientX - rect.left) * size.w) / rect.width, ((e.clientY - rect.top) * size.h) / rect.height];
  };

  const commitText = () => {
    if (textAt && textValue.trim()) {
      const note = { type: 'text', x: textAt.x, y: textAt.y, text: textValue.trim(), size: textAt.size, colour: textAt.colour };
      commit((prev) => [...prev, note]);
    }
    setTextAt(null);
    setTextValue('');
  };

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
    if (textAt || !(e.ctrlKey || e.metaKey)) return;
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

  const onKeyDownRef = useRef(onKeyDown);
  onKeyDownRef.current = onKeyDown;
  useEffect(() => {
    const listener = (e) => onKeyDownRef.current(e);
    document.addEventListener('keydown', listener);
    return () => document.removeEventListener('keydown', listener);
  }, []);

  useImperativeHandle(ref, () => ({
    hasMarks: () => marksNowRef.current.length > 0,
    // One new image with every mark drawn in at full resolution, or null
    // when there are no marks (the original is then attached unchanged).
    async flatten() {
      if (!size || marks.length === 0) return null;
      const out = document.createElement('canvas');
      out.width = size.w;
      out.height = size.h;
      const ctx = out.getContext('2d');
      ctx.drawImage(baseRef.current, 0, 0);
      for (const m of marks) drawMark(ctx, m, out);
      return new Promise((resolve, reject) => {
        out.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not save the marked-up image.'))), 'image/png');
      });
    },
  }));

  const activeTool = TOOLS.find((t) => t.id === tool);

  return (
    <div className={styles.markup}>
      <div className={styles.markupToolbar} role="toolbar" aria-label="Markup tools">
        <div className={styles.markupGroup} role="group" aria-label="Tool">
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
        </div>
      </div>
      <p className={styles.helpText} style={{ margin: 'var(--ds-space-2) 0' }}>
        {activeTool.label}: {activeTool.hint}.
      </p>
      {loadError && <p className={styles.fieldErrorText} role="alert">{loadError}</p>}
      <div
        ref={wrapRef}
        className={styles.markupStage}
        // Never larger than the image itself, so a small paste isn't blown up
        // (which would also make its marks hair-thin in the real image).
        style={size ? { aspectRatio: `${size.w} / ${size.h}`, width: `min(100%, ${size.w}px, calc(60vh * ${size.w / size.h}))` } : undefined}
      >
        <canvas ref={baseRef} className={styles.markupCanvas} role="img" aria-label="Screenshot being marked up" />
        <canvas
          ref={marksRef}
          className={`${styles.markupCanvas} ${styles.markupDrawLayer}`}
          style={{ cursor: tool === 'text' ? 'text' : 'crosshair' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          aria-hidden="true"
        />
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
