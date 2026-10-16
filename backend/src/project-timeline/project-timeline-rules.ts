// Project Timeline (2026-10-16): every rule the import preview, the import
// itself and "Save changes" share - file columns, date and status parsing,
// name tidying and fix suggestions, the re-upload diff, overdue and
// overlap. Pure (no Nest/TypeORM imports) so it can be tested with a fixed
// "today", same as team-settings/time-zone.ts.

export const TIMELINE_STATUSES = ['To Do', 'In Progress', 'Completed', 'Delayed', 'On Hold'] as const;
export type TimelineStatus = (typeof TIMELINE_STATUSES)[number];

// The file's columns, in template order. All six must be present.
export const TIMELINE_COLUMNS = ['Module', 'Phase', 'Team', 'Status', 'Start Date', 'End Date'] as const;

export const MAX_MODULE_LENGTH = 200;
export const MAX_PHASE_LENGTH = 300;
export const MAX_TEAM_NAME_LENGTH = 100;

export type RowField = 'module' | 'phase' | 'team' | 'status' | 'startDate' | 'endDate';

// One row exactly as it came out of the file (or as the PM fixed it in the
// preview) - strings, nothing parsed yet.
export interface RawRow {
  rowNumber: number;
  module: string;
  phase: string;
  team: string;
  status: string;
  startDate: string;
  endDate: string;
}

export interface TeamRef {
  id: number;
  name: string;
  isActive: boolean;
}

// A saved plan row, reduced to what the rules need.
export interface PlanRow {
  id: number;
  module: string;
  phase: string;
  teamId: number | null;
  status: TimelineStatus;
  startDate: string | null;
  endDate: string | null;
}

// ---------------------------------------------------------------- names

// Trims and collapses runs of whitespace (including non-breaking spaces).
export function tidyName(value: string | null | undefined): string {
  return String(value ?? '').replace(/[\s ]+/g, ' ').trim();
}

export function nameKey(value: string): string {
  return tidyName(value).toLowerCase();
}

// What re-uploads match on: Project + Module + Phase, ignoring case and
// extra spaces. Stored as project_timeline_rows.matchKey.
export function matchKeyFor(module: string, phase: string): string {
  return `${nameKey(module)}|${nameKey(phase)}`;
}

// Punctuation-blind key for near-duplicates: "Pilot Run - Staging" and
// "Pilot Run (Staging)" both become "pilot run staging".
export function looseKey(value: string): string {
  return tidyName(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------- columns

const columnKey = (header: string) => header.toLowerCase().replace(/[^a-z]/g, '');
const COLUMN_FIELDS: Record<string, RowField> = {
  module: 'module',
  phase: 'phase',
  team: 'team',
  status: 'status',
  startdate: 'startDate',
  start: 'startDate',
  enddate: 'endDate',
  end: 'endDate',
};
const FIELD_COLUMN: Record<RowField, string> = {
  module: 'Module',
  phase: 'Phase',
  team: 'Team',
  status: 'Status',
  startDate: 'Start Date',
  endDate: 'End Date',
};

export interface SheetRows {
  rows: RawRow[];
  missingColumns: string[];
  ignoredColumns: string[];
}

// Maps a parsed sheet (header row + cells) onto RawRows. Header names are
// matched loosely ("start date", "Start_Date", "StartDate"); columns that
// match nothing are reported, never silently dropped.
export function rowsFromSheet(sheet: { headers: string[]; rows: { rowNumber: number; cells: string[] }[] }): SheetRows {
  const fieldAt = new Map<RowField, number>();
  const ignoredColumns: string[] = [];
  sheet.headers.forEach((header, i) => {
    const field = COLUMN_FIELDS[columnKey(header)];
    if (field && !fieldAt.has(field)) fieldAt.set(field, i);
    else if (header.trim() !== '') ignoredColumns.push(header.trim());
  });
  const missingColumns = (Object.keys(FIELD_COLUMN) as RowField[]).filter((f) => !fieldAt.has(f)).map((f) => FIELD_COLUMN[f]);
  const cell = (cells: string[], field: RowField) => (fieldAt.has(field) ? cells[fieldAt.get(field)!] ?? '' : '');
  const rows = sheet.rows.map(({ rowNumber, cells }) => ({
    rowNumber,
    module: cell(cells, 'module'),
    phase: cell(cells, 'phase'),
    team: cell(cells, 'team'),
    status: cell(cells, 'status'),
    startDate: cell(cells, 'startDate'),
    endDate: cell(cells, 'endDate'),
  }));
  return { rows, missingColumns, ignoredColumns };
}

// ---------------------------------------------------------------- dates

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};

function isoFrom(year: number, month: number, day: number): string | null {
  if (year < 2000 || year > 2099 || month < 1 || month > 12 || day < 1) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null; // 31-Feb etc.
  return d.toISOString().slice(0, 10);
}

const ISO_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
// 1-Jul-26, 01-Jul-2026, 1 Jul 2026, 1/Jul/26
const DAY_MONTH_YEAR_RE = /^(\d{1,2})[-\s/.]+([a-z]{3,9})\.?[-\s/.,]+(\d{2}|\d{4})$/i;
// Jul 1, 2026 (the app's own display format)
const MONTH_DAY_YEAR_RE = /^([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/i;

// error is set (and value null) when the text can't be read.
export type DateParse = { value: string | null; error?: string };

// File dates: the plan's own "1-Jul-26" (2-digit years are 20YY), ISO
// "2026-07-01", "Jul 1, 2026", or a real Excel date cell (which
// parseSpreadsheet() already turns into ISO). Purely numeric forms like
// 07/01/26 are refused - day/month order can't be known. Empty is fine.
export function parsePlanDate(raw: string | null | undefined): DateParse {
  const s = String(raw ?? '').trim();
  if (s === '') return { value: null };
  let value: string | null = null;
  let m: RegExpMatchArray | null;
  if ((m = s.match(ISO_RE))) {
    value = isoFrom(Number(m[1]), Number(m[2]), Number(m[3]));
  } else if ((m = s.match(DAY_MONTH_YEAR_RE))) {
    const month = MONTHS[m[2].toLowerCase()];
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    value = month ? isoFrom(year, month, Number(m[1])) : null;
  } else if ((m = s.match(MONTH_DAY_YEAR_RE))) {
    const month = MONTHS[m[1].toLowerCase()];
    value = month ? isoFrom(Number(m[3]), month, Number(m[2])) : null;
  }
  if (!value) return { value: null, error: `"${s}" is not a date that can be read - use a date like 1-Jul-26` };
  return { value };
}

// "Jul 1, 2026" - the app's standard display format (frontend formatDate()),
// for messages built here.
export function displayDate(iso: string | null): string {
  if (!iso) return 'no date';
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

// Shifts a YYYY-MM-DD date by whole days.
export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------- status

const STATUS_BY_KEY = new Map<string, TimelineStatus>(TIMELINE_STATUSES.map((s) => [s.toLowerCase().replace(/[^a-z]/g, ''), s]));

// Case/space/hyphen-blind: "to do", "ToDo", "TO-DO" are all "To Do".
// null = empty (the caller decides what empty means).
export function parseStatus(raw: string | null | undefined): { value: TimelineStatus | null; error?: string } {
  const s = String(raw ?? '').trim();
  if (s === '') return { value: null };
  const value = STATUS_BY_KEY.get(s.toLowerCase().replace(/[^a-z]/g, ''));
  if (!value) return { value: null, error: `Status "${s}" is not one of: ${TIMELINE_STATUSES.join(', ')}` };
  return { value };
}

// ------------------------------------------------- row values (edit + import)

export interface RowValues {
  module: string;
  phase: string;
  status: TimelineStatus;
  startDate: string | null;
  endDate: string | null;
}

// The blocking checks every saved row must pass - the same for an import
// row and for an edited row. Returns the problems, empty if fine.
export function rowValueErrors(v: { module: string; phase: string; startDate: string | null; endDate: string | null }): string[] {
  const errors: string[] = [];
  if (v.module === '') errors.push('Module is empty');
  if (v.phase === '') errors.push('Phase is empty');
  if (v.module.length > MAX_MODULE_LENGTH) errors.push(`Module is longer than ${MAX_MODULE_LENGTH} characters`);
  if (v.phase.length > MAX_PHASE_LENGTH) errors.push(`Phase is longer than ${MAX_PHASE_LENGTH} characters`);
  if (v.startDate && v.endDate && v.endDate < v.startDate) {
    errors.push(`End date (${displayDate(v.endDate)}) is before the start date (${displayDate(v.startDate)})`);
  }
  return errors;
}

// Non-blocking: shown, never stops a save. `today` is YYYY-MM-DD in the
// team's time zone.
export function rowValueWarnings(v: RowValues, today: string): string[] {
  const warnings: string[] = [];
  if (!v.startDate) warnings.push('No start date');
  if (!v.endDate) warnings.push('No end date');
  if (v.status === 'Completed' && v.endDate && v.endDate > today) warnings.push(`Completed, but the end date (${displayDate(v.endDate)}) is in the future`);
  if (v.status === 'To Do' && v.endDate && v.endDate < today) warnings.push(`Still To Do, but the end date (${displayDate(v.endDate)}) has passed`);
  return warnings;
}

// Overdue = To Do only, with an end date before today (team time zone).
// Delayed has its own red status; In Progress / On Hold / Completed are
// never overdue; no end date is never overdue. (Confirmed 2026-10-16.)
export function isOverdue(row: { status: string; endDate: string | null }, today: string): boolean {
  return row.status === 'To Do' && !!row.endDate && row.endDate < today;
}

// ---------------------------------------------------------------- overlap

export interface OverlapSide {
  id?: number;
  rowNumber?: number;
  phase: string;
  startDate: string;
  endDate: string;
}
export interface OverlapPair {
  module: string;
  a: OverlapSide;
  b: OverlapSide;
}

// Every pair of phases in the same module (not just neighbours) whose date
// ranges really overlap. Touching is fine: one ending Jul 5 and the next
// starting Jul 5 is not an overlap (confirmed 2026-10-16). Rows missing
// either date are left out.
export function findOverlaps<T extends { module: string; phase: string; startDate: string | null; endDate: string | null; id?: number; rowNumber?: number }>(
  rows: T[],
): OverlapPair[] {
  const byModule = new Map<string, T[]>();
  for (const r of rows) {
    if (!r.startDate || !r.endDate) continue;
    const key = nameKey(r.module);
    if (!byModule.has(key)) byModule.set(key, []);
    byModule.get(key)!.push(r);
  }
  const side = (r: T): OverlapSide => ({ id: r.id, rowNumber: r.rowNumber, phase: r.phase, startDate: r.startDate!, endDate: r.endDate! });
  const pairs: OverlapPair[] = [];
  for (const group of byModule.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];
        if (a.startDate! < b.endDate! && b.startDate! < a.endDate!) pairs.push({ module: a.module, a: side(a), b: side(b) });
      }
    }
  }
  return pairs;
}

// ------------------------------------------------------------- plan summary

export interface PastEndRow {
  id?: number;
  module: string;
  phase: string;
  status: string;
  endDate: string;
}
export interface PlanSummary {
  rows: number;
  modules: number;
  overdue: number;
  delayed: number;
  overlaps: OverlapPair[];
  // Information only - not counted as overdue.
  delayedPastEnd: PastEndRow[];
  inProgressPastEnd: PastEndRow[];
}

export function summarizePlan<T extends { id?: number; module: string; phase: string; status: string; startDate: string | null; endDate: string | null }>(
  rows: T[],
  today: string,
): PlanSummary {
  const pastEnd = (status: string) =>
    rows
      .filter((r) => r.status === status && !!r.endDate && r.endDate < today)
      .map((r) => ({ id: r.id, module: r.module, phase: r.phase, status: r.status, endDate: r.endDate! }));
  return {
    rows: rows.length,
    modules: new Set(rows.map((r) => nameKey(r.module))).size,
    overdue: rows.filter((r) => isOverdue(r, today)).length,
    delayed: rows.filter((r) => r.status === 'Delayed').length,
    overlaps: findOverlaps(rows),
    delayedPastEnd: pastEnd('Delayed'),
    inProgressPastEnd: pastEnd('In Progress'),
  };
}

// ------------------------------------------------------------- suggestions

// Words a plan is likely to use, so a one-off misspelling ("Migratiaon",
// "Prodcution") is caught even when the correct word appears nowhere else
// in the file. Lower case; plurals listed where they're common so they're
// never "corrected" to the singular.
const DICTIONARY = new Set(
  `acceptance access analysis application applications approval approvals architecture assessment audit authorization
  automation backend billing build business change changes claim claims cleanup closure code completion configuration
  content continuous conversion customer cutover dashboard dashboards data database defect defects delivery demo
  deployment design development discovery document documentation documents endorsement endorsements enhancement
  enhancements environment environments execution feedback final finance fixes frontend functional gathering golive
  handover hypercare implementation improvement improvements initiation insurance integration interface interfaces
  internal kickoff launch live maintenance management mapping medical migration mobile module modules monitoring
  network onboarding operations optimization payment payments performance phase pilot planning platform policy
  policies portal premium preparation process production project prototype quality readiness reconciliation regression
  rehearsal release releases renewal renewals report reporting reports requirement requirements review reviews rollout
  security server setup signoff sign off specification specifications sprint stabilization staging support system
  systems technical testing tests training transition underwriting upgrade user users validation verification
  walkthrough workflow workflows workshop workshops`.split(/\s+/).filter(Boolean),
);

// Damerau-Levenshtein, optimal string alignment variant - a swapped pair
// ("Prodcution") costs 1, not 2.
export function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

const maxTypoDistance = (length: number) => (length >= 8 ? 2 : length >= 5 ? 1 : 0);
// "Claim" vs "Claims", "Test" vs "Tested" - a different form, not a typo.
const isInflection = (a: string, b: string) => {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return long.startsWith(short) && ['s', 'es', 'ed', 'ing', 'd'].includes(long.slice(short.length));
};

function matchCase(original: string, replacement: string): string {
  if (original === original.toUpperCase()) return replacement.toUpperCase();
  if (original[0] === original[0].toUpperCase()) return replacement[0].toUpperCase() + replacement.slice(1);
  return replacement;
}

// Builds a word -> correction map from every name in play (with
// repetition, so "Migration" used 12 times outvotes "Migratiaon" used
// once). A word is only ever corrected towards a dictionary word or a
// word used more often than it.
export function typoCorrections(names: string[]): Map<string, string> {
  const freq = new Map<string, number>();
  for (const name of names) {
    for (const w of name.toLowerCase().match(/[a-z]+/g) || []) freq.set(w, (freq.get(w) || 0) + 1);
  }
  const candidates = new Set([...DICTIONARY, ...freq.keys()]);
  const corrections = new Map<string, string>();
  for (const [word, count] of freq) {
    if (DICTIONARY.has(word)) continue;
    const limit = maxTypoDistance(word.length);
    if (limit === 0) continue;
    let best: { word: string; distance: number; known: boolean; freq: number } | null = null;
    for (const c of candidates) {
      if (c === word || Math.abs(c.length - word.length) > limit || isInflection(c, word)) continue;
      const known = DICTIONARY.has(c);
      const cFreq = freq.get(c) || 0;
      if (!known && cFreq <= count) continue;
      const distance = editDistance(word, c);
      if (distance > limit) continue;
      const better =
        !best || distance < best.distance || (distance === best.distance && (known && !best.known || (known === best.known && cFreq > best.freq)));
      if (better) best = { word: c, distance, known, freq: cFreq };
    }
    if (best) corrections.set(word, best.word);
  }
  return corrections;
}

export function correctTypos(name: string, corrections: Map<string, string>): string {
  return name.replace(/[A-Za-z]+/g, (w) => {
    const fix = corrections.get(w.toLowerCase());
    return fix ? matchCase(w, fix) : w;
  });
}

// For near-duplicates: the spelling every punctuation-blind variant
// should use - the saved plan's spelling if it has one, else the most used
// one in the file, else the first seen.
export function canonicalSpellings(fileNames: string[], savedNames: string[]): Map<string, string> {
  const groups = new Map<string, Map<string, { saved: number; file: number; first: number }>>();
  const add = (name: string, saved: boolean, order: number) => {
    const key = looseKey(name);
    if (!key) return;
    if (!groups.has(key)) groups.set(key, new Map());
    const g = groups.get(key)!;
    const e = g.get(name) || { saved: 0, file: 0, first: order };
    if (saved) e.saved += 1;
    else e.file += 1;
    g.set(name, e);
  };
  savedNames.forEach((n, i) => add(n, true, i));
  fileNames.forEach((n, i) => add(n, false, savedNames.length + i));
  const canonical = new Map<string, string>();
  for (const [key, g] of groups) {
    if (g.size < 2) continue;
    const [best] = [...g.entries()].sort(([, x], [, y]) => y.saved - x.saved || y.file - x.file || x.first - y.first);
    canonical.set(key, best[0]);
  }
  return canonical;
}

// ---------------------------------------------------------------- preview

export interface Suggestion {
  field: 'module' | 'phase' | 'team';
  from: string;
  to: string;
  reason: 'typo' | 'near_duplicate' | 'existing_team';
  message: string;
}

export type DiffStatus = 'new' | 'changed' | 'unchanged';

export interface PreviewRowValues {
  module: string;
  phase: string;
  team: string | null;
  teamId: number | null;
  status: TimelineStatus;
  startDate: string | null;
  endDate: string | null;
}

export interface PreviewRow {
  rowNumber: number;
  include: boolean;
  raw: RawRow;
  values: PreviewRowValues;
  // Fields whose extra spaces were removed automatically.
  tidied: RowField[];
  // Unknown team name - added to the Team list if this row is imported.
  newTeam: boolean;
  errors: string[];
  warnings: string[];
  suggestions: Suggestion[];
  diff: DiffStatus | null;
  existingId: number | null;
  changes: Partial<Record<RowField, { old: string | null; new: string | null }>>;
}

export interface PreviewInputRow extends RawRow {
  include?: boolean;
}

export interface PreviewResult {
  rows: PreviewRow[];
  // Saved rows the file doesn't mention - kept unless the PM asks to delete them.
  missing: (PlanRow & { teamName: string | null })[];
  summary: {
    totalRows: number;
    modules: number;
    includedRows: number;
    errorRows: number;
    warningRows: number;
    warnings: number;
    suggestions: number;
    newRows: number;
    changedRows: number;
    unchangedRows: number;
    missingRows: number;
    toImport: number;
    newTeams: string[];
    afterImport: PlanSummary;
  };
}

export function buildPreview(input: { rows: PreviewInputRow[]; saved: PlanRow[]; teams: TeamRef[]; today: string }): PreviewResult {
  const { saved, teams, today } = input;
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const teamByKey = new Map(teams.map((t) => [nameKey(t.name), t]));
  const savedByKey = new Map(saved.map((r) => [matchKeyFor(r.module, r.phase), r]));
  const teamName = (id: number | null) => (id != null ? teamById.get(id)?.name ?? null : null);

  const rows: PreviewRow[] = input.rows.map((raw) => {
    const include = raw.include !== false;
    const module = tidyName(raw.module);
    const phase = tidyName(raw.phase);
    const team = tidyName(raw.team);
    const tidied: RowField[] = [];
    if (module !== String(raw.module ?? '') && module !== '') tidied.push('module');
    if (phase !== String(raw.phase ?? '') && phase !== '') tidied.push('phase');
    if (team !== String(raw.team ?? '') && team !== '') tidied.push('team');

    const errors: string[] = [];
    const warnings: string[] = [];
    const start = parsePlanDate(raw.startDate);
    const end = parsePlanDate(raw.endDate);
    if (start.error) errors.push(`Start date: ${start.error}`);
    if (end.error) errors.push(`End date: ${end.error}`);
    const status = parseStatus(raw.status);
    if (status.error) errors.push(status.error);
    const startDate = start.value;
    const endDate = end.value;
    errors.push(...rowValueErrors({ module, phase, startDate, endDate }));
    if (team.length > MAX_TEAM_NAME_LENGTH) errors.push(`Team is longer than ${MAX_TEAM_NAME_LENGTH} characters`);

    let statusValue: TimelineStatus = 'To Do';
    if (status.value) statusValue = status.value;
    else if (!status.error) warnings.push('No status - it will be To Do');

    const known = team ? teamByKey.get(nameKey(team)) : undefined;
    const values: PreviewRowValues = {
      module,
      phase,
      team: team ? known?.name ?? team : null,
      teamId: known?.id ?? null,
      status: statusValue,
      startDate,
      endDate,
    };
    const newTeam = !!team && !known;
    if (newTeam) warnings.push(`Team "${team}" is not in the Team list - it will be added`);
    else if (known && !known.isActive) warnings.push(`Team "${known.name}" is inactive`);
    warnings.push(...rowValueWarnings(values, today));

    return { rowNumber: raw.rowNumber, include, raw, values, tidied, newTeam, errors, warnings, suggestions: [], diff: null, existingId: null, changes: {} };
  });

  // Same Module + Phase twice in the file: the first one wins, later ones
  // are errors. Unticked rows don't take part.
  const firstByKey = new Map<string, number>();
  for (const r of rows) {
    if (!r.include || r.errors.length) continue;
    const key = matchKeyFor(r.values.module, r.values.phase);
    const first = firstByKey.get(key);
    if (first != null) r.errors.push(`Same Module and Phase as row ${first} - a plan can't hold the same phase twice`);
    else firstByKey.set(key, r.rowNumber);
  }

  // A row with errors is skipped, so only its errors are shown - a warning
  // worked out from a fallback value (an unreadable status reads as To Do)
  // would only mislead.
  for (const r of rows) if (r.errors.length) r.warnings = [];

  // Name fix suggestions - shown for the PM to accept or reject, never applied here.
  const fileModules = rows.filter((r) => r.include).map((r) => r.values.module).filter(Boolean);
  const filePhases = rows.filter((r) => r.include).map((r) => r.values.phase).filter(Boolean);
  const corrections = typoCorrections([...fileModules, ...filePhases, ...saved.map((r) => r.module), ...saved.map((r) => r.phase)]);
  const canonicalModules = canonicalSpellings(fileModules, saved.map((r) => r.module));
  const canonicalPhases = canonicalSpellings(filePhases, saved.map((r) => r.phase));
  for (const r of rows) {
    for (const field of ['module', 'phase'] as const) {
      const value = r.values[field];
      if (!value) continue;
      const label = field === 'module' ? 'Module' : 'Phase';
      const canonical = (field === 'module' ? canonicalModules : canonicalPhases).get(looseKey(value));
      if (canonical && canonical !== value) {
        r.suggestions.push({ field, from: value, to: canonical, reason: 'near_duplicate', message: `${label} looks like a near-duplicate of "${canonical}"` });
        continue;
      }
      const fixed = correctTypos(value, corrections);
      if (fixed !== value) r.suggestions.push({ field, from: value, to: fixed, reason: 'typo', message: `${label} may have a typo - did you mean "${fixed}"?` });
    }
    if (r.newTeam && r.values.team) {
      const close = teams.find((t) => t.isActive && t.name.length >= 4 && editDistance(nameKey(t.name), nameKey(r.values.team!)) <= 2);
      if (close) r.suggestions.push({ field: 'team', from: r.values.team, to: close.name, reason: 'existing_team', message: `Did you mean the existing team "${close.name}"?` });
    }
  }

  // Re-upload diff against the saved plan.
  const seenSaved = new Set<number>();
  for (const r of rows) {
    if (r.errors.length) continue;
    const existing = savedByKey.get(matchKeyFor(r.values.module, r.values.phase));
    if (!existing) {
      r.diff = 'new';
      continue;
    }
    // Saved rows the file doesn't cover in a ticked, error-free row are "missing".
    if (r.include) seenSaved.add(existing.id);
    r.existingId = existing.id;
    const compare: [RowField, string | null, string | null][] = [
      ['module', existing.module, r.values.module],
      ['phase', existing.phase, r.values.phase],
      ['team', teamName(existing.teamId), r.values.team],
      ['status', existing.status, r.values.status],
      ['startDate', existing.startDate, r.values.startDate],
      ['endDate', existing.endDate, r.values.endDate],
    ];
    for (const [field, oldValue, newValue] of compare) {
      const same = field === 'team' ? nameKey(oldValue ?? '') === nameKey(newValue ?? '') : (oldValue ?? null) === (newValue ?? null);
      if (!same) r.changes[field] = { old: oldValue ?? null, new: newValue ?? null };
    }
    r.diff = Object.keys(r.changes).length ? 'changed' : 'unchanged';
  }
  const missing = saved.filter((s) => !seenSaved.has(s.id)).map((s) => ({ ...s, teamName: teamName(s.teamId) }));

  // The plan as it would be right after import (missing rows kept).
  const importing = rows.filter((r) => r.include && !r.errors.length && r.diff !== 'unchanged');
  const replaced = new Set(importing.map((r) => r.existingId).filter((id) => id != null));
  const after = [
    ...saved.filter((s) => !replaced.has(s.id)),
    ...importing.map((r) => ({ id: r.existingId ?? undefined, rowNumber: r.rowNumber, ...r.values })),
  ];
  const afterImport = summarizePlan(after as any[], today);

  // Overlap warnings on the file rows involved.
  for (const pair of afterImport.overlaps) {
    for (const [me, other] of [[pair.a, pair.b], [pair.b, pair.a]] as const) {
      const row = rows.find((r) => (me.rowNumber != null ? r.rowNumber === me.rowNumber : r.existingId === me.id && r.include));
      if (row) {
        row.warnings.push(`Overlaps "${other.phase}" (${displayDate(other.startDate)} – ${displayDate(other.endDate)}) in the same module`);
      }
    }
  }

  const counted = rows.filter((r) => r.include);
  const valid = counted.filter((r) => !r.errors.length);
  return {
    rows,
    missing,
    summary: {
      totalRows: rows.length,
      modules: new Set(rows.map((r) => nameKey(r.values.module)).filter(Boolean)).size,
      includedRows: counted.length,
      errorRows: counted.filter((r) => r.errors.length).length,
      // Warnings only count on rows that will import - an error row is skipped anyway.
      warningRows: valid.filter((r) => r.warnings.length).length,
      warnings: valid.reduce((n, r) => n + r.warnings.length, 0),
      suggestions: counted.reduce((n, r) => n + r.suggestions.length, 0),
      newRows: valid.filter((r) => r.diff === 'new').length,
      changedRows: valid.filter((r) => r.diff === 'changed').length,
      unchangedRows: valid.filter((r) => r.diff === 'unchanged').length,
      missingRows: missing.length,
      toImport: importing.length,
      newTeams: [...new Map(importing.filter((r) => r.newTeam).map((r) => [nameKey(r.values.team!), r.values.team!])).values()],
      afterImport,
    },
  };
}

// ------------------------------------------------------------- baselines

// Slip tracking (2026-10-16). The baseline is the dates a phase had when
// it first entered the plan (import or "Add"), or - after a PM "Reset
// baseline" - its dates at the reset. A phase with no date at its baseline
// takes the first date it is later given. Built only from the audit log
// (row created/updated entries + project baseline resets), so it needs no
// table of its own; the audit log keeps every older baseline as history.

export interface BaselineEvent {
  id: number; // audit_logs.id - events are replayed in this order
  action: 'created' | 'updated' | 'reset';
  rowId: number | null; // null for a reset (project-wide)
  at: string | Date;
  by: string | null;
  details: any;
}

export interface RowBaseline {
  rowId: number;
  baselineStart: string | null;
  baselineEnd: string | null;
  // 'import' | 'added' (via Save changes) | 'reset'
  source: string;
  setAt: string | Date | null;
  // End-date moves since the baseline, and the latest one.
  endMoves: number;
  lastMove: { at: string | Date; by: string | null; from: string | null; to: string | null } | null;
}

export function buildBaselines(rowIds: number[], events: BaselineEvent[]): Map<number, RowBaseline> {
  const wanted = new Set(rowIds);
  const out = new Map<number, RowBaseline>();
  for (const e of [...events].sort((a, b) => a.id - b.id)) {
    if (e.action === 'reset') {
      for (const s of (e.details?.snapshot || []) as { id: number; startDate: string | null; endDate: string | null }[]) {
        if (!wanted.has(s.id)) continue;
        out.set(s.id, { rowId: s.id, baselineStart: s.startDate ?? null, baselineEnd: s.endDate ?? null, source: 'reset', setAt: e.at, endMoves: 0, lastMove: null });
      }
      continue;
    }
    if (e.rowId == null || !wanted.has(e.rowId)) continue;
    if (e.action === 'created') {
      const v = e.details?.values || {};
      out.set(e.rowId, {
        rowId: e.rowId,
        baselineStart: v.startDate ?? null,
        baselineEnd: v.endDate ?? null,
        source: e.details?.source === 'import' ? 'import' : 'added',
        setAt: e.at,
        endMoves: 0,
        lastMove: null,
      });
      continue;
    }
    const b = out.get(e.rowId);
    const c = e.details?.changes || {};
    if (!b) continue;
    if (c.startDate && b.baselineStart == null) b.baselineStart = c.startDate.new ?? null;
    if (c.endDate) {
      if (b.baselineEnd == null) b.baselineEnd = c.endDate.new ?? null; // first date given - not a move
      else {
        b.endMoves += 1;
        b.lastMove = { at: e.at, by: e.by, from: c.endDate.old ?? null, to: c.endDate.new ?? null };
      }
    }
  }
  return out;
}

export function slipDays(baselineEnd: string | null, endDate: string | null): number | null {
  if (!baselineEnd || !endDate) return null;
  return Math.round((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${baselineEnd}T00:00:00Z`)) / 86400000);
}

// ---------------------------------------------------------------- export

// Export (Stage 3, 2026-10-16): the import columns first, so the file can
// be imported again unchanged, then read-only info columns that import
// ignores.
export const EXPORT_INFO_COLUMNS = ['Overdue', 'Overlaps with', 'Slip (days)'] as const;

export interface ExportRow {
  module: string;
  phase: string;
  team: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  overdue: boolean;
  overlapsWith: string[];
  slip: number | null;
}

// `rows` = the rows to export, in table order. Overlaps are checked
// against the whole plan (`allRows`), so a filtered export still shows an
// overlap with a phase that was filtered out.
export function buildExportRows(input: {
  rows: PlanRow[];
  allRows: PlanRow[];
  teamNameById: Map<number, string>;
  today: string;
  baselineEndById: Map<number, string | null>;
}): ExportRow[] {
  const overlapsById = new Map<number, string[]>();
  for (const pair of findOverlaps(input.allRows)) {
    for (const [self, other] of [
      [pair.a, pair.b],
      [pair.b, pair.a],
    ]) {
      if (self.id == null) continue;
      if (!overlapsById.has(self.id)) overlapsById.set(self.id, []);
      overlapsById.get(self.id)!.push(other.phase);
    }
  }
  return input.rows.map((r) => ({
    module: r.module,
    phase: r.phase,
    team: r.teamId != null ? input.teamNameById.get(r.teamId) ?? '' : '',
    status: r.status,
    startDate: r.startDate,
    endDate: r.endDate,
    overdue: isOverdue(r, input.today),
    overlapsWith: overlapsById.get(r.id) || [],
    slip: input.baselineEndById.has(r.id) ? slipDays(input.baselineEndById.get(r.id) ?? null, r.endDate) : null,
  }));
}

// "1-Jul-26" - the date style of the plan files (and the template).
// Plan dates are always 2000-2099 (isoFrom), so a 2-digit year reads back.
export function fileDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00Z`);
  const month = d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
  return `${d.getUTCDate()}-${month}-${String(d.getUTCFullYear()).slice(-2)}`;
}
