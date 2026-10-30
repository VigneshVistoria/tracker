// Performance Tracking P3/P4 - security findings (2026-10-30, fast-track:
// the open rules are settings or defaults listed for the Technical
// Director in /home/ec2-user/perf-tracking-defaults.md). Entered by hand
// (the scanner and its severity mapping are not decided yet; scanner
// import can come later). Pure - no Nest/TypeORM imports.
//
//  * A finding belongs to a tracked project (the task's, when one is
//    given), has a severity (Critical/High/Medium/Low) and an owner - the
//    Developer, Designer or DevOps account charged for it.
//  * SLA: N working days per severity (setting securitySlaDays, default
//    2/5/10/20, team calendar). Two due days are stored:
//      - dueOn: N working days after the day it was FOUND - the finding's
//        own SLA, shown on the finding, not charged to anyone;
//      - ownerDueOn: N working days after the day it was ASSIGNED to the
//        current owner (assignedOn) - what P4 charges. Reassignment
//        restarts it (the user's rule, 2026-10-30).
//    Both are recomputed if the severity changes (dueOn also if the found
//    date changes).
//  * Flow: open -> fix submitted (the owner, or a PM/Admin for them) ->
//    verified (passed) or back to open (failed) by a security role
//    (setting securityRoles, default Admin, Program Manager, QA), never by
//    the owner. A PM or Admin can accept the risk instead (reason
//    required). Never deleted; everything audited; the owner is told
//    in-app of a new finding and of a failed verification.
//  * Who sees: Admin, Program Manager, Executive and the security roles -
//    everything; Developer, Designer, DevOps - the findings they own;
//    clients - nothing.
//  * P3 (metrics/tracking-metrics.ts) = of the owner's findings whose first
//    verification was decided in the window, % passed first time.
//  * P4 = the current owner's breaches among findings whose ownerDueOn is in
//    the window. On time = the fix that passed (or one still waiting for
//    verification) was submitted by the end of that day - verification
//    wait is not charged, as for D1. A finding whose risk was accepted is
//    never a breach (left out).
import { UserRole } from '../users/user.entity';

export const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;
export type Severity = (typeof SEVERITIES)[number];
export const FINDING_STATUSES = ['open', 'fix_submitted', 'verified', 'risk_accepted'] as const;
export type FindingStatus = (typeof FINDING_STATUSES)[number];

export type SlaDays = Record<Severity, number>;
export const DEFAULT_SLA_DAYS: SlaDays = { critical: 2, high: 5, medium: 10, low: 20 };
export const SECURITY_ROLE_CHOICES: UserRole[] = [UserRole.ADMIN, UserRole.PROGRAM_MANAGER, UserRole.QA];
export const SECURITY_SEE_ALL_ROLES: UserRole[] = [UserRole.ADMIN, UserRole.PROGRAM_MANAGER, UserRole.EXECUTIVE];
// Accept the risk, or submit a fix for the owner.
export const SECURITY_MANAGE_ROLES: UserRole[] = [UserRole.ADMIN, UserRole.PROGRAM_MANAGER];
export const RISK_REASON_MIN = 10;

export const SECURITY_AUDIT = {
  CREATED: 'security_finding_created',
  UPDATED: 'security_finding_updated',
  FIX_SUBMITTED: 'security_finding_fix_submitted',
  VERIFIED: 'security_finding_verified',
  RISK_ACCEPTED: 'security_finding_risk_accepted',
} as const;

export function slaDaysProblem(v: unknown): string | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'SLA days are missing.';
  const o = v as Record<string, unknown>;
  const extra = Object.keys(o).filter((k) => !(SEVERITIES as readonly string[]).includes(k));
  if (extra.length) return `Unknown severity: ${extra.join(', ')}.`;
  for (const s of SEVERITIES) {
    const n = o[s];
    if (!Number.isInteger(n) || (n as number) < 1 || (n as number) > 60) return `SLA days for ${s} must be a whole number from 1 to 60.`;
  }
  return null;
}

// What a finding needs for P3/P4 - also used by the metrics engine.
export interface FindingForMetrics {
  id: number;
  ownerUserId: number;
  // P4 uses the owner's due day (from assignment).
  ownerDueOn: string;
  status: string;
  // Submission time of the fix that passed (verified findings only).
  fixedAt: Date | null;
  // Latest fix submission (the one waiting, when status = fix_submitted).
  fixSubmittedAt: Date | null;
  firstVerifyResult: string | null;
  firstVerifiedAt: Date | null;
  riskAcceptedAt: Date | null;
}

// Missed `dueOn` (the found-date SLA or the owner's)? `day` turns a time
// into the team-zone day; the due day must have ended (dueOn <=
// asOfDay) for an unfixed finding. Accepted risk: never (null).
export function slaBreached(
  f: Pick<FindingForMetrics, 'status' | 'fixedAt' | 'fixSubmittedAt' | 'riskAcceptedAt'>,
  dueOn: string,
  asOfDay: string,
  day: (t: Date) => string,
): boolean | null {
  if (f.riskAcceptedAt || f.status === 'risk_accepted') return null;
  const fixed = f.status === 'verified' ? f.fixedAt : f.status === 'fix_submitted' ? f.fixSubmittedAt : null;
  if (fixed) return day(fixed) > dueOn;
  return dueOn <= asOfDay;
}

// In-app notification to the owner (user-notifications listener).
export interface SecurityFindingEvent {
  tenantId: number;
  kind: 'created' | 'failed';
  findingId: number;
  title: string;
  severity: string;
  dueOn: string;
  ownerUserId: number;
  actorUserId: number;
  actorEmail: string;
}
