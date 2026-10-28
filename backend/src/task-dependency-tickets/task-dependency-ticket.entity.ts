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
  @Column()
  ownerUserId: number;

  @Column()
  ownerEmail: string;

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
  @Column({ default: 'open' })
  status: 'open' | 'resolved';

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
}
