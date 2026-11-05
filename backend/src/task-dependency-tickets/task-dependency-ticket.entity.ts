import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

// Stage 3 of the Task lifecycle: a dependency ticket the Assignee spins
// off a Task they're working on, routed to a Developer to clear. A new,
// lightweight table rather than extending the Issue-oriented Dependency
// entity (dependencies module) - this only ever needs Description/Owner/
// a reference back to the parent Task, not that entity's fuller
// impact-level/escalation/priority workflow.
@Entity('task_dependency_tickets')
export class TaskDependencyTicket {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  @Column()
  parentTaskId: number;

  // Short one-line name shown wherever the ticket is listed (Team Tasks'
  // Dependencies to clear, Dependency Clearance, Outbound/Inbound cards,
  // the task detail page) instead of the full description - same idea as
  // ProjectTask.title. Plain text, trimmed, capped at
  // TASK_DEPENDENCY_TICKET_TITLE_MAX_LENGTH. Required for every ticket
  // created from here on; existing rows were backfilled from their
  // description's first meaningful line (scripts/backfill-task-dependency-
  // ticket-titles.js).
  @Column()
  title: string;

  @Column({ type: 'text' })
  description: string;

  // Restricted to DEVELOPER_EQUIVALENT_ROLES (Developer/Designer/DevOps),
  // enforced in TaskDependencyTicketsService.create().
  // Nullable in the DB since 2026-11-05 for external owners (ownerExternal
  // below, Stage 4). Until Stage 4 ships, every ticket still has a user owner,
  // so the types stay non-null here.
  @Column({ nullable: true })
  ownerUserId: number;

  @Column({ nullable: true })
  ownerEmail: string;

  // Dependency tasks Stage 4 (column added 2026-11-05): a free-text owner
  // outside the app (no client-portal users). Exactly one of ownerUserId /
  // ownerExternal is set (CHK_task_dependency_tickets_owner). Such a ticket
  // never gets a dependency task.
  @Column({ type: 'varchar', length: 200, nullable: true })
  ownerExternal: string | null;

  @Column({ nullable: true })
  createdByUserId: number;

  @Column()
  createdByEmail: string;

  @CreateDateColumn()
  createdAt: Date;

  // Added for the KPI module - this entity previously had no resolution
  // concept at all, so a ticket had no way to ever be marked cleared.
  // 'open' | 'resolved'. Direction (Outbound/Inbound) stays implicit, as
  // before - it's still just whichever of ownerUserId/createdByUserId
  // matches the current user, never stored on the row itself.
  // 'cancelled' added with dependency tasks (2026-11-05): the ticket was
  // withdrawn or its dependency task went to Junk. Like 'resolved', it no
  // longer blocks the parent task (every gate checks for 'open').
  @Column({ default: 'open' })
  status: 'open' | 'resolved' | 'cancelled';

  @Column({ type: 'timestamp', nullable: true })
  resolvedAt: Date;

  // Performance Tracking S3 (2026-10-28): the date the creator needs it by
  // (required while the project's tracking is ON; older tickets stay
  // undated) and when it becomes overdue - 00:00 the next day in the
  // team's time zone, written with it. See task-flags/task-flags.ts.
  @Column({ type: 'date', nullable: true })
  needByDate: string | null;

  @Column({ type: 'timestamp', nullable: true })
  overdueAt: Date | null;

  // Dependency tasks (2026-11-05): when and why the ticket was cancelled.
  // resolvedAt is set too, so ticket-based metrics stop counting it.
  @Column({ type: 'timestamp', nullable: true })
  cancelledAt: Date | null;

  @Column({ type: 'int', nullable: true })
  cancelledByUserId: number | null;

  @Column({ type: 'text', nullable: true })
  cancelReason: string | null;
}
