import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Priority } from '../common/priority.enum';

export enum IssueStatus {
  BACKLOG = 'Backlog',
  IN_PROGRESS = 'In Progress',
  IN_REVIEW = 'In Review',
  // Program Manager approved the In Review submission - now with QA to be
  // tested before it can go live.
  QA_TESTING = 'QA Testing',
  // QA found a problem - distinct from "In Progress" so a QA-flagged
  // rework is trackable separately from a normal first-pass build. The
  // assignee moves it back to "In Progress" themselves (a plain
  // self-service transition, same as Backlog <-> In Progress) once they're
  // ready to start fixing it.
  QA_FAILED = 'QA Failed',
  // QA passed it - the workflow's terminal state. Replaces the old
  // "Completed" status, which was set directly by the Program Manager's
  // approval with no QA gate in between.
  READY_FOR_PRODUCTION = 'Ready for Production',
}

export enum IssueMode {
  AUTO = 'Auto',
  MANUAL = 'Manual',
}

// A human reviewer's disposition on a showstopper claim the heuristic
// flagged as questionable. PENDING is the only state set automatically;
// the other two are only ever set by a Program Manager/QA/Admin acting
// on ShowstopperReviewController's confirm/downgrade action.
export enum ShowstopperReviewStatus {
  PENDING = 'Pending',
  CONFIRMED = 'Confirmed',
  DOWNGRADED = 'Downgraded',
}

// Set by QA (or anyone editing the issue) to classify what kind of work
// this is - independent of the status workflow and the separate
// "Showstopper" flag below (kept both, since a ticket can be tagged
// Showstopper as a category label AND separately flagged as blocking).
export enum IssueCategory {
  NEW_FEATURE = 'New Feature',
  ENHANCEMENT = 'Enhancement',
  BUG = 'Bug',
  CRITICAL = 'Critical',
  SHOWSTOPPER = 'Showstopper',
  DEFECT = 'Defect',
}

@Entity('issues')
export class Issue {
  @PrimaryGeneratedColumn()
  id: number;

  // Multi-tenant conversion Phase A - unused until Phase C wires up query
  // filtering. Nullable only until the migration's backfill runs, which
  // also adds the NOT NULL + FK.
  @Column({ nullable: true })
  tenantId: number;

  @Column()
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  // Optional photo captured/attached at ticket creation (mobile app "Take
  // Photo"/"Choose Existing" buttons), stored as raw base64 (no data-URI
  // prefix). select:false keeps it out of every list query (findAll,
  // findByAssignee, etc.) so a photo on one ticket doesn't bloat every
  // issue-list response - it's explicitly re-selected in findOne() below,
  // since only the single-ticket detail view needs to render it.
  @Column({ type: 'text', nullable: true, select: false })
  photoBase64: string;

  @Column({
    type: 'enum',
    enum: IssueStatus,
    default: IssueStatus.BACKLOG,
  })
  status: IssueStatus;

  // Set when the assignee submits the completed work for review (status
  // becomes "In Review"). Cleared if it's sent back for more work.
  @Column({ type: 'timestamp', nullable: true })
  submittedForReviewAt: Date;

  // Who approved/rejected this issue's In Review submission (the Program
  // Manager step), and when. Both null until that review decision has
  // actually been made.
  @Column({ nullable: true })
  reviewedByUserId: number;

  @Column({ nullable: true })
  reviewedByEmail: string;

  @Column({ type: 'timestamp', nullable: true })
  reviewedAt: Date;

  // Who approved/rejected this issue's QA Testing pass (the QA step),
  // separate from the Program Manager's reviewedBy* fields above. Both
  // null until QA has actually made a call on it.
  @Column({ nullable: true })
  qaReviewedByUserId: number;

  @Column({ nullable: true })
  qaReviewedByEmail: string;

  @Column({ type: 'timestamp', nullable: true })
  qaReviewedAt: Date;

  // Set whenever the Program Manager or QA sends an issue back for more
  // work - gives the assignee context on what needs fixing. Cleared on the
  // next successful submission.
  @Column({ type: 'text', nullable: true })
  lastRejectionReason: string;

  // id of the user who created the issue - null for issues auto-created
  // by an integration (e.g. Microsoft Teams) rather than a logged-in person.
  @Column({ nullable: true })
  createdByUserId: number;

  @Column({ nullable: true })
  createdByEmail: string;

  // The user responsible for resolving this issue (nullable = unassigned).
  @Column({ nullable: true })
  assigneeUserId: number;

  @Column({ nullable: true })
  assigneeEmail: string;

  // Which project this issue belongs to (nullable = no project set).
  @Column({ nullable: true })
  projectId: number;

  @Column({ nullable: true })
  projectName: string;

  // Which sprint (within that project) this issue has been planned into.
  // Nullable = not yet assigned to any sprint (independent of the issue's
  // status - an issue can be in the "Backlog" status and still belong to
  // a sprint, or vice versa).
  @Column({ nullable: true })
  sprintId: number;

  @Column({ nullable: true })
  sprintName: string;

  // Which module (within the issue's project) this issue is grouped
  // under, for the project drill-down (project -> module -> issue).
  // Nullable = not yet assigned to a module - the drill-down groups these
  // under an "Unassigned" bucket rather than requiring every issue to
  // have one.
  @Column({ nullable: true })
  moduleId: number;

  @Column({ nullable: true })
  moduleName: string;

  // Which phase (within the issue's module) this issue belongs to -
  // narrower than moduleId, since a Phase always belongs to exactly one
  // Module. Nullable = not yet assigned. Cleared automatically if
  // moduleId changes to a different module (see IssuesService.update()) -
  // a phase can't outlive its module on the same issue.
  @Column({ nullable: true })
  phaseId: number;

  @Column({ nullable: true })
  phaseName: string;

  // A simple numeric estimate used for sprint capacity planning. No fixed
  // scale enforced (story points, hours, whatever the team prefers).
  @Column({ type: 'int', nullable: true })
  storyPoints: number;

  // How the issue was raised - most will be "Manual" (someone filed it);
  // "Auto" is reserved for issues a system/integration files automatically.
  @Column({ type: 'enum', enum: IssueMode, default: IssueMode.MANUAL })
  mode: IssueMode;

  // Marks a critical, blocking issue for quick triage/filtering.
  @Column({ type: 'boolean', default: false })
  showstopper: boolean;

  // Set when ShowstopperValidatorService's heuristic flags a
  // showstopper claim as questionable (weak description, mismatched
  // category/priority, or a reporter pattern) - null for every issue
  // that was never flagged, cleared back to null once a Program Manager
  // or QA reviewer confirms or downgrades it (see
  // IssuesService.decideShowstopperReview()).
  @Column({ type: 'enum', enum: ShowstopperReviewStatus, nullable: true })
  showstopperReviewStatus: ShowstopperReviewStatus;

  // JSON-stringified array of the specific reasons the heuristic flagged
  // this one - same "free-form text, shape varies by caller" reasoning
  // AuditLog.details uses, since the reason set can grow independently of
  // the schema.
  @Column({ type: 'text', nullable: true })
  showstopperFlagReasons: string;

  @Column({ nullable: true })
  showstopperReviewedByUserId: number;

  @Column({ nullable: true })
  showstopperReviewedByEmail: string;

  @Column({ type: 'timestamp', nullable: true })
  showstopperReviewedAt: Date;

  // How many times this issue has been sent back for rework (Program
  // Manager reject() or QA qaReject()) - a cumulative, all-time count,
  // incremented on every occurrence rather than overwritten like
  // lastRejectionReason is. Drives the Performance Dashboard's Reopened
  // KPI/penalty.
  @Column({ type: 'int', default: 0 })
  reopenedCount: number;

  // Performance Dashboard's "late dependency" penalty (Section: poor
  // upfront planning). Only meaningful on a dependency issue
  // (parentIssueId set) - true if the parent's status had already left
  // Backlog at the exact moment this dependency was created. Set once in
  // IssuesService.createDependency() and never recalculated afterward,
  // even if the parent's status changes later - it's a record of what
  // was true at creation time, not a live-derived flag.
  @Column({ type: 'boolean', nullable: true })
  wasCreatedMidDevelopment: boolean;

  // Snapshot of the parent issue's assigneeUserId at that same moment -
  // who the late-dependency penalty is attributed to. Only set when
  // wasCreatedMidDevelopment is true; frozen at creation time for the
  // same reason that flag is, since the parent's assignee can change
  // later and the penalty should stay attributed to whoever actually
  // owned the planning gap.
  @Column({ nullable: true })
  lateDependencyAttributedToUserId: number;

  // QA classification of the type of work - optional, set at creation or
  // any time after. Free text (the name of a row in the admin-managed
  // issue_categories catalog, backend/src/issue-categories), not a DB enum
  // or real FK - matched by name, not id. IssueCategory below is kept only
  // as string constants for the small set of names other services key off
  // of (Critical/Showstopper for risk scoring and showstopper validation).
  @Column({ type: 'varchar', nullable: true })
  category: string;

  // ReleaseBot: drives SLA targets (Section 21) and auto-set to High for
  // Executive/Program-Manager-created tickets (Section 34, Phase 1).
  // Nullable so existing issues don't need a forced default - application
  // logic decides what new tickets get, not the schema.
  @Column({ type: 'enum', enum: Priority, nullable: true })
  priority: Priority;

  // ReleaseBot Section 34: tags how the ticket originated. Only value in
  // use today is "Leadership Request" (auto-set for Executive/Program
  // Manager creators - see IssuesService.create()). Left as a plain
  // string rather than a Postgres enum, same reasoning as AuditLog.action -
  // this is expected to grow (Teams, other integrations) without each new
  // value needing a schema migration.
  @Column({ nullable: true })
  source: string;

  // If set, this issue is a "dependency ticket" spun off from a parent
  // issue - a normal issue in every other respect, just linked back to
  // where it came from. Null for ordinary top-level issues.
  @Column({ nullable: true })
  parentIssueId: number;

  // Set automatically the moment status becomes "Ready for Production" (via
  // QA approval), cleared if the issue is reopened/sent back later. Column
  // name kept as closedOn for continuity with existing data (from when this
  // was set on the old "Completed" status instead).
  @Column({ type: 'timestamp', nullable: true })
  closedOn: Date;

  // Dedupe guard for SlaDueSoonSchedulerService: set the first time the
  // "due within an hour" email fires for this issue, so a recurring cron
  // tick doesn't resend it every time it polls. Cleared back to null if a
  // showstopper is un-flagged then re-flagged (see IssuesService.update()),
  // so the ticket becomes eligible for a fresh due-soon check.
  @Column({ type: 'timestamp', nullable: true })
  slaDueSoonNotifiedAt: Date;

  // Bulk import/export fields (Admin/Program-Manager-only spreadsheet
  // tool) - only ever written by IssuesBulkService today, not exposed on
  // the single-ticket create/edit UI. estimatedHours is a manual estimate
  // distinct from storyPoints (unitless) above. dueDate/targetDate are
  // manually-entered business deadlines, distinct from SlaService's
  // computed-on-the-fly `sla.dueAt` (never persisted) - kept as separate
  // concepts, not merged, so an SLA policy change can't silently move a
  // deadline a PM entered by hand.
  @Column({ type: 'numeric', precision: 6, scale: 2, nullable: true })
  estimatedHours: number;

  @Column({ type: 'date', nullable: true })
  dueDate: string;

  @Column({ type: 'date', nullable: true })
  targetDate: string;

  // Free-text description of a blocking dependency, entered directly on
  // this issue - distinct from the structured `Dependency` entity/table,
  // which models formal cross-team blocking links between two issues.
  @Column({ type: 'text', nullable: true })
  dependencyText: string;

  @Column({ nullable: true })
  dependencyOwnerUserId: number;

  @Column({ nullable: true })
  dependencyOwnerEmail: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
