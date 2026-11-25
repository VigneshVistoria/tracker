// Requirements traceability (2026-11-25, plan approved by the user). Stage 1:
// SRS -> Epic -> Story -> Criteria -> linked tickets, the Tree view and
// Pass/Fail. Behind the "requirements_tree" switch
// (team_settings."requirementsTree", OFF): with it OFF every endpoint except
// /requirements/me and the settings returns 404.
// Pure - no Nest/TypeORM imports.
//
// Roles (decided by the user):
//   View      Admin, PM, Executive: every project. QA (and BA from Stage 2):
//             only projects they are on (user.projects). Developers: none.
//   Pass/Fail QA, PM, Admin. Fail needs a reason of at least 10 characters.
//             Stage 1 allows results on Draft stories; they are flagged
//             "recorded before approval".
//   Switch    Admin, PM.
//
// Progress: story % = criteria passed / total; epic % = average of its
// stories; SRS % = average of all its stories. A story with no criteria is
// 0% and never Done.
import { UserRole } from '../users/user.entity';

export type SrsStatus = 'draft' | 'in_review' | 'signed_off' | 'client_signed_off';
export type RequirementPriority = 'high' | 'medium' | 'low';
export type StoryStatus = 'draft' | 'approved' | 'in_progress' | 'done';
export type CriterionResult = 'not_run' | 'pass' | 'fail';
export type TicketKind = 'dev' | 'qa';

export const REQUIREMENTS_VIEW_ALL_ROLES: UserRole[] = [UserRole.ADMIN, UserRole.PROGRAM_MANAGER, UserRole.EXECUTIVE];
export const REQUIREMENTS_VIEW_OWN_ROLES: UserRole[] = [UserRole.QA, UserRole.BA];
// Stage 2 (2026-11-25, decided by the user):
//   write the SRS, create/edit epics, stories, criteria, client items: BA, PM, Admin
//     (BA edits Draft stories only; Approved ones are PM/Admin)
//   approve stories, link/map tickets, close client items: PM, Admin
//   record client sign-off: PM only
export const REQUIREMENTS_WRITE_ROLES: UserRole[] = [UserRole.BA, UserRole.PROGRAM_MANAGER, UserRole.ADMIN];
export const REQUIREMENTS_APPROVE_ROLES: UserRole[] = [UserRole.PROGRAM_MANAGER, UserRole.ADMIN];
export const REQUIREMENTS_CLIENT_SIGNOFF_ROLES: UserRole[] = [UserRole.PROGRAM_MANAGER];
export const REQUIREMENTS_RESULT_ROLES: UserRole[] = [UserRole.QA, UserRole.PROGRAM_MANAGER, UserRole.ADMIN];
export const REQUIREMENTS_SETTINGS_ROLES: UserRole[] = [UserRole.ADMIN, UserRole.PROGRAM_MANAGER];

export const FAIL_REASON_MIN = 10;
export const FAIL_REASON_MAX = 2000;
export const AT_RISK_REASON_MIN = 10;
export const RESOLUTION_MIN = 10;
export const TEXT_MAX = 5000;
export const TITLE_MAX = 255;

export const REQUIREMENTS_AUDIT = {
  SETTINGS_UPDATED: 'requirements_settings_updated',
  CRITERION_RESULT: 'requirements_criterion_result',
  EPIC_CREATED: 'requirements_epic_created',
  EPIC_UPDATED: 'requirements_epic_updated',
  EPIC_DELETED: 'requirements_epic_deleted',
  STORY_CREATED: 'requirements_story_created',
  STORY_UPDATED: 'requirements_story_updated',
  STORY_DELETED: 'requirements_story_deleted',
  STORY_APPROVED: 'requirements_story_approved',
  STORY_APPROVED_AT_RISK: 'requirements_story_approved_at_risk',
  CRITERION_CREATED: 'requirements_criterion_created',
  CRITERION_UPDATED: 'requirements_criterion_updated',
  CRITERION_DELETED: 'requirements_criterion_deleted',
  CRITERIA_REORDERED: 'requirements_criteria_reordered',
  CLIENT_SIGNED_OFF: 'requirements_client_signed_off',
  CLIENT_ITEM_CREATED: 'requirements_client_item_created',
  CLIENT_ITEM_UPDATED: 'requirements_client_item_updated',
  CLIENT_ITEM_CLOSED: 'requirements_client_item_closed',
  TICKET_LINKED: 'requirements_ticket_linked',
  TICKET_UNLINKED: 'requirements_ticket_unlinked',
  TICKET_MOVED: 'requirements_ticket_moved',
} as const;

export function canViewRequirements(role: UserRole): boolean {
  return REQUIREMENTS_VIEW_ALL_ROLES.includes(role) || REQUIREMENTS_VIEW_OWN_ROLES.includes(role);
}

export function seesAllProjects(role: UserRole): boolean {
  return REQUIREMENTS_VIEW_ALL_ROLES.includes(role);
}

export function canRecordResults(role: UserRole): boolean {
  return REQUIREMENTS_RESULT_ROLES.includes(role);
}

export function canWrite(role: UserRole): boolean {
  return REQUIREMENTS_WRITE_ROLES.includes(role);
}

export function canApprove(role: UserRole): boolean {
  return REQUIREMENTS_APPROVE_ROLES.includes(role);
}

// Linking / mapping tickets and closing client items: same as approving.
export const canLinkTickets = canApprove;
export const canCloseClientItems = canApprove;

export function canRecordClientSignOff(role: UserRole): boolean {
  return REQUIREMENTS_CLIENT_SIGNOFF_ROLES.includes(role);
}

// BA edits Draft stories (and their criteria) only; PM/Admin edit any.
export function canEditStory(role: UserRole, status: StoryStatus): boolean {
  if (!canWrite(role)) return false;
  return status === 'draft' || canApprove(role);
}

// From Stage 2, Pass/Fail and ticket links only on approved work.
export const WORKING_STORY_STATUSES: StoryStatus[] = ['approved', 'in_progress', 'done'];
export function isWorkingStory(status: StoryStatus): boolean {
  return WORKING_STORY_STATUSES.includes(status);
}

export function isClientSigned(status: SrsStatus): boolean {
  return status === 'client_signed_off';
}

// Client sign-off can be recorded from In review or (internally) Signed off.
export function canTakeClientSignOff(status: SrsStatus): boolean {
  return status === 'in_review' || status === 'signed_off';
}

// The "At risk" label: approved at risk AND the SRS still not client-signed.
export function showsAtRisk(story: { atRisk: boolean }, srsStatus: SrsStatus): boolean {
  return story.atRisk && !isClientSigned(srsStatus);
}

export function minTextProblem(text: unknown, min: number, what: string): string | null {
  const t = typeof text === 'string' ? text.trim() : '';
  if (t.length < min) return `Please give ${what} (at least ${min} characters).`;
  if (t.length > TEXT_MAX) return `${what[0].toUpperCase()}${what.slice(1)} can be at most ${TEXT_MAX} characters.`;
  return null;
}

// Next code for a prefix, never reusing one (deleted rows count too):
// nextCode('US', ['US-01', 'US-23']) = 'US-24'; nextCode('E', ['E1', 'E6']) = 'E7'.
export function nextCode(prefix: 'US' | 'E', existing: string[]): string {
  const re = prefix === 'US' ? /^US-(\d+)$/ : /^E(\d+)$/;
  const max = existing.reduce((m, c) => {
    const hit = re.exec(c);
    return hit ? Math.max(m, Number(hit[1])) : m;
  }, 0);
  return prefix === 'US' ? `US-${String(max + 1).padStart(2, '0')}` : `E${max + 1}`;
}

// "TRK-123", "trk 123", "#123" or "123" -> 123; anything else -> null.
export function parseTrk(input: unknown): number | null {
  const m = /^\s*(?:trk[\s-]*|#)?(\d{1,9})\s*$/i.exec(String(input ?? ''));
  return m ? Number(m[1]) : null;
}

// A ticket's "Requirement ID" field may hold several IDs ("LN-10, LN-11").
export function requirementTokens(value: string | null | undefined): string[] {
  return [...new Set(String(value ?? '').toUpperCase().split(/[\s,;\/]+/).map((t) => t.trim()).filter(Boolean))];
}

// Suggested stories for a ticket: its Requirement ID equals a story code
// (US-03) or a requirement ID traced by the story. Never linked by itself.
export function suggestStories<S extends { code: string; requirements: string[] }>(requirementId: string | null, stories: S[]): Array<{ story: S; via: string }> {
  const tokens = requirementTokens(requirementId);
  if (!tokens.length) return [];
  const out: Array<{ story: S; via: string }> = [];
  for (const story of stories) {
    const code = story.code.toUpperCase();
    if (tokens.includes(code)) out.push({ story, via: story.code });
    else {
      const req = story.requirements.find((r) => tokens.includes(r.toUpperCase()));
      if (req) out.push({ story, via: req });
    }
  }
  return out;
}

export function failReasonProblem(note: unknown): string | null {
  const text = typeof note === 'string' ? note.trim() : '';
  if (text.length < FAIL_REASON_MIN) return `Please give a reason (at least ${FAIL_REASON_MIN} characters).`;
  if (text.length > FAIL_REASON_MAX) return `The reason can be at most ${FAIL_REASON_MAX} characters.`;
  return null;
}

// ---- progress ----

export function storyPercent(results: CriterionResult[]): number {
  if (!results.length) return 0;
  return Math.round((100 * results.filter((r) => r === 'pass').length) / results.length);
}

export function isStoryDone(results: CriterionResult[]): boolean {
  return results.length > 0 && results.every((r) => r === 'pass');
}

// Average of the stories' (already rounded) percentages, as in the sample.
export function averagePercent(storyPercents: number[]): number {
  if (!storyPercents.length) return 0;
  return Math.round(storyPercents.reduce((a, p) => a + p, 0) / storyPercents.length);
}

// Status after a result or link changes. Draft stays Draft (only approval
// moves it on). From Approved: Done when every criterion passes, otherwise
// In progress once anything has happened (a result or a linked ticket),
// otherwise Approved. Done drops back to In progress on a Fail.
export function nextStoryStatus(current: StoryStatus, results: CriterionResult[], hasTickets: boolean): StoryStatus {
  if (current === 'draft') return 'draft';
  if (isStoryDone(results)) return 'done';
  if (hasTickets || results.some((r) => r !== 'not_run')) return 'in_progress';
  return 'approved';
}

// ---- tree labels ----

export type StoryState = 'blocked' | 'dependency' | 'failed' | 'done' | 'progress' | 'no_tickets';

export interface StoryFacts {
  results: CriterionResult[];
  blocked: boolean;
  dependency: boolean;
  ticketCount: number;
}

// First match wins: Blocked, Waiting on dependency, failed, Done, then
// "N of M passed" (or "No tickets yet" when nothing is linked).
export function storyState(s: StoryFacts): StoryState {
  if (s.blocked) return 'blocked';
  if (s.dependency) return 'dependency';
  if (s.results.includes('fail')) return 'failed';
  if (isStoryDone(s.results)) return 'done';
  if (!s.ticketCount && !s.results.some((r) => r !== 'not_run')) return 'no_tickets';
  return 'progress';
}

export interface SummaryStrip {
  percent: number;
  criteriaPassed: number;
  criteriaTotal: number;
  storiesDone: number;
  storiesTotal: number;
  storiesFailed: number;
  storiesBlocked: number;
  storiesWaiting: number;
}

// Summary strip: overall % is the SRS % (average of stories); the criteria
// counts are shown beside it.
export function summaryStrip(stories: StoryFacts[]): SummaryStrip {
  const all = stories.flatMap((s) => s.results);
  return {
    percent: averagePercent(stories.map((s) => storyPercent(s.results))),
    criteriaPassed: all.filter((r) => r === 'pass').length,
    criteriaTotal: all.length,
    storiesDone: stories.filter((s) => isStoryDone(s.results)).length,
    storiesTotal: stories.length,
    storiesFailed: stories.filter((s) => s.results.includes('fail')).length,
    storiesBlocked: stories.filter((s) => s.blocked).length,
    storiesWaiting: stories.filter((s) => s.dependency).length,
  };
}

// ---- switch ----

export function resolveRequirementsTree(stored: unknown): boolean {
  return stored === true;
}
