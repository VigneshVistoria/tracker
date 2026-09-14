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

// The one date format used everywhere in the app: "Sep 13, 2026". Locale is
// pinned to 'en-US' (not the browser's default) so this can't drift into
// "13 Sep 2026" or similar for a viewer with a different browser locale.
export function formatDate(value) {
  if (!value) return '—';
  return toDate(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Same date format plus a time, for timestamps where the time matters (e.g.
// "Sep 13, 2026, 02:30 PM").
export function formatDateTime(value) {
  if (!value) return '—';
  return toDate(value).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}
