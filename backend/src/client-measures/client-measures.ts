// Performance Tracking L3-L5 - client measures (2026-10-30, fast-track:
// the open rules are settings or defaults listed for the Technical
// Director in /home/ec2-user/perf-tracking-defaults.md). Entered by hand
// by the Program Manager (the client's UAT process and a satisfaction
// form are not set up yet; a portal or Forms import can come later).
// Pure - no Nest/TypeORM imports.
//
//  * L3 priority inversions: a task can carry a client priority tier
//    (setting clientPriorityTiers, default Critical/High/Normal/Low - the
//    first is the most urgent), set by the PM on the task page. An
//    inversion = the person first submits (QA or Peer Review) a tier-k task
//    while one of their tasks with a more urgent tier was waiting on them
//    at that moment (assigned to them, in Development / Failed / PM
//    Feedback, no open blocker). Counted once per submission; scored on
//    the breach bands. Both tasks are judged by the tier they had AT THAT
//    MOMENT (the user's rule, 2026-10-30): every change is recorded in
//    task_priority_tier_events (tier, previous tier, who, when); a task
//    with no tier yet at that moment has none.
//  * L4 UAT first-pass acceptance: the PM records each UAT round of a task
//    (passed / failed, note). L4 = of the tasks whose first UAT result was
//    recorded in the window, % passed - charged to whoever answers for the
//    task (submitted its last passing QA round, else its assignee, as Q4).
//  * L5 client satisfaction: after a release the PM records the client's
//    answers to the questions (setting satisfactionQuestions, default 2),
//    each 1-5, on the Release Log entry - one response per release,
//    editable, audited. L5 = the average of the responses for releases
//    (release date in the window) containing a task the person answers
//    for.
//  * L4/L5 have their own window (clientWindowDays, default 90) and minimum
//    (clientMinSample, default 3), like P1-P4. L3 uses the shared window
//    and minimum.
//  * Only on tracked projects. Never deleted (a UAT round can't be undone;
//    a satisfaction response is edited, not removed).
import { UserRole } from '../users/user.entity';

export const CLIENT_MEASURES_ROLES: UserRole[] = [UserRole.PROGRAM_MANAGER];
export const DEFAULT_PRIORITY_TIERS = ['Critical', 'High', 'Normal', 'Low'];
export const DEFAULT_SATISFACTION_QUESTIONS = ['How satisfied are you with this release?', 'How well did the team understand what you needed?'];
export const UAT_RESULTS = ['passed', 'failed'] as const;
export type UatResult = (typeof UAT_RESULTS)[number];
// L3: the statuses where a task is waiting on its assignee (as C5).
export const WAITING_STATUSES = ['Development', 'Failed', 'PM Feedback'];

export const CLIENT_MEASURES_AUDIT = {
  TIER_SET: 'task_client_priority_tier_set',
  UAT_RECORDED: 'task_uat_result_recorded',
  SATISFACTION_SAVED: 'release_satisfaction_saved',
} as const;

// A list of 2-10 distinct names of 2-60 characters (tiers) or 1-5 of 5-200 (questions).
export function listProblem(what: string, list: unknown, [minItems, maxItems]: [number, number], [minLen, maxLen]: [number, number]): string | null {
  if (!Array.isArray(list) || list.length < minItems || list.length > maxItems) return `${what} needs ${minItems} to ${maxItems} items.`;
  const names = list.map((c) => (typeof c === 'string' ? c.trim() : ''));
  if (names.some((c) => c.length < minLen || c.length > maxLen)) return `Each of ${what.toLowerCase()} needs ${minLen} to ${maxLen} characters.`;
  if (new Set(names.map((c) => c.toLowerCase())).size !== names.length) return `${what} must be different.`;
  return null;
}
export const tiersProblem = (t: unknown) => listProblem('The priority tier list', t, [2, 10], [2, 40]);
export const questionsProblem = (q: unknown) => listProblem('The satisfaction questions', q, [1, 5], [5, 200]);

// Every question scored 1-5, in order: the problem, or null.
export function answersProblem(scores: unknown, questions: string[]): string | null {
  if (!Array.isArray(scores) || scores.length !== questions.length) return `Answer all ${questions.length} questions.`;
  if (scores.some((s) => !Number.isInteger(s) || s < 1 || s > 5)) return 'Each answer must be a whole number from 1 to 5.';
  return null;
}

export const averageOf = (scores: number[]) => Math.round((scores.reduce((s, v) => s + v, 0) / scores.length) * 100) / 100;
