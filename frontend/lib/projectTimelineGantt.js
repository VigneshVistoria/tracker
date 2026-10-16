// Project Timeline - Gantt view helpers (Stage A, 2026-10-16). Pure date
// maths on 'YYYY-MM-DD' strings, done in whole UTC days so there is no
// time-zone drift (same idea as addDaysIso in projectTimeline.js).

const DAY_MS = 86400000;

// Pixels per day for each zoom level.
export const ZOOMS = [
  { key: 'week', label: 'Week', px: 28 },
  { key: 'month', label: 'Month', px: 8 },
  { key: 'quarter', label: 'Quarter', px: 3 },
];

export function zoomPx(key) {
  return (ZOOMS.find((z) => z.key === key) || ZOOMS[1]).px;
}

export function dayNumber(iso) {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

export function isoFromDay(day) {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

// 0 = Monday ... 6 = Sunday.
function weekdayMon(day) {
  return (new Date(day * DAY_MS).getUTCDay() + 6) % 7;
}

// The days the chart covers: every current and baseline date plus today,
// padded, starting on a Monday so week shading and ticks line up.
export function chartRange(rows, baselineByKey, today, zoom) {
  const days = [dayNumber(today)];
  for (const r of rows) {
    if (r.startDate) days.push(dayNumber(r.startDate));
    if (r.endDate) days.push(dayNumber(r.endDate));
    const b = baselineByKey?.get(r.key);
    if (b?.baselineStart) days.push(dayNumber(b.baselineStart));
    if (b?.baselineEnd) days.push(dayNumber(b.baselineEnd));
  }
  const pad = zoom === 'week' ? 7 : zoom === 'month' ? 14 : 30;
  let start = Math.min(...days) - pad;
  start -= weekdayMon(start);
  const end = Math.max(...days) + pad * 2;
  return { start, end, days: end - start + 1 };
}

// Month bands for the top header row.
export function monthBands(range) {
  const bands = [];
  let day = range.start;
  while (day <= range.end) {
    const d = new Date(day * DAY_MS);
    const next = Math.round(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / DAY_MS);
    const last = Math.min(next - 1, range.end);
    bands.push({
      key: `${d.getUTCFullYear()}-${d.getUTCMonth()}`,
      label: d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }),
      offset: day - range.start,
      days: last - day + 1,
    });
    day = next;
  }
  return bands;
}

// Second header row: each day (week zoom) or each Monday (month zoom).
export function tickMarks(range, zoom) {
  const ticks = [];
  if (zoom === 'quarter') return ticks;
  for (let day = range.start; day <= range.end; day += zoom === 'week' ? 1 : 7) {
    const d = new Date(day * DAY_MS);
    ticks.push({
      key: day,
      offset: day - range.start,
      label: String(d.getUTCDate()),
      weekday: zoom === 'week' ? d.toLocaleDateString('en-US', { weekday: 'narrow', timeZone: 'UTC' }) : null,
      weekend: zoom === 'week' && weekdayMon(day) >= 5,
    });
  }
  return ticks;
}

// The bar for a row: both dates, or just one (drawn as a one-day marker),
// or null when it has none.
export function barSpan(startDate, endDate) {
  if (!startDate && !endDate) return null;
  const s = dayNumber(startDate || endDate);
  const e = dayNumber(endDate || startDate);
  return { start: s, end: e, partial: !startDate || !endDate };
}

// New dates after dragging `delta` days. mode: 'move' | 'start' | 'end'.
// Resizing never lets the end go before the start (or vice versa).
export function dragDates(row, mode, delta) {
  const add = (iso) => iso && isoFromDay(dayNumber(iso) + delta);
  if (mode === 'move') return { startDate: add(row.startDate), endDate: add(row.endDate) };
  if (mode === 'start') {
    const next = add(row.startDate);
    return { startDate: row.endDate && next > row.endDate ? row.endDate : next, endDate: row.endDate };
  }
  const next = add(row.endDate);
  return { startDate: row.startDate, endDate: row.startDate && next < row.startDate ? row.startDate : next };
}
