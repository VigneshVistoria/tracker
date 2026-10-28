import { ProjectTaskWithComputed, TeamDependencyRow, TeamTasksResult } from '../tasks.service';

// Team Tasks export (PDF / Excel, 2026-10-28). Pure - no Nest/TypeORM
// imports - so the rows, dates and filter text can be tested without a
// database. The rows come from TasksService.findTeam({ all: true }), the
// same query the page uses, so an export can never hold more than the
// page shows.

export const EXPORT_TIME_ZONE = 'Africa/Addis_Ababa';
export const MAX_EXPORT_ROWS = 5000;

// Same tabs as frontend/lib/taskTableShared.js STATUS_TAB_GROUPS, kept in
// sync by hand - only used to name the tab in the export's filter text.
const STATUS_TABS: Array<{ label: string; statuses: string[] }> = [
  { label: 'Development / Failed', statuses: ['Development', 'Failed', 'Released - With Showstoppers', 'PM Feedback', 'Not Ready for Testing'] },
  { label: 'PM Review', statuses: ['Pending PM Review'] },
  { label: 'Disputed', statuses: ['Disputed'] },
  { label: 'QA', statuses: ['Feedback', 'Re-Feedback'] },
  { label: 'Returned to QA', statuses: ['Returned to QA'] },
  { label: 'Intervention', statuses: ['Escalated'] },
  { label: 'Hold', statuses: ['Hold'] },
  { label: 'Closed', statuses: ['Closed'] },
];

// Same display rename as the frontend's statusLabel().
const STATUS_LABELS: Record<string, string> = { Escalated: 'Intervention' };
export const statusLabel = (status: string | null | undefined) => (status ? STATUS_LABELS[status] || status : '');

export interface TeamExportQuery {
  status?: string;
  assigneeUserId?: number;
  phaseId?: number;
  dependency?: string;
  // Set by the Defects stat card (no dropdown for it on the page).
  isDefect?: string;
  dueFrom?: string;
  dueTo?: string;
  showHoldClosed: boolean;
  includeDependencies: boolean;
  sortKey?: string;
  sortDir?: 'asc' | 'desc';
}

export type ExportSection = 'Tasks' | 'Defects' | 'Dependencies';

export interface TeamExportRow {
  section: ExportSection;
  // Dependencies only - the "Filed by X" group the row sits in.
  filedBy: string;
  id: number;
  title: string;
  type: 'Task' | 'Defect' | 'Dependency';
  status: string;
  assignee: string;
  phase: string;
  dueDate: string;
  // Raw YYYY-MM-DD behind dueDate (for a dependency: its parent task's) -
  // Excel stores it as a real date so the column sorts/filters properly.
  dueDateIso: string | null;
  estimatedHours: number | null;
  percentComplete: number | null;
  ageDays: number;
  dependsOn: string;
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// "October 28, 2026". A date-only value (a due date) is a calendar day
// already, so it is written as-is - never shifted by a time zone. A
// timestamp is shown as its calendar day in `timeZone`.
export function formatLongDate(value: string | Date | null | undefined, timeZone = EXPORT_TIME_ZONE): string {
  if (!value) return '';
  if (typeof value === 'string' && DATE_ONLY_RE.test(value)) {
    const [y, m, d] = value.split('-').map(Number);
    return `${MONTHS[m - 1]} ${String(d).padStart(2, '0')}, ${y}`;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'long', day: '2-digit' }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  return `${get('month')} ${get('day')}, ${get('year')}`;
}

// "October 28, 2026, 10:30 AM (Addis Ababa time)" - when the export was made.
export function formatLongDateTime(instant: Date, timeZone = EXPORT_TIME_ZONE): string {
  const time = new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', minute: '2-digit' }).format(instant);
  const city = timeZone.split('/').pop()!.replace(/_/g, ' ');
  return `${formatLongDate(instant, timeZone)}, ${time} (${city} time)`;
}

const isDependencyRow = (row: ProjectTaskWithComputed | TeamDependencyRow): row is TeamDependencyRow =>
  (row as TeamDependencyRow).kind === 'dependency';

function compareValues(av: unknown, bv: unknown): number {
  if (av == null && bv == null) return 0;
  if (av == null) return 1;
  if (bv == null) return -1;
  if (typeof av === 'number' && typeof bv === 'number') return av - bv;
  return String(av).localeCompare(String(bv));
}

// Columns the page can sort by (TaskSections.js buildTaskColumns) -
// anything else is ignored and the default order kept.
const SORT_ACCESSORS: Record<string, (r: TeamExportRow) => unknown> = {
  id: (r) => r.id,
  assigneeEmail: (r) => r.assignee || null,
  title: (r) => r.title,
  status: (r) => r.status,
  dueDate: (r) => r.dueDate || null,
  estimatedHours: (r) => r.estimatedHours,
  percentComplete: (r) => r.percentComplete,
  ageingDays: (r) => r.ageDays,
};

// The page's column sort (useSectionSort): rows reorder only inside their
// own run - a section, or a "Filed by" group - so the grouping holds.
// Due dates sort on the raw YYYY-MM-DD, not the formatted text.
function sortWithinGroups(rows: Array<{ row: TeamExportRow }>, sortKey?: string, sortDir?: 'asc' | 'desc') {
  const accessor = sortKey ? SORT_ACCESSORS[sortKey] : undefined;
  if (!accessor) return rows;
  const value = (r: { row: TeamExportRow }) => (sortKey === 'dueDate' ? r.row.dueDateIso : accessor(r.row));
  const runs: Array<{ g: string; rows: typeof rows }> = [];
  for (const r of rows) {
    const g = r.row.section === 'Dependencies' ? `dep:${r.row.filedBy}` : r.row.section;
    if (runs.length > 0 && runs[runs.length - 1].g === g) runs[runs.length - 1].rows.push(r);
    else runs.push({ g, rows: [r] });
  }
  return runs.flatMap(({ rows: run }) => {
    const sorted = [...run].sort((a, b) => compareValues(value(a), value(b)));
    return sortDir === 'desc' ? sorted.reverse() : sorted;
  });
}

// One flat, already-ordered list: Tasks, Defects, then Dependencies
// grouped by who filed them - findTeam()'s order, then the page's column
// sort (if any) inside each group.
export function buildExportRows(result: TeamTasksResult, query: Pick<TeamExportQuery, 'sortKey' | 'sortDir'>): TeamExportRow[] {
  const nameByEmail = new Map(result.assignees.map((a) => [a.email, a.fullName || a.email]));
  const nameById = new Map(result.assignees.map((a) => [a.id, a.fullName || a.email]));
  const rows = result.tasks.map((t) => {
    if (isDependencyRow(t)) {
      return {
        row: {
          section: 'Dependencies' as const,
          filedBy: t.createdByName || t.createdByEmail,
          id: t.id,
          title: t.title,
          type: 'Dependency' as const,
          status: t.status,
          assignee: nameById.get(t.assigneeUserId) || nameByEmail.get(t.assigneeEmail) || t.assigneeEmail || '',
          phase: '',
          // A ticket has no due date of its own - this is its parent task's.
          dueDate: t.dueDate ? `${formatLongDate(t.dueDate)} (task due)` : '',
          dueDateIso: t.dueDate,
          estimatedHours: null,
          percentComplete: null,
          ageDays: t.ageingDays,
          dependsOn: `#${t.parentTaskId}${t.parentTaskTitle ? ` ${t.parentTaskTitle}` : ''}`,
        },
      };
    }
    return {
      row: {
        section: (t.isDefect ? 'Defects' : 'Tasks') as ExportSection,
        filedBy: '',
        id: t.id,
        title: t.title,
        type: (t.isDefect ? 'Defect' : 'Task') as 'Task' | 'Defect',
        status: statusLabel(t.status),
        assignee: (t.assigneeUserId != null && nameById.get(t.assigneeUserId)) || t.assigneeEmail || '',
        phase: t.phaseName || '',
        dueDate: formatLongDate(t.dueDate),
        dueDateIso: t.dueDate || null,
        estimatedHours: t.estimatedHours == null ? null : Number(t.estimatedHours),
        percentComplete: t.percentComplete ?? null,
        ageDays: t.ageingDays,
        dependsOn: '',
      },
    };
  });
  return sortWithinGroups(rows, query.sortKey, query.sortDir).map((r) => r.row);
}

function tabLabel(status?: string): string {
  if (!status || status === 'All') return 'All';
  const list = status.split(',').map((s) => s.trim()).filter(Boolean);
  const tab = STATUS_TABS.find((t) => t.statuses.length === list.length && t.statuses.every((s) => list.includes(s)));
  return tab ? tab.label : list.map(statusLabel).join(', ');
}

// "Label: value" lines for the PDF header and the Excel "Filters" sheet,
// and (as an object) the audit entry.
export function describeFilters(query: TeamExportQuery, result: Pick<TeamTasksResult, 'assignees' | 'phases'>): Array<[string, string]> {
  const assignee = query.assigneeUserId ? result.assignees.find((a) => a.id === query.assigneeUserId) : null;
  const phase = query.phaseId ? result.phases.find((p) => p.id === query.phaseId) : null;
  const lines: Array<[string, string]> = [
    ['Tab', tabLabel(query.status)],
    ['Assignee', query.assigneeUserId ? (assignee ? assignee.fullName || assignee.email : `#${query.assigneeUserId}`) : 'All'],
    ['Project phase', query.phaseId ? (phase ? phase.name : `#${query.phaseId}`) : 'All'],
    ['Dependency', query.dependency === 'Yes' || query.dependency === 'No' ? query.dependency : 'All'],
    ...(query.isDefect === 'Yes' || query.isDefect === 'No' ? [['Defect', query.isDefect] as [string, string]] : []),
    ['Due from', query.dueFrom ? formatLongDate(query.dueFrom) : 'Any'],
    ['Due to', query.dueTo ? formatLongDate(query.dueTo) : 'Any'],
    ['Hold/Closed', query.showHoldClosed ? 'Shown' : 'Hidden'],
  ];
  if (query.includeDependencies) {
    lines.push(['Dependencies', 'Open dependency tickets included, grouped by who filed them']);
  } else if (tabLabel(query.status) === 'Development / Failed') {
    // Same rule and note as the page: tickets carry no phase/due date/
    // defect flag, so they're left out while one of those filters is on.
    lines.push(['Dependencies', 'Hidden while Project Phase, Dependency, Defect, or Due date filters are active']);
  }
  return lines;
}
