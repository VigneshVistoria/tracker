import { useRef } from 'react';
import styles from '../styles/issues.module.css';

// The crop box over a screenshot in the markup dialog
// (components/ScreenshotMarkup.js). Everything is in image pixels: `view`
// is the part of the image on screen, `box` the crop area inside it.
// Drag the box to move it, a handle to resize, or the dimmed area to draw
// a new box. Arrow keys move the focused box or handle (Shift: 10x).
// The dimming is clipped to the image; the box and its handles are not, so
// a handle on the image's edge (where the box starts) can still be grabbed.

export const MIN_CROP = 40;

const HANDLES = [
  { id: 'nw', label: 'Top-left corner', x: 0, y: 0 },
  { id: 'n', label: 'Top edge', x: 0.5, y: 0 },
  { id: 'ne', label: 'Top-right corner', x: 1, y: 0 },
  { id: 'e', label: 'Right edge', x: 1, y: 0.5 },
  { id: 'se', label: 'Bottom-right corner', x: 1, y: 1 },
  { id: 's', label: 'Bottom edge', x: 0.5, y: 1 },
  { id: 'sw', label: 'Bottom-left corner', x: 0, y: 1 },
  { id: 'w', label: 'Left edge', x: 0, y: 0.5 },
];

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

const rounded = (b) => ({ x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) });

// Moves the edges a handle owns by dx/dy, never past the view or below
// the minimum size.
function resize(start, handle, dx, dy, view) {
  let x1 = start.x;
  let y1 = start.y;
  let x2 = start.x + start.w;
  let y2 = start.y + start.h;
  if (handle.includes('w')) x1 = clamp(x1 + dx, view.x, x2 - MIN_CROP);
  if (handle.includes('e')) x2 = clamp(x2 + dx, x1 + MIN_CROP, view.x + view.w);
  if (handle.includes('n')) y1 = clamp(y1 + dy, view.y, y2 - MIN_CROP);
  if (handle.includes('s')) y2 = clamp(y2 + dy, y1 + MIN_CROP, view.y + view.h);
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

function move(start, dx, dy, view) {
  return {
    ...start,
    x: clamp(start.x + dx, view.x, view.x + view.w - start.w),
    y: clamp(start.y + dy, view.y, view.y + view.h - start.h),
  };
}

// A new box from the drag's start point to the pointer - at least the
// minimum size in the direction dragged, and kept inside the view.
function fromPoints(ax, ay, bx, by, view) {
  const w = Math.max(Math.abs(bx - ax), MIN_CROP);
  const h = Math.max(Math.abs(by - ay), MIN_CROP);
  const x = bx >= ax ? ax : ax - w;
  const y = by >= ay ? ay : ay - h;
  return {
    x: clamp(x, view.x, view.x + view.w - w),
    y: clamp(y, view.y, view.y + view.h - h),
    w: Math.min(w, view.w),
    h: Math.min(h, view.h),
  };
}

export default function ScreenshotCropBox({ view, box, onChange }) {
  const overlayRef = useRef(null);
  const dragRef = useRef(null);

  // Screen -> image pixels, measured on every event (zoom, high-DPI and
  // dialog resizing all line up, as for the marks).
  const toImage = (e) => {
    const r = overlayRef.current.getBoundingClientRect();
    return [view.x + ((e.clientX - r.left) * view.w) / r.width, view.y + ((e.clientY - r.top) * view.h) / r.height];
  };

  const onPointerDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    const target = e.target.closest('[data-crop]');
    const what = target ? target.dataset.crop : 'new';
    // Focus follows the pointer, so arrow keys then nudge what was dragged.
    (target || overlayRef.current.querySelector('[data-crop="box"]'))?.focus();
    try {
      overlayRef.current.setPointerCapture(e.pointerId);
    } catch {
      // Capture is a nicety (keeps the drag going outside the image).
    }
    const [x, y] = toImage(e);
    dragRef.current = { what, x, y, start: box };
    if (what === 'new') onChange(rounded(fromPoints(x, y, x, y, view)));
  };

  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    const [x, y] = toImage(e);
    const dx = x - d.x;
    const dy = y - d.y;
    if (d.what === 'new') onChange(rounded(fromPoints(d.x, d.y, x, y, view)));
    else if (d.what === 'box') onChange(rounded(move(d.start, dx, dy, view)));
    else onChange(rounded(resize(d.start, d.what, dx, dy, view)));
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

  const onKeyDown = (e) => {
    const step = Math.max(1, Math.round(Math.max(view.w, view.h) / 100)) * (e.shiftKey ? 10 : 1);
    const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!delta) return;
    e.preventDefault();
    const what = e.currentTarget.dataset.crop;
    onChange(rounded(what === 'box' ? move(box, delta[0], delta[1], view) : resize(box, what, delta[0], delta[1], view)));
  };

  const pct = (v, total) => `${(v / total) * 100}%`;
  const size = `${box.w} × ${box.h} pixels`;
  const place = { left: pct(box.x - view.x, view.w), top: pct(box.y - view.y, view.h), width: pct(box.w, view.w), height: pct(box.h, view.h) };

  return (
    <div
      ref={overlayRef}
      className={styles.cropOverlay}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div className={styles.cropShadeClip} aria-hidden="true">
        <div className={styles.cropShade} style={place} />
      </div>
      <div className={styles.cropBox} style={place}>
        <button
          type="button"
          data-crop="box"
          className={styles.cropMove}
          aria-label={`Crop area, ${size}. Arrow keys move it, Shift moves further.`}
          title="Drag to move the crop area"
          onKeyDown={onKeyDown}
        />
        {HANDLES.map((h) => (
          <button
            key={h.id}
            type="button"
            data-crop={h.id}
            className={`${styles.cropHandle} ${styles[`cropHandle_${h.id}`]}`}
            style={{ left: `${h.x * 100}%`, top: `${h.y * 100}%` }}
            aria-label={`${h.label} of the crop area. Arrow keys move it, Shift moves further.`}
            title={`${h.label} – drag to resize`}
            onKeyDown={onKeyDown}
          />
        ))}
      </div>
    </div>
  );
}
