import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

// One row per defect per assignee - see ./defect-triage.ts. Created when a
// defect is filed in a project with triage on, and again whenever a defect
// still waiting for triage moves to another developer (the old row is
// closed as 'superseded'). Table from migrations/2026-10-defect-triage.sql.
@Entity('defect_triages')
export class DefectTriage {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  @Column()
  taskId: number;

  // Whose clock this is - kept as it was, never rewritten on reassignment.
  @Column()
  assigneeUserId: number;

  @Column()
  assigneeEmail: string;

  @Column({ type: 'timestamp', default: () => 'now()' })
  startedAt: Date;

  // The last day to triage (startedAt + the configured working days).
  @Column({ type: 'date' })
  dueDate: string;

  // null = still waiting for the developer.
  @Column({ type: 'varchar', length: 20, nullable: true })
  decision: 'accepted' | 'disputed' | 'superseded' | null;

  @Column({ type: 'timestamp', nullable: true })
  decidedAt: Date | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  disputeReason: string | null;

  @Column({ type: 'text', nullable: true })
  disputeComment: string | null;

  @Column({ type: 'int', nullable: true })
  duplicateOfTaskId: number | null;

  // The dispute reason was one that never counts as late triage (snapshot
  // of DisputeReason.notLateTriage when it was raised).
  @Column({ default: false })
  lateExempt: boolean;

  @Column({ type: 'varchar', length: 20, nullable: true })
  pmDecision: 'rejected' | 'closed' | 'reassigned' | 'converted' | null;

  @Column({ type: 'text', nullable: true })
  pmComment: string | null;

  @Column({ type: 'timestamp', nullable: true })
  pmDecidedAt: Date | null;

  @Column({ type: 'int', nullable: true })
  pmDecidedByUserId: number | null;

  @Column({ type: 'varchar', nullable: true })
  pmDecidedByEmail: string | null;

  @Column({ type: 'int', nullable: true })
  reassignedToUserId: number | null;

  @Column({ type: 'int', nullable: true })
  convertedTaskId: number | null;

  // The late-triage reminder went out (once).
  @Column({ type: 'timestamp', nullable: true })
  reminderSentAt: Date | null;
}
