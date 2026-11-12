// Design handover - "Hand over to development" (2026-11-12, Option A,
// decisions by the user):
//
//  * A design task = a task whose assignee is a Designer (no task type).
//  * Started by that designer, or a Program Manager for them - not Admin.
//    The designer picks a Developer or DevOps person, writes notes and
//    attaches at least one link (prototype, design file, spec...).
//  * Not while a review is waiting (Feedback, Peer Review, PM review...),
//    and never on finished, Junk or Hold tasks, defects or dependency tasks.
//    One pending handover (of either kind) per task.
//  * The developer accepts by linking one of their own open tasks in the
//    same project, or by creating a new one (assigned to them, same
//    module/phase). The design task then moves to Pass (no review) and the
//    linked task shows the handover. The developer keeps read access to
//    the design task.
//  * Reject (with a reason) leaves the design task with the designer;
//    cancel = the designer, whoever started it, or a PM.
//  * Every project, whatever the Performance Tracking switch. Design
//    handovers are not C4 handovers, and design tasks closed this way are
//    left out of KPI, Non-Compliance and Performance Tracking until the
//    user decides (after 2026-11-30).
import { UserRole } from '../users/user.entity';
import { AWAITING_REVIEW_STATUSES } from '../tasks/pm-review';

export interface DesignHandoverArtifact {
  type: string;
  url: string;
}

export const DESIGN_HANDOVER_ON_BEHALF_ROLES: UserRole[] = [UserRole.PROGRAM_MANAGER];
export const DESIGN_HANDOVER_RECEIVER_ROLES: UserRole[] = [UserRole.DEVELOPER, UserRole.DEVOPS];
export const DESIGN_HANDOVER_NOTES_MAX = 4000;
export const DESIGN_HANDOVER_MAX_ARTIFACTS = 10;

// Statuses where a handover would race a reviewer or makes no sense.
export const DESIGN_HANDOVER_BLOCKED_STATUSES = [
  ...AWAITING_REVIEW_STATUSES,
  'Pending PM Review',
  'Returned to QA',
  'Escalated',
  'Disputed',
  'Hold',
  'Closed',
  'Junk',
  'Pass',
  'Released - No Showstoppers',
  'Released - With Showstoppers',
];

export const DESIGN_HANDOVER_AUDIT = {
  STARTED: 'design_handover_started',
  ACCEPTED: 'design_handover_accepted',
  REJECTED: 'design_handover_rejected',
  CANCELLED: 'design_handover_cancelled',
  TASK_CLOSED: 'design_task_closed_by_handover',
} as const;

const URL_RE = /^https?:\/\/\S+$/i;

// The links handed over: the problem, or null.
export function artifactsProblem(artifacts: unknown, allowedTypes: string[]): string | null {
  if (!Array.isArray(artifacts) || artifacts.length === 0) return 'Attach at least one link (prototype, design file or spec).';
  if (artifacts.length > DESIGN_HANDOVER_MAX_ARTIFACTS) return `At most ${DESIGN_HANDOVER_MAX_ARTIFACTS} links.`;
  for (const a of artifacts as any[]) {
    if (!a || typeof a.type !== 'string' || !allowedTypes.includes(a.type)) return `Each link needs a type from: ${allowedTypes.join(', ')}.`;
    if (typeof a.url !== 'string' || a.url.length > 2000 || !URL_RE.test(a.url.trim())) return 'Each link must be a full http(s) URL.';
  }
  return null;
}
