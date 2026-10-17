import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, CircleHelp, Crosshair, Link2, ListChecks, Palette, PencilLine, Route } from 'lucide-react';
import { progressText } from '../../lib/projectTimelineTickets';
import { formatDate } from '../../lib/formatDate';
import { groupByModule, isOverdue } from '../../lib/projectTimeline';
import { formatSlip } from '../../lib/projectTimelineSummary';
import { earliestStart } from '../../lib/projectTimelineDeps';
import { ZOOMS, barSpan, chartRange, dayNumber, dragDates, isoFromDay, monthBands, tickMarks, zoomPx } from '../../lib/projectTimelineGantt';
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
// 2026-10-17 redesign: Fit zoom (whole plan in view), colour by status or
// team, forecast ghosts (dashed, to the likely finish from the Overview's
// forecast), a hover/focus card per bar, labels beside the bars, ticket
// progress as the solid part of the bar, one-date phases as diamonds,
// module bars filled by % completed, a Today label, and the legend/help
// tucked into popovers. Zoom, colour and the toggles are remembered on
// this browser (localStorage), nothing else.

// Matches --label-w in timelineGantt.module.css (desktop), for scrolling.
const LABEL_WIDTH = 280;
// Below this many pixels of movement a press is a click, not a drag.
const DRAG_THRESHOLD = 4;
const PREFS_KEY = 'projectTimeline.gantt';
// Matches .barLabel max-width (+ its 8px gap) in timelineGantt.module.css.
const FIT_LABEL_ROOM = 230;
const ALL_ZOOMS = [...ZOOMS, { key: 'fit', label: 'Fit' }];
// Team colours (Colour by team): solid tokens, 3:1 against the track like
// the status colours; the hover card and aria-label name the team.
const TEAM_COLORS = ['var(--ds-color-info)', 'var(--ds-color-success)', 'var(--ds-color-warning)', 'var(--ds-color-primary-800)', 'var(--ds-color-gray-600)', 'var(--ds-color-error)', 'var(--ds-color-primary-400)'];
const NO_TEAM_COLOR = 'var(--ds-color-gray-400)';
// Colour by risk (levels from lib/projectTimelineRisk).
const RISK_COLORS = { low: 'var(--ds-color-success)', medium: 'var(--ds-color-warning)', high: 'var(--ds-color-error)', critical: 'var(--ds-color-error-dark)' };
const RISK_LEGEND = [['Low risk (0–24)', RISK_COLORS.low], ['Medium (25–49)', RISK_COLORS.medium], ['High (50–74)', RISK_COLORS.high], ['Critical (75+)', RISK_COLORS.critical]];
const STATUS_DOT = {
  'To Do': 'var(--ds-text-secondary)',
  'In Progress': 'var(--ds-color-info)',
  Completed: 'var(--ds-color-success)',
  Delayed: 'var(--ds-color-error)',
  'On Hold': 'var(--ds-color-warning)',
};
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
// Popovers open towards the side with room (the toolbar wraps).
const alignPopover = (e) => {
  const el = e.currentTarget;
  if (!el.open) return;
  const r = el.getBoundingClientRect();
  const w = el.lastElementChild?.offsetWidth || 560;
  el.dataset.align = r.left + w > window.innerWidth && r.right - w >= 0 ? 'right' : 'left';
};

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

function Legend({ colorBy, teamColors, baselineLabel }) {
  return (
    <ul className={styles.legend} aria-label="Legend">
      {colorBy !== 'status' ? (
        teamColors.map(([name, color]) => (
          <li key={name}>
            <span className={styles.swatch} style={{ background: color }} aria-hidden="true" />
            {name}
          </li>
        ))
      ) : (
        <>
          <li><span className={`${styles.swatch} ${styles.barTodo}`} aria-hidden="true" />To Do</li>
          <li><span className={`${styles.swatch} ${styles.barProgress}`} aria-hidden="true" />In Progress</li>
          <li><span className={`${styles.swatch} ${styles.barDone}`} aria-hidden="true" />Completed</li>
          <li><span className={`${styles.swatch} ${styles.barDelayed}`} aria-hidden="true" />Delayed</li>
          <li><span className={`${styles.swatch} ${styles.barHold}`} aria-hidden="true" />On Hold</li>
          <li><span className={`${styles.swatch} ${styles.barTodo} ${styles.barOverdue}`} aria-hidden="true" />Overdue</li>
        </>
      )}
      <li><span className={`${styles.swatch} ${styles.swatchGhost}`} aria-hidden="true" />Likely finish (forecast)</li>
      <li><span className={`${styles.swatch} ${styles.swatchMilestone}`} aria-hidden="true" />One date only</li>
      <li><span className={`${styles.swatch} ${styles.swatchBaseline}`} aria-hidden="true" />{baselineLabel || 'Planned (baseline)'}</li>
      <li><span className={styles.swatchToday} aria-hidden="true" />Today</li>
      <li><span className={`${styles.swatch} ${styles.swatchCritical}`} aria-hidden="true" />Critical path</li>
      <li><span className={styles.swatchArrow} aria-hidden="true" />Starts after</li>
      <li><span className={`${styles.swatchArrow} ${styles.swatchArrowBad}`} aria-hidden="true" />Starts too early</li>
      <li><span className={`${styles.swatch} ${styles.swatchFill}`} aria-hidden="true" />Tickets done (solid part)</li>
      <li><span className={styles.swatchMismatch} aria-hidden="true" />Doesn’t match tickets</li>
    </ul>
  );
}

function HoverCard({ row, dates, team, overdue, baseline, moved, forecast, tickets, depCount, early, critical, dirty, canEdit, below, left, risk }) {
  const span = barSpan(dates.startDate, dates.endDate);
  const days = span ? span.end - span.start + 1 : null;
  const likelyLater = forecast && !forecast.done && forecast.end && dates.endDate && forecast.end > dates.endDate;
  return (
    <div className={`${styles.hoverCard} ${below ? styles.hoverBelow : styles.hoverAbove}`} style={{ left }} aria-hidden="true">
      <div className={styles.hcTitle}>{row.phase || 'New phase'}</div>
      <div className={styles.hcSub}>
        {row.module} · {team}
      </div>
      <div className={styles.hcStatus}>
        <span className={styles.hcDot} style={{ background: STATUS_DOT[row.status] || STATUS_DOT['To Do'] }} />
        {row.status}
        {overdue && <span className={styles.hcBad}> · overdue</span>}
        {critical && <span> · critical path</span>}
      </div>
      {risk && risk.score > 0 && (
        <div className={styles.hcRisk}>
          <strong>
            Risk {risk.score} · {risk.level.label}
          </strong>{' '}
          – {risk.reasons.map((x) => x.text).join(', ')}
        </div>
      )}
      <dl className={styles.hcFacts}>
        <dt>Dates</dt>
        <dd>
          {rangeText(dates.startDate, dates.endDate)}
          {days && !span.partial ? ` (${plural(days, 'day')})` : ''}
        </dd>
        {moved && baseline && (
          <>
            <dt>Planned</dt>
            <dd>
              {rangeText(baseline.baselineStart, baseline.baselineEnd)}
              {baseline.slip != null && <span className={baseline.slip > 0 ? styles.hcBad : ''}> ({formatSlip(baseline.slip)})</span>}
            </dd>
          </>
        )}
        {likelyLater && (
          <>
            <dt>Likely finish</dt>
            <dd className={styles.hcBad}>
              {formatDate(forecast.end)} (+{plural(dayNumber(forecast.end) - dayNumber(dates.endDate), 'day')})
            </dd>
          </>
        )}
        {tickets && (
          <>
            <dt>Tickets</dt>
            <dd>{progressText(tickets.progress)}</dd>
          </>
        )}
        {depCount > 0 && (
          <>
            <dt>Linked</dt>
            <dd>{plural(depCount, 'dependency')}</dd>
          </>
        )}
      </dl>
      {early > 0 && <div className={styles.hcBad}>Starts {plural(early, 'day')} before a phase it depends on allows.</div>}
      {(tickets?.mismatches || []).map((m) => (
        <div key={m.code || m.text} className={styles.hcBad}>
          {m.text}
        </div>
      ))}
      {dirty && <div className={styles.hcNote}>Unsaved change</div>}
      {canEdit && !span?.partial && <div className={styles.hcNote}>Drag to move · drag an end to resize · arrow keys</div>}
    </div>
  );
}

function Bar({ row, range, px, today, canEdit, overlaps, baseline, dirty, preview, critical, early, tickets, onDragStart, onKeyMove, color, forecast, showForecast, showBaseline, depCount, team, hovered, onHover, below, risk }) {
  const dates = preview || row;
  const span = barSpan(dates.startDate, dates.endDate);
  const base = baseline && barSpan(baseline.baselineStart, baseline.baselineEnd);
  const moved = base && span && (base.start !== span.start || base.end !== span.end);
  const overdue = isOverdue(dates, today);
  const overlapCount = overlaps?.length || 0;
  const milestone = span && (span.partial || span.start === span.end);
  const pct = tickets?.progress?.percent;
  // Forecast ghost: from the day after the current end to the likely end.
  const ghost = showForecast && !preview && span && !span.partial && forecast && !forecast.done && forecast.end && dates.endDate && forecast.end > dates.endDate ? dayNumber(forecast.end) : null;

  const label = [
    `${row.phase || 'New phase'}`,
    row.status,
    `team ${team}`,
    rangeText(dates.startDate, dates.endDate),
    overdue ? 'overdue' : null,
    overlapCount ? `overlaps ${overlapCount} phase${overlapCount === 1 ? '' : 's'}` : null,
    moved && baseline?.slip != null ? `slip ${formatSlip(baseline.slip)} against the plan` : null,
    ghost ? `likely to finish ${formatDate(forecast.end)}` : null,
    critical ? 'on the critical path' : null,
    risk && risk.score > 0 ? `risk ${risk.score} of 100, ${risk.level.label}` : null,
    early ? `starts ${early} day${early === 1 ? '' : 's'} before a phase it depends on allows` : null,
    tickets ? `tickets ${progressText(tickets.progress)}` : null,
    ...(tickets?.mismatches || []).map((m) => m.text),
    dirty ? 'unsaved change' : null,
  ]
    .filter(Boolean)
    .join(', ');

  const barLeft = span ? (span.start - range.start) * px : 0;
  const barWidth = span ? Math.max((span.end - span.start + 1) * px, 6) : 0;
  const labelLeft = milestone ? barLeft + px / 2 + 12 : (ghost ? (ghost - range.start + 1) * px : barLeft + barWidth) + 8;

  return (
    <>
      {moved && showBaseline && (
        <span className={styles.baseline} style={{ left: (base.start - range.start) * px, width: (base.end - base.start + 1) * px }} aria-hidden="true" />
      )}
      {ghost && (
        <span className={styles.ghost} style={{ left: barLeft + barWidth, width: (ghost - span.end) * px }} aria-hidden="true" />
      )}
      {span ? (
        <button
          type="button"
          className={[
            styles.bar,
            color ? '' : STATUS_CLASS[row.status] || styles.barTodo,
            overdue && !color ? styles.barOverdue : '',
            milestone ? styles.barMilestone : '',
            span.partial ? styles.barPartial : '',
            dirty ? styles.barDirty : '',
            critical ? styles.barCritical : '',
            canEdit ? styles.barEditable : '',
          ].join(' ')}
          style={
            milestone
              ? { left: barLeft + px / 2 - 8, ...(color ? { background: color } : {}) }
              : { left: barLeft, width: barWidth, ...(color ? { background: color } : {}) }
          }
          aria-label={label}
          onPointerDown={canEdit && !span.partial ? (e) => onDragStart(e, row, 'move') : undefined}
          onKeyDown={canEdit ? (e) => onKeyMove(e, row) : undefined}
          onMouseEnter={() => onHover(row.key)}
          onMouseLeave={() => onHover(null)}
          onFocus={() => onHover(row.key)}
          onBlur={() => onHover(null)}
        >
          {canEdit && !span.partial && !milestone && (
            <>
              <span className={`${styles.handle} ${styles.handleStart}`} onPointerDown={(e) => onDragStart(e, row, 'start')} aria-hidden="true" />
              <span className={`${styles.handle} ${styles.handleEnd}`} onPointerDown={(e) => onDragStart(e, row, 'end')} aria-hidden="true" />
            </>
          )}
          {/* Ticket progress: the done part stays solid, the rest is faded. */}
          {pct != null && !milestone && pct < 100 && <span className={styles.barRest} style={{ width: `${100 - pct}%` }} aria-hidden="true" />}
          {overlapCount > 0 && <span className={styles.overlapDot} aria-hidden="true" />}
          {tickets?.mismatches?.length > 0 && <span className={styles.mismatchDot} aria-hidden="true" />}
        </button>
      ) : (
        <span className={styles.noDates}>No dates</span>
      )}
      {span && !preview && (
        <span className={styles.barLabel} style={{ left: labelLeft }} aria-hidden="true">
          {row.phase || 'New phase'}
          {pct != null && <span className={styles.barLabelPct}> · {pct}%</span>}
        </span>
      )}
      {hovered && span && !preview && (
        <HoverCard
          row={row}
          dates={dates}
          team={team}
          overdue={overdue}
          baseline={baseline}
          moved={moved}
          forecast={forecast}
          tickets={tickets}
          depCount={depCount}
          early={early}
          critical={critical}
          dirty={dirty}
          canEdit={canEdit}
          below={below}
          left={Math.max(0, barLeft)}
          risk={risk}
        />
      )}
    </>
  );
}

export default function GanttView({ rows, today, teams, canEdit, overlaps, slipByKey, dirtyKeys, onChange, onEditInTable, deps = [], conflicts = [], critical, onDependencies, ticketInfoById, onTickets, forecastByKey, risks, fullScreen, whatIf = false, baselineLabel = null, todayLabel = 'Today' }) {
  const [zoom, setZoom] = useState('month');
  const [colorBy, setColorBy] = useState('status');
  const [showForecast, setShowForecast] = useState(true);
  const [showBaseline, setShowBaseline] = useState(true);
  const [hoverKey, setHoverKey] = useState(null);
  const [viewWidth, setViewWidth] = useState(0);
  const prefsLoaded = useRef(false);
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
  // Remembered view settings (this browser only).
  useEffect(() => {
    try {
      const p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
      if (ALL_ZOOMS.some((z) => z.key === p.zoom)) setZoom(p.zoom);
      if (['team', 'status', 'risk'].includes(p.colorBy)) setColorBy(p.colorBy);
      if (typeof p.showForecast === 'boolean') setShowForecast(p.showForecast);
      if (typeof p.showBaseline === 'boolean') setShowBaseline(p.showBaseline);
      if (typeof p.showCritical === 'boolean') setShowCritical(p.showCritical);
    } catch {
      // Unreadable settings: keep the defaults.
    }
    prefsLoaded.current = true;
  }, []);
  useEffect(() => {
    if (!prefsLoaded.current) return;
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ zoom, colorBy, showForecast, showBaseline, showCritical }));
    } catch {
      // Storage full or blocked: settings just aren't remembered.
    }
  }, [zoom, colorBy, showForecast, showBaseline, showCritical]);

  // Fit zoom needs the chart's visible width.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => setViewWidth(el.clientWidth));
    ro.observe(el);
    setViewWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [rows.length === 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const teamName = useMemo(() => new Map((teams || []).map((t) => [t.id, t.name])), [teams]);
  // Forecast ends count towards the chart's width, so ghosts fit.
  const rangeRows = useMemo(() => {
    if (!showForecast || !forecastByKey) return rows;
    const extra = [];
    for (const r of rows) {
      const f = forecastByKey.get(r.key);
      if (f && !f.done && f.end) extra.push({ key: `forecast:${r.key}`, startDate: f.end, endDate: f.end });
    }
    return extra.length ? [...rows, ...extra] : rows;
  }, [rows, forecastByKey, showForecast]);
  const range = useMemo(() => chartRange(rangeRows, slipByKey, today, zoom === 'fit' ? 'week' : zoom), [rangeRows, slipByKey, today, zoom]);
  const labelW = viewWidth && viewWidth <= 640 ? 150 : LABEL_WIDTH;
  // Fit leaves room after the last day for the label beside the last bar.
  const fitReserve = viewWidth && viewWidth <= 640 ? 0 : FIT_LABEL_ROOM;
  const px = zoom === 'fit' ? Math.max(1, (Math.max(viewWidth, 600) - labelW - 2 - fitReserve) / range.days) : zoomPx(zoom);
  // Fit picks the month ticks when there's room for them, none otherwise.
  const tickZoom = zoom === 'fit' ? (px >= 4 ? 'month' : 'quarter') : zoom;
  const months = useMemo(() => monthBands(range), [range]);
  const ticks = useMemo(() => tickMarks(range, tickZoom), [range, tickZoom]);
  // Colour by team: a stable colour per team (plan order), grey for none.
  const teamColor = useMemo(() => new Map((teams || []).map((t, i) => [t.id, TEAM_COLORS[i % TEAM_COLORS.length]])), [teams]);
  const colorOf = (r) => {
    if (colorBy === 'team') return r.teamId != null ? teamColor.get(r.teamId) || NO_TEAM_COLOR : NO_TEAM_COLOR;
    if (colorBy === 'risk') return RISK_COLORS[risks?.get(r.key)?.level.key || 'low'];
    return null;
  };
  const teamLegend = useMemo(() => {
    const used = new Set(rows.map((r) => r.teamId ?? null));
    const list = (teams || []).filter((t) => used.has(t.id)).map((t) => [t.name, teamColor.get(t.id)]);
    if (used.has(null)) list.push(['No team', NO_TEAM_COLOR]);
    return list;
  }, [rows, teams, teamColor]);
  const groups = useMemo(() => groupByModule(rows), [rows]);
  const trackWidth = range.days * px + (zoom === 'fit' ? fitReserve : 0);
  const todayOffset = (dayNumber(today) - range.start) * px;

  const scrollToToday = () => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = Math.max(0, todayOffset - (el.clientWidth - labelW) / 3);
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

  // Visible row order, so the first rows open their hover card below the
  // bar (above would be under the header).
  const visibleIndex = new Map();
  {
    let i = 0;
    for (const g of groups) {
      i += 1;
      if (!collapsed.has(g.key)) for (const r of g.rows) visibleIndex.set(r.key, i++);
    }
  }
  const doneCount = (list) => list.filter((r) => r.status === 'Completed').length;

  if (rows.length === 0) return <p className={styles.empty}>No phases to show.</p>;

  return (
    <div className={styles.wrap}>
      <div className={styles.controls}>
        <div className={styles.zoom} role="group" aria-label="Zoom">
          {ALL_ZOOMS.map((z) => (
            <button key={z.key} type="button" className={`${styles.zoomButton} ${zoom === z.key ? styles.zoomActive : ''}`} aria-pressed={zoom === z.key} onClick={() => setZoom(z.key)} title={z.key === 'fit' ? 'Whole plan in view' : undefined}>
              {z.label}
            </button>
          ))}
        </div>
        {zoom !== 'fit' && (
          <button type="button" className={styles.todayButton} onClick={scrollToToday}>
            <Crosshair size={14} aria-hidden="true" /> Today
          </button>
        )}
        <div className={styles.zoom} role="group" aria-label="Colour bars by">
          <span className={styles.groupLabel}>
            <Palette size={14} aria-hidden="true" /> Colour
          </span>
          {[
            ['status', 'Status'],
            ['team', 'Team'],
            ['risk', 'Risk'],
          ].map(([key, label]) => (
            <button key={key} type="button" className={`${styles.zoomButton} ${colorBy === key ? styles.zoomActive : ''}`} aria-pressed={colorBy === key} onClick={() => setColorBy(key)}>
              {label}
            </button>
          ))}
        </div>
        <div className={styles.toggles} role="group" aria-label="Show on the chart">
          {[
            ['Forecast', showForecast, setShowForecast],
            [baselineLabel ? baselineLabel.split(' (')[0] : whatIf ? 'Real plan' : 'Baseline', showBaseline, setShowBaseline],
            ['Critical path', showCritical, setShowCritical],
          ].map(([label, on, set]) => (
            <button key={label} type="button" className={`${styles.toggle} ${on ? styles.toggleOn : ''}`} aria-pressed={on} onClick={() => set((v) => !v)}>
              <span className={styles.toggleBox} aria-hidden="true">
                {on && <Check size={12} />}
              </span>
              {label}
            </button>
          ))}
        </div>
        <span className={styles.controlsSpacer} />
        {critical?.projectEnd && (
          <span className={styles.criticalLine}>
            <Route size={16} aria-hidden="true" />
            <span>
              Project end <strong>{formatDate(critical.projectEnd)}</strong>
              {' · '}critical path {plural(critical.chain.length, 'phase')}
              {deps.length === 0 && ' (add dependencies to see the chain that drives it)'}
            </span>
          </span>
        )}
        <details className={styles.popover} onToggle={alignPopover}>
          <summary className={styles.todayButton}>Legend</summary>
          <div className={styles.popoverBody}>
            <Legend colorBy={colorBy} teamColors={colorBy === 'risk' ? RISK_LEGEND : teamLegend} baselineLabel={baselineLabel || (whatIf ? 'Real plan (before your what-if moves)' : null)} />
          </div>
        </details>
        {canEdit && (
          <details className={styles.popover} onToggle={alignPopover}>
            <summary className={styles.todayButton}>
              <CircleHelp size={14} aria-hidden="true" /> How to edit
            </summary>
            <div className={`${styles.popoverBody} ${styles.popoverRight}`}>
              <p className={styles.hint}>
                Drag a bar to move a phase, or drag its ends to change one date. With a bar selected, the left and right arrow keys move it a day, and
                Shift with an arrow key changes the end date. Changes stay on this page until you click Save changes.
              </p>
            </div>
          </details>
        )}
      </div>

      <div className={`${styles.scroll} ${fullScreen ? styles.scrollFull : ''} ${drag?.moved ? styles.dragging : ''}`} ref={scrollRef}>
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
                    {m.days * px > 64 ? m.label : m.days * px > 30 ? m.label.slice(0, 3) : ''}
                  </span>
                ))}
              </div>
              <span className={styles.todayPill} style={{ left: todayOffset }} title={`${todayLabel}, ${formatDate(today)}`}>
                {todayLabel}
              </span>
              {ticks.length > 0 && (
                <div className={styles.ticks}>
                  {ticks.map((t) => (
                    <span key={t.key} className={`${styles.tick} ${t.weekend ? styles.tickWeekend : ''}`} style={{ left: t.offset * px, width: (tickZoom === 'week' ? 1 : 7) * px }}>
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
                        {doneCount(g.rows)}/{g.rows.length} done
                        {overdueCount > 0 && <span className={styles.moduleOverdue}> · {overdueCount} overdue</span>}
                      </span>
                    </button>
                  </div>
                  <div className={styles.track} style={{ width: trackWidth, '--day': `${px}px` }}>
                    {gStart != null && (
                      <>
                        <span
                          className={styles.moduleSpan}
                          style={{ left: (gStart - range.start) * px, width: (gEnd - gStart + 1) * px }}
                          title={`${g.name}: ${formatDate(isoFromDay(gStart))} to ${formatDate(isoFromDay(gEnd))}, ${Math.round((doneCount(g.rows) / g.rows.length) * 100)}% of phases completed`}
                          aria-hidden="true"
                        >
                          <span className={styles.moduleFill} style={{ width: `${(doneCount(g.rows) / g.rows.length) * 100}%` }} />
                        </span>
                        <span className={styles.moduleSpanLabel} style={{ left: (gEnd - range.start + 1) * px + 8 }} aria-hidden="true">
                          {Math.round((doneCount(g.rows) / g.rows.length) * 100)}%
                        </span>
                      </>
                    )}
                  </div>
                </div>

                {isOpen &&
                  g.rows.map((r) => (
                    <div key={r.key} className={styles.row} ref={(el) => (el ? rowEls.current.set(r.key, el) : rowEls.current.delete(r.key))}>
                      <div className={styles.label}>
                        <span className={styles.statusDot} style={{ background: STATUS_DOT[r.status] || STATUS_DOT['To Do'] }} title={r.status} aria-hidden="true" />
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
                      <div className={`${styles.track} ${zoom === 'week' ? styles.trackWeek : ''} ${hoverKey === r.key ? styles.trackHover : ''}`} style={{ width: trackWidth, '--day': `${px}px` }}>
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
                          color={colorOf(r)}
                          forecast={forecastByKey?.get(r.key)}
                          showForecast={showForecast}
                          showBaseline={showBaseline}
                          depCount={r.id != null ? depCount.get(r.id) || 0 : 0}
                          team={r.teamId != null ? teamName.get(r.teamId) || 'Unknown team' : 'No team'}
                          hovered={hoverKey === r.key && !drag}
                          onHover={setHoverKey}
                          below={(visibleIndex.get(r.key) || 0) <= 3}
                          risk={risks?.get(r.key)}
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
