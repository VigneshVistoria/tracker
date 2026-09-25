import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { TaskPriority } from './task-priority.enum';

// A task-level work item, required through the Project -> Module -> Phase
// chain - a more granular, more constrained concept than Issue (which
// links to all three only optionally). Deliberately a separate entity
// rather than extending Issue, following the same plain-FK-plus-
// denormalized-name convention Issue already uses. No isActive - Tasks
// are never deactivated.
//
// Lifecycle (see TasksService): created with no Assignee -> sits in the
// Task Backlog (assigneeUserId null) -> Program Manager assigns it,
// singly or in bulk -> it moves into the Assignee's My Tasks list, where
// they set estimatedHours/dueDate themselves (status is never set by
// hand - see the status column below). Dependency tickets spun off a
// task live in the separate TaskDependencyTicket entity
// (task-dependency-tickets module), not on this entity.
@Entity('project_tasks')
export class ProjectTask {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  @Column()
  projectId: number;

  @Column()
  projectName: string;

  @Column()
  moduleId: number;

  @Column()
  moduleName: string;

  @Column()
  phaseId: number;

  @Column()
  phaseName: string;

  // Short human-readable name, shown everywhere a task is listed (My
  // Tasks, Team Tasks, Task Backlog, QA Review, Escalations, Peer Review,
  // notifications) instead of relying on `description`'s text - the same
  // idea as Issue.title. Plain text, not rich text (unlike description) -
  // always rendered via plain interpolation, never dangerouslySetInnerHTML,
  // so no HTML sanitization is needed here, just a trim + length cap
  // (CreateTaskDto/CreateDefectTaskDto/UpdateTaskDto). Required for every
  // task created from here on; existing rows were backfilled from their
  // description's first line/heading (see scripts/backfill-task-titles.js).
  @Column()
  title: string;

  @Column({ type: 'text' })
  description: string;

  // Null = the task is unassigned and sits in the Task Backlog. Set only
  // by TasksService.assignTask()/bulkAssignTasks() (Admin/Program Manager
  // only).
  @Column({ nullable: true })
  assigneeUserId: number;

  @Column({ nullable: true })
  assigneeEmail: string;

  // "E.Hrs" - one-time entry, now made by the Assignee once the task is
  // assigned to them: once non-null, only Admin/Program Manager can
  // change it further (enforced in TasksService.update(), not here).
  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  estimatedHours: number;

  // One-time entry by the Assignee, same lock pattern as estimatedHours -
  // once non-null, only Program Manager can change it further, and with
  // no lock on PM's own edits (enforced in TasksService.update(), not
  // here).
  @Column({ type: 'date', nullable: true })
  dueDate: string;

  // Separate from dueDate above (the Assignee's own field) - auto-set to
  // TasksService.QA_REVIEW_DUE_DATE_BUSINESS_DAYS business days from
  // whenever the task is submitted for QA or Peer Review
  // (TaskQaReviewsService.submit()/PeerReviewsService.submit(), both via
  // TasksService.computeQaReviewDueDate()), and reset fresh on every
  // resubmission - never tied back to the original first submission.
  // QA/Program Manager/Admin can also adjust it by hand afterward via the
  // dedicated PATCH /tasks/:id/qa-review-due-date endpoint (see
  // TasksService.setQaReviewDueDate()), same "narrow dedicated
  // setter, not the general update() path" shape as peerReviewEnabled.
  @Column({ type: 'date', nullable: true })
  qaReviewDueDate: string;

  // Required input on the QA-submit action (TaskQaReviewsService.submit())
  // - the KPI module's Hours Exceed % needs a real logged figure to
  // compare against estimatedHours, and QA-submit is the one
  // Assignee-initiated action where they know total time spent.
  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  actualHours: number;

  // Set once, in TaskQaReviewsService.approve() (status -> 'Pass') - the
  // KPI module's Target Miss % needs to know exactly when a task closed,
  // separate from updatedAt (which changes on every edit, not just
  // completion).
  @Column({ type: 'timestamp', nullable: true })
  completedAt: Date;

  // One of TASK_STATUSES (task-status-config/task-status-percent.entity).
  // Fully auto-computed by task events, never manually set - see
  // TasksService.create() (default 'Development') and
  // TaskQaReviewsService.submit()/approve()/reject().
  @Column()
  status: string;

  // Only ever set while status is 'Hold' or 'Closed' - the status to
  // resume to. Set by TasksService.holdTask() (so releaseTask() can resume
  // it exactly where it left off, e.g. back in the QA queue if it was in
  // Feedback) and closeTask() (so reopenTask() can do the same; closing a
  // Held task keeps its pre-Hold status). Cleared by releaseTask()/
  // reopenTask() once restored onto `status`.
  @Column({ nullable: true })
  priorStatus: string | null;

  // Program Manager only (see TasksService.update()'s PRIORITY_MUTATE_ROLES
  // check) - never auto-assigned, including on task creation, so existing
  // and new tasks alike sit at null ("Not Set") until a PM reviews and sets
  // one. Used to sort My Tasks/Team Tasks/Task Backlog (Immediate -> High
  // -> Medium -> Not Set), never to gate the QA/Peer Review workflow or KPI
  // scoring.
  @Column({ type: 'enum', enum: TaskPriority, nullable: true })
  priority: TaskPriority | null;

  // Opt-in alternative to QA review, set by Program Manager (or Admin, via
  // the dedicated PATCH /tasks/:id/peer-review-flag endpoint - see
  // TasksService.setPeerReviewFlag()) at creation or any time after.
  // Consulted only at the moment the Assignee submits for review
  // (TaskQaReviewsService.submit() vs PeerReviewsService.submit()) - so
  // flipping this on a task mid-review never affects the round already in
  // flight, only the next submission.
  @Column({ default: false })
  peerReviewEnabled: boolean;

  // Set only by TasksService.createDefect() (QA-only, see TasksController)
  // - a defect skips the Task Backlog entirely (created with an assignee
  // already set) and its QA review round routes back to createdByUserId
  // specifically (the QA who raised it) instead of the shared QA queue -
  // see TaskQaReviewsService.approve()/reject() and TasksService.
  // findDefectQueue()/findQaQueue(). No separate "raised by" column - for
  // a defect the creator IS the raiser, so createdByUserId already means
  // that.
  @Column({ default: false })
  isDefect: boolean;

  // Set only when this defect was spun off a QA rejection via the
  // "Create linked defect" option (TaskQaReviewsService.reject(), which
  // calls TasksService.createDefect() with this set) - null for every
  // standalone defect filed from the Create Defect page. While a linked
  // defect's status isn't in TasksService.LINKED_DEFECT_RESOLVED_STATUSES,
  // TasksService.assertNoOpenLinkedDefects() blocks the parent task
  // (parentTaskId) from being resubmitted for QA - same "child ticket
  // under a parent" shape as TaskDependencyTicket.parentTaskId, kept on
  // this entity instead (rather than a separate table) since a defect is
  // already just a ProjectTask row.
  @Column({ nullable: true })
  parentTaskId: number | null;

  @Column({ nullable: true })
  createdByUserId: number;

  @Column()
  createdByEmail: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
