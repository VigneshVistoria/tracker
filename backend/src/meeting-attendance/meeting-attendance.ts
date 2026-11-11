// Performance Tracking C6 - meeting attendance (2026-11-11, approved by the
// user). Read from Microsoft Teams through Graph: the tracked recurring
// meetings of the listed organisers, each held meeting's attendance report,
// matched to tracker users by email. Pure - no Nest/TypeORM imports.
//
// User's decisions (2026-11-11), every value an Admin setting, audited:
//  1. Only the tracked series count (default: the daily scrum).
//  2. Late = joined MORE than meetingLateMinutes (5) after the start.
//  3. Expected = only people on the invite.
//  4. Shown only - not scored unless meetingCountInScores (OFF) is on.
//  5. Attended = stayed at least meetingMinStayPercent (50%) of the meeting.
//  6. A PM can mark an absence or late as Excused with a reason; excused
//     meetings never count either way. Audited.
// Everything is behind meetingAttendanceEnabled (OFF) and only for the
// projects in meetingAttendanceProjectIds.
import { UserRole } from '../users/user.entity';

export const MEETING_ATTENDANCE_AUDIT = {
  SETTINGS_UPDATED: 'meeting_attendance_settings_updated',
  IMPORT_RUN: 'meeting_attendance_import_run',
  EXCUSED: 'meeting_attendance_excused',
  EXCUSE_REMOVED: 'meeting_attendance_excuse_removed',
} as const;

// Only an Admin edits the C6 settings; Admin and PM see the page.
export const MEETING_SETTINGS_EDIT_ROLES: UserRole[] = [UserRole.ADMIN];
export const MEETING_PAGE_ROLES: UserRole[] = [UserRole.ADMIN, UserRole.PROGRAM_MANAGER];
// Who may be allowed to mark Excused (the setting picks from these). An
// Admin can always excuse anyone, so is not a choice; a Program Manager
// only people who share a project with them (user's rule, 2026-11-11).
export const MEETING_EXCUSE_ROLE_CHOICES: UserRole[] = [UserRole.PROGRAM_MANAGER, UserRole.EXECUTIVE];

export interface TrackedSeries {
  organiserUserId: number;
  seriesId: string;
  subject: string;
}

export interface MeetingAttendanceSettings {
  meetingAttendanceEnabled: boolean;
  meetingAttendanceProjectIds: number[];
  meetingOrganiserUserIds: number[];
  meetingTrackedSeries: TrackedSeries[];
  meetingLateMinutes: number;
  meetingMinStayPercent: number;
  meetingMinSample: number;
  meetingImportDays: number;
  meetingCountInScores: boolean;
  meetingExcuseReasons: string[];
  meetingExcuseRoles: UserRole[];
}

export const MEETING_ATTENDANCE_DEFAULTS: MeetingAttendanceSettings = {
  meetingAttendanceEnabled: false,
  meetingAttendanceProjectIds: [],
  meetingOrganiserUserIds: [],
  meetingTrackedSeries: [],
  meetingLateMinutes: 5,
  meetingMinStayPercent: 50,
  meetingMinSample: 4,
  meetingImportDays: 7,
  meetingCountInScores: false,
  meetingExcuseReasons: ['Leave', 'Sick', 'Client call'],
  meetingExcuseRoles: [UserRole.PROGRAM_MANAGER],
};

export const MEETING_SETTING_KEYS = Object.keys(MEETING_ATTENDANCE_DEFAULTS) as (keyof MeetingAttendanceSettings)[];

export type MeetingNumericSetting = 'meetingLateMinutes' | 'meetingMinStayPercent' | 'meetingMinSample' | 'meetingImportDays';
export const MEETING_LIMITS: Record<MeetingNumericSetting, [number, number]> = {
  meetingLateMinutes: [0, 60],
  meetingMinStayPercent: [1, 100],
  meetingMinSample: [1, 50],
  meetingImportDays: [1, 30],
};

export const MAX_TRACKED_SERIES = 20;
export const MAX_EXCUSE_REASONS = 10;
export const EXCUSE_REASON_MAX = 80;

// The excuse reasons: 1-10 distinct, non-empty labels of up to 80 characters.
export function excuseReasonsProblem(reasons: unknown): string | null {
  if (!Array.isArray(reasons) || reasons.length === 0 || reasons.length > MAX_EXCUSE_REASONS) return `Give 1 to ${MAX_EXCUSE_REASONS} excuse reasons.`;
  const clean = reasons.map((r) => (typeof r === 'string' ? r.trim() : ''));
  if (clean.some((r) => !r || r.length > EXCUSE_REASON_MAX)) return `Each excuse reason must be 1 to ${EXCUSE_REASON_MAX} characters.`;
  if (new Set(clean.map((r) => r.toLowerCase())).size !== clean.length) return 'Excuse reasons must be different from each other.';
  return null;
}

// The tracked series: up to 20, each from a listed organiser, no repeats.
export function trackedSeriesProblem(series: unknown, organiserUserIds: number[]): string | null {
  if (!Array.isArray(series) || series.length > MAX_TRACKED_SERIES) return `Track at most ${MAX_TRACKED_SERIES} meeting series.`;
  for (const s of series as TrackedSeries[]) {
    if (!s || !Number.isInteger(s.organiserUserId) || typeof s.seriesId !== 'string' || !s.seriesId || s.seriesId.length > 512 || typeof s.subject !== 'string' || s.subject.length > 255) {
      return 'Each tracked series needs an organiser, a series id and a subject.';
    }
    if (!organiserUserIds.includes(s.organiserUserId)) return `"${s.subject}" is organised by someone who is not in the organiser list.`;
  }
  if (new Set((series as TrackedSeries[]).map((s) => s.seriesId)).size !== series.length) return 'A meeting series is listed twice.';
  return null;
}

// C6 can only be switched on with something to read.
export function switchOnProblem(s: MeetingAttendanceSettings): string | null {
  if (!s.meetingAttendanceEnabled) return null;
  if (s.meetingAttendanceProjectIds.length === 0) return 'Pick at least one project before switching C6 on.';
  if (s.meetingOrganiserUserIds.length === 0) return 'Pick at least one organiser before switching C6 on.';
  if (s.meetingTrackedSeries.length === 0) return 'Pick at least one meeting series before switching C6 on.';
  return null;
}

export type AttendanceOutcome = 'on_time' | 'late' | 'short' | 'absent';

// One invited person at one meeting. Absent = never joined; short = stayed
// less than minStayPercent of the scheduled length; late = joined more than
// lateMinutes after the start (and stayed long enough); otherwise on time.
// Only on_time counts as attended on time for C6.
export function classifyAttendance(input: {
  startAt: Date;
  endAt: Date;
  firstJoinAt: Date | null;
  attendedSeconds: number;
  lateMinutes: number;
  minStayPercent: number;
}): AttendanceOutcome {
  if (!input.firstJoinAt || input.attendedSeconds <= 0) return 'absent';
  const scheduledSeconds = Math.max(1, (input.endAt.getTime() - input.startAt.getTime()) / 1000);
  if (input.attendedSeconds * 100 < scheduledSeconds * input.minStayPercent) return 'short';
  if (input.firstJoinAt.getTime() - input.startAt.getTime() > input.lateMinutes * 60_000) return 'late';
  return 'on_time';
}

// ---- Stage 2: reading Teams (shapes from ./meeting-graph.client.ts) ----

export interface GraphSeries {
  seriesId: string;
  subject: string;
  pattern: any;
  rangeEnd: string | null;
  startTime: Date | null;
  endTime: Date | null;
  joinUrl: string | null;
}

export interface GraphInstance {
  eventId: string;
  subject: string;
  startAt: Date;
  endAt: Date;
  cancelled: boolean;
  joinUrl: string | null;
  invitees: string[]; // lower-case emails, rooms left out
}

export interface GraphReport {
  reportId: string;
  startAt: Date;
  endAt: Date;
}

export interface GraphAttendanceRecord {
  email: string | null;
  totalSeconds: number;
  intervals: Array<{ joinAt: Date | null; leaveAt: Date | null }>;
}

// How far before the scheduled start a Teams report may begin and still
// belong to that meeting (people join early).
export const REPORT_EARLY_MINUTES = 30;

// The reports of one held instance: Teams started the meeting between 30
// minutes before its scheduled start and its scheduled end. A meeting
// restarted twice has two reports - both belong to it.
export function reportsForInstance(instance: { startAt: Date; endAt: Date }, reports: GraphReport[]): GraphReport[] {
  const from = instance.startAt.getTime() - REPORT_EARLY_MINUTES * 60_000;
  const to = instance.endAt.getTime();
  return reports.filter((r) => r.startAt.getTime() >= from && r.startAt.getTime() < to);
}

export interface AttendanceRowInput {
  userId: number;
  firstJoinAt: Date | null;
  lastLeaveAt: Date | null;
  attendedSeconds: number;
  outcome: AttendanceOutcome;
}

// One row per invited tracker user (decision 3: only invitees are
// expected; guests and people not on the invite are ignored). Time from
// several reports or several join/leave intervals is added up.
export function attendanceRows(
  instance: { startAt: Date; endAt: Date; invitees: string[] },
  records: GraphAttendanceRecord[],
  userIdByEmail: Map<string, number>,
  rules: { lateMinutes: number; minStayPercent: number },
): AttendanceRowInput[] {
  const out: AttendanceRowInput[] = [];
  const seen = new Set<number>();
  for (const raw of instance.invitees) {
    const email = raw.toLowerCase();
    const userId = userIdByEmail.get(email);
    if (userId === undefined || seen.has(userId)) continue;
    seen.add(userId);
    const mine = records.filter((r) => (r.email ?? '').toLowerCase() === email);
    const joins = mine.flatMap((r) => r.intervals.map((i) => i.joinAt)).filter((d): d is Date => !!d);
    const leaves = mine.flatMap((r) => r.intervals.map((i) => i.leaveAt)).filter((d): d is Date => !!d);
    const firstJoinAt = joins.length ? new Date(Math.min(...joins.map((d) => d.getTime()))) : null;
    const lastLeaveAt = leaves.length ? new Date(Math.max(...leaves.map((d) => d.getTime()))) : null;
    const attendedSeconds = Math.max(0, Math.round(mine.reduce((s, r) => s + (Number.isFinite(r.totalSeconds) ? r.totalSeconds : 0), 0)));
    out.push({
      userId,
      firstJoinAt,
      lastLeaveAt,
      attendedSeconds,
      outcome: classifyAttendance({ startAt: instance.startAt, endAt: instance.endAt, firstJoinAt, attendedSeconds, lateMinutes: rules.lateMinutes, minStayPercent: rules.minStayPercent }),
    });
  }
  return out;
}

// ---- Stage 3: the C6 measure ----

// C6 = meetings attended on time / meetings expected, in percent, over the
// scorecard window. Excused meetings never count either way (decision 6).
// Late, short and absent all count as not on time.
export function c6Summary(rows: Array<{ outcome: AttendanceOutcome; excused: boolean }>) {
  const counted = rows.filter((r) => !r.excused);
  const n = (o: AttendanceOutcome) => counted.filter((r) => r.outcome === o).length;
  const onTime = n('on_time');
  return {
    value: counted.length ? Math.round((onTime / counted.length) * 10000) / 100 : null,
    numerator: onTime,
    denominator: counted.length,
    sample: counted.length,
    details: { onTime, late: n('late'), short: n('short'), absent: n('absent'), excused: rows.length - counted.length },
  };
}

export const C6_INFO = { metric: 'C6' as const, label: 'Meeting attendance', unit: 'percent' as const, higherIsBetter: true };
export type C6Breakdown = ReturnType<typeof c6Summary>['details'];

// Adds the C6 row to one scorecard (decision 4): shown only, unless
// meetingCountInScores is on - then it is banded like any percent metric
// and joins the Collaboration average (and so the overall). The card's
// other numbers are never changed while it is off.
//  phase 'baseline' = the person's C6 projects are all still in Baseline.
export function applyC6<
  Card extends {
    state: 'baseline' | 'scored' | 'not_enough_data';
    overall: number | null;
    competencies: Array<{ key: string; label: string; score: number | null }>;
    metrics: Array<{ metric: string; score: number | null }>;
  },
>(
  card: Card,
  c6: ReturnType<typeof c6Summary>,
  options: { phase: 'baseline' | 'scoring'; minSample: number; countInScores: boolean; percentBands: number[]; projects: number[] },
): Card {
  const baseline = options.phase === 'baseline' || card.state === 'baseline';
  let state: 'baseline' | 'not_enough_data' | 'not_scored' | 'scored';
  let score: number | null = null;
  if (baseline) state = 'baseline';
  else if (c6.value === null || c6.sample < options.minSample) state = 'not_enough_data';
  else if (!options.countInScores) state = 'not_scored';
  else {
    state = 'scored';
    const i = options.percentBands.findIndex((b) => c6.value! >= b);
    score = i === -1 ? 1 : 5 - i;
  }
  const row = {
    ...C6_INFO,
    state,
    value: baseline ? null : c6.value,
    sample: c6.sample,
    numerator: baseline ? null : c6.numerator,
    denominator: baseline ? null : c6.denominator,
    computedScore: score,
    score,
    override: null,
    projects: options.projects,
    breakdown: baseline ? null : c6.details,
  };
  const at = card.metrics.findIndex((m) => m.metric === 'C5');
  const metrics = [...card.metrics];
  metrics.splice(at === -1 ? metrics.length : at + 1, 0, row as any);
  if (score === null) return { ...card, metrics };
  // Counted: Collaboration = average of its scored metrics including C6.
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const cScores = metrics.filter((m) => /^C\d$/.test(m.metric) && m.score !== null).map((m) => m.score!);
  const competencies = card.competencies.map((c) => (c.key === 'C' ? { ...c, score: r1(cScores.reduce((s, x) => s + x, 0) / cScores.length) } : c));
  const scored = competencies.filter((c) => c.score !== null).map((c) => c.score!);
  return { ...card, metrics, competencies, overall: r1(scored.reduce((s, x) => s + x, 0) / scored.length), state: 'scored' };
}

// Who may open the C6 page: Admin and PM always; an Executive only when
// the setting lets Executives mark Excused.
export function canOpenMeetingPage(role: UserRole, settings: Pick<MeetingAttendanceSettings, 'meetingExcuseRoles'>): boolean {
  return MEETING_PAGE_ROLES.includes(role) || settings.meetingExcuseRoles.includes(role);
}

export const EXCUSE_NOTE_MAX = 500;
