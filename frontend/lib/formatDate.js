const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

// A plain 'YYYY-MM-DD' string (e.g. a Postgres `date` column like
// ProjectTask.dueDate) is parsed by `new Date(...)` as UTC midnight - in any
// timezone behind UTC, formatting that with toLocaleDateString/toLocaleString
// then renders the day *before* the actual date. Parsing it as local
// midnight instead avoids that shift; anything else (a full ISO timestamp,
// or an already-constructed Date) is passed through unchanged.
function toDate(value) {
  if (value instanceof Date) return value;
  if (typeof value === 'string' && DATE_ONLY_RE.test(value)) {
    return new Date(`${value}T00:00:00`);
  }
  return new Date(value);
}

// Day-month-year with dashes, "20-11-2026" (Release progress on the task
// page, 2026-11-20 - the user's format). Viewer's local date, like formatDate.
export function formatDateDMY(value) {
  if (!value) return '—';
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
}

// The one date format used everywhere in the app: "Sep 13, 2026". Locale is
// pinned to 'en-US' (not the browser's default) so this can't drift into
// "13 Sep 2026" or similar for a viewer with a different browser locale.
export function formatDate(value) {
  if (!value) return '—';
  return toDate(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Same date format plus a time, for timestamps where the time matters (e.g.
// "Sep 13, 2026, 02:30 PM"). Pass an IANA timeZone to show the time on a
// fixed clock (e.g. the team's) instead of the viewer's browser.
export function formatDateTime(value, timeZone) {
  if (!value) return '—';
  return toDate(value).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    ...(timeZone ? { timeZone } : {}),
  });
}

// "just now", "5 min ago", "3 hr ago", "2 days ago" - then the normal
// date once it's more than a week old. Locale pinned like formatDate().
const relativeFormatter = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto', style: 'short' });
export function formatRelativeTime(value, now = Date.now()) {
  if (!value) return '—';
  const seconds = Math.round((toDate(value).getTime() - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return 'just now';
  if (abs < 3600) return relativeFormatter.format(Math.round(seconds / 60), 'minute');
  if (abs < 86400) return relativeFormatter.format(Math.round(seconds / 3600), 'hour');
  if (abs < 7 * 86400) return relativeFormatter.format(Math.round(seconds / 86400), 'day');
  return formatDate(value);
}

// "Oct 15" - a short date for tight spots (Daily Scrum's compact cards).
// Locale pinned like formatDate().
export function formatMonthDay(value) {
  if (!value) return '—';
  return toDate(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// "Thursday, Oct 15" - for a plain day where the weekday matters (e.g.
// Daily Scrum's "since last working day"). Locale pinned like formatDate().
export function formatWeekdayDate(value) {
  if (!value) return '—';
  return toDate(value).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}
