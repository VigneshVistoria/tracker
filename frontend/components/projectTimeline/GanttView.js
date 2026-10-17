import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Crosshair, Link2, ListChecks, PencilLine, Route } from 'lucide-react';
import { progressText } from '../../lib/projectTimelineTickets';
import { formatDate } from '../../lib/formatDate';
import { groupByModule, isOverdue } from '../../lib/projectTimeline';
import { formatSlip } from '../../lib/projectTimelineSummary';
import { earliestStart } from '../../lib/projectTimelineDeps';
import { ZOOMS, barSpan, chartRange, dayNumber, dragDates, monthBands, tickMarks, zoomPx } from '../../lib/projectTimelineGantt';
import styles from '../../styles/timelineGantt.module.css';

// Project Timeline - Gantt view (Stage A, 2026-10-16). The same rows the
// table shows (filters apply), drawn as bars per module with a today line
// and the baseline (dates when the phase first entered the plan, or the
// last reset) as a grey ghost bar underneath, so slip is visible at a
// glance. PM/Admin can drag a bar to move it, or its ends to change one
// date; Left/Right moves a focused bar a day, Shift+Left/Right changes its
// end date.
// Every change goes through the page's onChange - the same unsaved-changes
// buffer as a table edit - so nothing is saved until "Save changes".
// Stage B adds dependency arrows (red when the later phase starts too
// early), the critical path highlight and a links button per phase.

// Matches --label-w in timelineGantt.module.css (desktop), for scrolling.
const LABEL_WIDTH = 280;
// Below this many pixels of movement a press is a click, not a drag.
const DRAG_THRESHOLD = 4;

const STATUS_CLASS = {
  'To Do': styles.barTodo,
  'In Progress': styles.barProgress,
  Completed: styles.barDone,
  Delayed: styles.barDelayed,
  'On Hold': styles.barHold,
};

function rangeText(start, end) {
  if (!start && !end) return 'no dates';
  return `${start ? formatDate(start) : 'no start'} to ${end ? formatDate(end) : 'no end'}`;
}

function Legend() {
  return (
    <ul className={styles.legend} aria-label="Legend">
      <li><span className={`${styles.swatch} ${styles.barTodo}`} aria-hidden="true" />To Do</li>
      <li><span className={`${styles.swatch} ${styles.barProgress}`} aria-hidden="true" />In Progress</li>
      <li><span className={`${styles.swatch} ${styles.barDone}`} aria-hidden="true" />Completed</li>
      <li><span className={`${styles.swatch} ${styles.barDelayed}`} aria-hidden="true" />Delayed</li>
      <li><span className={`${styles.swatch} ${styles.barHold}`} aria-hidden="true" />On Hold</li>
      <li><span className={`${styles.swatch} ${styles.barTodo} ${styles.barOverdue}`} aria-hidden="true" />Overdue</li>
      <li><span className={`${styles.swatch} ${styles.swatchBaseline}`} aria-hidden="true" />Planned (baseline)</li>
      <li><span className={styles.swatchToday} aria-hidden="true" />Today</li>
      <li><span className={`${styles.swatch} ${styles.swatchCritical}`} aria-hidden="true" />Critical path</li>
      <li><span className={styles.swatchArrow} aria-hidden="true" />Starts after</li>
      <li><span className={`${styles.swatchArrow} ${styles.swatchArrowBad}`} aria-hidden="true" />Starts too early</li>
      <li><span className={`${styles.swatch} ${styles.swatchFill}`} aria-hidden="true" />Tickets done</li>
      <li><span className={styles.swatchMismatch} aria-hidden="true" />Doesn’t match tickets</li>
    </ul>
  );
}

function Bar({ row, range, px, today, canEdit, overlaps, baseline, dirty, preview, critical, early, tickets, onDragStart, onKeyMove }) {
  const dates = preview || row;
  const span = barSpan(dates.startDate, dates.endDate);
  const base = baseline && barSpan(baseline.baselineStart, baseline.baselineEnd);
  const moved = base && span && (base.start !== span.start || base.end !== span.end);
  const overdue = isOverdue(dates, today);
  const overlapCount = overlaps?.length || 0;

  const label = [
    `${row.phase || 'New phase'}`,
    row.status,
    rangeText(dates.startDate, dates.endDate),
    overdue ? 'overdue' : null,
    overlapCount ? `overlaps ${overlapCount} phase${overlapCount === 1 ? '' : 's'}` : null,
    moved && baseline?.slip != null ? `slip ${formatSlip(baseline.slip)} against the plan` : null,
    critical ? 'on the critical path' : null,
    early ? `starts ${early} day${early === 1 ? '' : 's'} before a phase it depends on allows` : null,
    tickets ? `tickets ${progressText(tickets.progress)}` : null,
    ...(tickets?.mismatches || []).map((m) => m.text),
    dirty ? 'unsaved change' : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <>
      {moved && (
        <span
          className={styles.baseline}
          style={{ left: (base.start - range.start) * px, width: (base.end - base.start + 1) * px }}
          title={`Planned: ${rangeText(baseline.baselineStart, baseline.baselineEnd)}`}
          aria-hidden="true"
        />
      )}
      {span ? (
        <button
          type="button"
          className={[
            styles.bar,
            STATUS_CLASS[row.status] || styles.barTodo,
            overdue ? styles.barOverdue : '',
            span.partial ? styles.barPartial : '',
            dirty ? styles.barDirty : '',
            critical ? styles.barCritical : '',
            canEdit ? styles.barEditable : '',
          ].join(' ')}
          style={{ left: (span.start - range.start) * px, width: Math.max((span.end - span.start + 1) * px, 6) }}
          aria-label={label}
          title={label}
          onPointerDown={canEdit && !span.partial ? (e) => onDragStart(e, row, 'move') : undefined}
          onKeyDown={canEdit ? (e) => onKeyMove(e, row) : undefined}
        >
          {canEdit && !span.partial && (
            <>
              <span className={`${styles.handle} ${styles.handleStart}`} onPointerDown={(e) => onDragStart(e, row, 'start')} aria-hidden="true" />
              <span className={`${styles.handle} ${styles.handleEnd}`} onPointerDown={(e) => onDragStart(e, row, 'end')} aria-hidden="true" />
            </>
          )}
          {overlapCount > 0 && <span className={styles.overlapDot} aria-hidden="true" />}
          {tickets?.progress?.percent != null && <span className={styles.barFill} style={{ width: `${tickets.progress.percent}%` }} aria-hidden="true" />}
          {tickets?.mismatches?.length > 0 && <span className={styles.mismatchDot} aria-hidden="true" />}
        </button>
      ) : (
        <span className={styles.noDates}>No dates</span>
      )}
    </>
  );
}

export default function GanttView({ rows, today, teams, canEdit, overlaps, slipByKey, dirtyKeys, onChange, onEditInTable, deps = [], conflicts = [], critical, onDependencies, ticketInfoById, onTickets }) {
  const [zoom, setZoom] = useState('month');
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [drag, setDrag] = useState(null); // { key, mode, startX, delta, moved }
  const scrollRef = useRef(null);
  const canvasRef = useRef(null);
  const rowEls = useRef(new Map());
  const [rowY, setRowY] = useState(() => new Map());
  const [showCritical, setShowCritical] = useState(true);
  const criticalIds = useMemo(() => new Set(showCritical ? critical?.chain || [] : []), [critical, showCritical]);
  const earlyById = useMemo(() => {
    const m = new Map();
    for (const c of conflicts) m.set(c.successor.id, Math.max(m.get(c.successor.id) || 0, c.daysEarly));
    return m;
  }, [conflicts]);
  const depCount = useMemo(() => {
    const m = new Map();
    for (const d of deps) for (const id of [d.predecessorRowId, d.successorRowId]) m.set(id, (m.get(id) || 0) + 1);
    return m;
  }, [deps]);
  const px = zoomPx(zoom);
  const teamName = useMemo(() => new Map((teams || []).map((t) => [t.id, t.name])), [teams]);
  const range = useMemo(() => chartRange(rows, slipByKey, today, zoom), [rows, slipByKey, today, zoom]);
  const months = useMemo(() => monthBands(range), [range]);
  const ticks = useMemo(() => tickMarks(range, zoom), [range, zoom]);
  const groups = useMemo(() => groupByModule(rows), [rows]);
  const trackWidth = range.days * px;
  const todayOffset = (dayNumber(today) - range.start) * px;

  const scrollToToday = () => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = Math.max(0, todayOffset - (el.clientWidth - LABEL_WIDTH) / 3);
  };
  // Open on today; keep today in view when the zoom changes.
  useEffect(scrollToToday, [zoom]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- dragging (pointer) ----
  const onDragStart = (e, row, mode) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.closest('button')?.setPointerCapture?.(e.pointerId);
    setDrag({ key: row.key, mode, startX: e.clientX, delta: 0, moved: false });
  };

  useEffect(() => {
    if (!drag) return undefined;
    const onMove = (e) => {
      const dx = e.clientX - drag.startX;
      setDrag((d) => d && { ...d, delta: Math.round(dx / px), moved: d.moved || Math.abs(dx) >= DRAG_THRESHOLD });
    };
    const onUp = () => {
      setDrag((d) => {
        if (d && d.moved && d.delta !== 0) {
          const row = rows.find((r) => r.key === d.key);
          if (row) onChange(row.key, dragDates(row, d.mode, d.delta));
        }
        return null;
      });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [drag?.key, drag?.mode, drag?.startX, px, rows, onChange]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- keyboard ----
  const onKeyMove = (e, row) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const delta = e.key === 'ArrowRight' ? 1 : -1;
    e.preventDefault();
    if (e.shiftKey) {
      if (row.endDate) onChange(row.key, dragDates(row, 'end', delta));
    } else if (row.startDate || row.endDate) {
      onChange(row.key, dragDates(row, 'move', delta));
    }
  };

  const toggle = (key) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const preview = (row) => (drag && drag.key === row.key && drag.moved ? dragDates(row, drag.mode, drag.delta) : null);

  // Row centres (px from the top of the chart) for the arrows - measured,
  // since modules fold and filters hide rows.
  useLayoutEffect(() => {
    const next = new Map();
    for (const [key, el] of rowEls.current) if (el) next.set(key, el.offsetTop + el.offsetHeight / 2);
    setRowY((prev) => (prev.size === next.size && [...next].every(([k, v]) => prev.get(k) === v) ? prev : next));
  });

  const labelPx = () => (canvasRef.current ? parseFloat(getComputedStyle(canvasRef.current).getPropertyValue('--label-w')) || LABEL_WIDTH : LABEL_WIDTH);
  const arrows = (() => {
    const byId = new Map(rows.filter((r) => r.id != null).map((r) => [r.id, r]));
    const lx = labelPx();
    const out = [];
    for (const d of deps) {
      const p = byId.get(d.predecessorRowId);
      const s = byId.get(d.successorRowId);
      if (!p || !s || !rowY.has(p.key) || !rowY.has(s.key)) continue;
      const pd = preview(p) || p;
      const sd = preview(s) || s;
      const ps = barSpan(pd.startDate, pd.endDate);
      const ss = barSpan(sd.startDate, sd.endDate);
      if (!ps || !ss) continue;
      const x1 = lx + (ps.end - range.start + 1) * px;
      const x2 = lx + (ss.start - range.start) * px;
      const y1 = rowY.get(p.key);
      const y2 = rowY.get(s.key);
      const bad = !!pd.endDate && !!sd.startDate && sd.startDate < earliestStart(pd.endDate, d.lagDays);
      const onPath = criticalIds.has(p.id) && criticalIds.has(s.id);
      let path;
      if (x2 >= x1 + 12) {
        const xm = x1 + 6;
        path = `M${x1},${y1} H${xm} V${y2} H${x2 - 1}`;
      } else {
        const ym = y1 + (y2 > y1 ? 17 : -17);
        path = `M${x1},${y1} H${x1 + 6} V${ym} H${x2 - 8} V${y2} H${x2 - 1}`;
      }
      out.push({ key: `${d.predecessorRowId}-${d.successorRowId}`, path, bad, onPath });
    }
    return out;
  })();

  if (rows.length === 0) return <p className={styles.empty}>No phases to show.</p>;

  return (
    <div className={styles.wrap}>
      <div className={styles.controls}>
        <div className={styles.zoom} role="group" aria-label="Zoom">
          {ZOOMS.map((z) => (
            <button key={z.key} type="button" className={`${styles.zoomButton} ${zoom === z.key ? styles.zoomActive : ''}`} aria-pressed={zoom === z.key} onClick={() => setZoom(z.key)}>
              {z.label}
            </button>
          ))}
        </div>
        <button type="button" className={styles.todayButton} onClick={scrollToToday}>
          <Crosshair size={14} aria-hidden="true" /> Today
        </button>
        <Legend />
      </div>
      {critical?.projectEnd && (
        <p className={styles.criticalLine}>
          <Route size={16} aria-hidden="true" />
          <span>
            Project end <strong>{formatDate(critical.projectEnd)}</strong>
            {' · '}critical path {critical.chain.length} phase{critical.chain.length === 1 ? '' : 's'}
            {deps.length === 0 && ' (add dependencies to see the chain that drives it)'}
          </span>
          <button type="button" className={styles.todayButton} aria-pressed={showCritical} onClick={() => setShowCritical((v) => !v)}>
            {showCritical ? 'Hide highlight' : 'Highlight'}
          </button>
        </p>
      )}
      {canEdit && (
        <p className={styles.hint}>
          Drag a bar to move a phase, or drag its ends to change one date. With a bar selected, the left and right arrow keys move it a day, and
          Shift with an arrow key changes the end date. Changes stay on this page until you click Save changes.
        </p>
      )}

      <div className={`${styles.scroll} ${drag?.moved ? styles.dragging : ''}`} ref={scrollRef}>
        <div className={styles.canvas} ref={canvasRef} style={{ width: `calc(var(--label-w) + ${trackWidth}px)` }}>
          {arrows.length > 0 && (
            <svg className={styles.arrows} aria-hidden="true">
              <defs>
                <marker id="gantt-arrow" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="6" markerHeight="6" orient="auto">
                  <path d="M0,0 L6,3 L0,6 z" className={styles.arrowHead} />
                </marker>
                <marker id="gantt-arrow-bad" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="6" markerHeight="6" orient="auto">
                  <path d="M0,0 L6,3 L0,6 z" className={styles.arrowHeadBad} />
                </marker>
              </defs>
              {arrows.map((a) => (
                <path key={a.key} d={a.path} className={`${styles.arrow} ${a.bad ? styles.arrowBad : ''} ${a.onPath ? styles.arrowCritical : ''}`} markerEnd={`url(#${a.bad ? 'gantt-arrow-bad' : 'gantt-arrow'})`} />
              ))}
            </svg>
          )}
          {/* Header: months + ticks */}
          <div className={styles.headRow}>
            <div className={styles.corner}>Phase</div>
            <div className={styles.headTrack} style={{ width: trackWidth }}>
              <div className={styles.months}>
                {months.map((m) => (
                  <span key={m.key} className={styles.month} style={{ left: m.offset * px, width: m.days * px }}>
                    {m.days * px > 40 ? m.label : ''}
                  </span>
                ))}
              </div>
              {ticks.length > 0 && (
                <div className={styles.ticks}>
                  {ticks.map((t) => (
                    <span key={t.key} className={`${styles.tick} ${t.weekend ? styles.tickWeekend : ''}`} style={{ left: t.offset * px, width: (zoom === 'week' ? 1 : 7) * px }}>
                      {t.weekday && <span className={styles.tickDay}>{t.weekday}</span>}
                      {t.label}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          <span className={styles.todayLine} style={{ left: `calc(var(--label-w) + ${todayOffset}px)` }} aria-hidden="true" />

          {groups.map((g) => {
            const isOpen = !collapsed.has(g.key);
            const dated = g.rows.filter((r) => r.startDate || r.endDate);
            const gStart = dated.length ? Math.min(...dated.map((r) => dayNumber(r.startDate || r.endDate))) : null;
            const gEnd = dated.length ? Math.max(...dated.map((r) => dayNumber(r.endDate || r.startDate))) : null;
            const overdueCount = g.rows.filter((r) => isOverdue(r, today)).length;
            return (
              <div key={g.key} className={styles.group}>
                <div className={styles.moduleRow}>
                  <div className={styles.label}>
                    <button type="button" className={styles.moduleToggle} onClick={() => toggle(g.key)} aria-expanded={isOpen}>
                      {isOpen ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
                      <span className={styles.moduleName}>{g.name}</span>
                      <span className={styles.moduleMeta}>
                        {g.rows.length}
                        {overdueCount > 0 && <span className={styles.moduleOverdue}> · {overdueCount} overdue</span>}
                      </span>
                    </button>
                  </div>
                  <div className={styles.track} style={{ width: trackWidth, '--day': `${px}px` }}>
                    {gStart != null && (
                      <span
                        className={styles.moduleSpan}
                        style={{ left: (gStart - range.start) * px, width: (gEnd - gStart + 1) * px }}
                        title={`${g.name}: ${formatDate(new Date(gStart * 86400000).toISOString().slice(0, 10))} to ${formatDate(new Date(gEnd * 86400000).toISOString().slice(0, 10))}`}
                        aria-hidden="true"
                      />
                    )}
                  </div>
                </div>

                {isOpen &&
                  g.rows.map((r) => (
                    <div key={r.key} className={styles.row} ref={(el) => (el ? rowEls.current.set(r.key, el) : rowEls.current.delete(r.key))}>
                      <div className={styles.label}>
                        <span className={styles.phase} title={r.phase}>
                          {r.phase || 'New phase'}
                        </span>
                        <span className={styles.phaseMeta}>{r.teamId != null ? teamName.get(r.teamId) : 'No team'}</span>
                        {onDependencies && r.id != null && (canEdit || depCount.get(r.id) > 0) && (
                          <button
                            type="button"
                            className={`${styles.editLink} ${depCount.get(r.id) ? styles.linkHas : ''}`}
                            onClick={() => onDependencies(r)}
                            aria-label={`Dependencies of ${r.phase || 'new phase'}${depCount.get(r.id) ? ` (${depCount.get(r.id)})` : ''}`}
                            title="Dependencies"
                          >
                            <Link2 size={14} aria-hidden="true" />
                            {depCount.get(r.id) ? <span className={styles.linkCount}>{depCount.get(r.id)}</span> : null}
                          </button>
                        )}
                        {onTickets && r.id != null && (canEdit || ticketInfoById?.get(r.id)) && (
                          <button
                            type="button"
                            className={`${styles.editLink} ${ticketInfoById?.get(r.id) ? styles.linkHas : ''}`}
                            onClick={() => onTickets(r)}
                            aria-label={`Tickets for ${r.phase || 'new phase'}: ${ticketInfoById?.get(r.id) ? progressText(ticketInfoById.get(r.id).progress) : 'none linked'}`}
                            title={ticketInfoById?.get(r.id) ? `Tickets: ${progressText(ticketInfoById.get(r.id).progress)}` : 'Tickets'}
                          >
                            <ListChecks size={14} aria-hidden="true" />
                          </button>
                        )}
                        {canEdit && onEditInTable && (
                          <button type="button" className={styles.editLink} onClick={() => onEditInTable(r)} aria-label={`Show ${r.phase || 'new phase'} in the table`} title="Show in the table">
                            <PencilLine size={14} aria-hidden="true" />
                          </button>
                        )}
                      </div>
                      <div className={`${styles.track} ${zoom === 'week' ? styles.trackWeek : ''}`} style={{ width: trackWidth, '--day': `${px}px` }}>
                        <Bar
                          row={r}
                          range={range}
                          px={px}
                          today={today}
                          canEdit={canEdit}
                          overlaps={overlaps?.get(r.key)}
                          baseline={slipByKey?.get(r.key)}
                          dirty={dirtyKeys?.has(r.key)}
                          preview={preview(r)}
                          critical={r.id != null && criticalIds.has(r.id)}
                          early={r.id != null ? earlyById.get(r.id) : null}
                          tickets={r.id != null ? ticketInfoById?.get(r.id) : null}
                          onDragStart={onDragStart}
                          onKeyMove={onKeyMove}
                        />
                        {drag && drag.key === r.key && drag.moved && (
                          <span className={styles.dragTip} style={{ left: (barSpan(preview(r).startDate, preview(r).endDate).start - range.start) * px }}>
                            {rangeText(preview(r).startDate, preview(r).endDate)} ({drag.delta > 0 ? '+' : ''}
                            {drag.delta}d)
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
