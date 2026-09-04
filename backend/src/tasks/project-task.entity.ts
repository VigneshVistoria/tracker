import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

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

  // One of TASK_STATUSES (task-status-config/task-status-percent.entity).
  // Fully auto-computed by task events, never manually set - see
  // TasksService.create() (default 'Development') and
  // TaskQaReviewsService.submit()/approve()/reject().
  @Column()
  status: string;

  @Column({ nullable: true })
  createdByUserId: number;

  @Column()
  createdByEmail: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
