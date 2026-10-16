import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

// Project Timeline Stage C (migrations/2026-10-project-timeline-ticket-
// links.sql): which tickets deliver a timeline phase - either every
// ticket in an app Module (+ optional Phase) of the same project, or one
// ticket. Tickets are only read.
@Entity('project_timeline_ticket_links')
export class ProjectTimelineTicketLink {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  @Column()
  projectId: number;

  @Column()
  rowId: number;

  @Column({ type: 'int', nullable: true })
  moduleId: number | null;

  @Column({ type: 'int', nullable: true })
  phaseId: number | null;

  @Column({ type: 'int', nullable: true })
  taskId: number | null;

  @Column({ type: 'int', nullable: true })
  createdByUserId: number | null;

  @CreateDateColumn()
  createdAt: Date;
}
