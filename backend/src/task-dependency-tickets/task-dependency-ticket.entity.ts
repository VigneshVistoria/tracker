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

  @Column({ type: 'text' })
  description: string;

  // Restricted to UserRole.DEVELOPER, enforced in
  // TaskDependencyTicketsService.create().
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
}
