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

  @Column()
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string;

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

  // QA classification of the type of work - optional, set at creation or
  // any time after.
  @Column({ type: 'enum', enum: IssueCategory, nullable: true })
  category: IssueCategory;

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

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
