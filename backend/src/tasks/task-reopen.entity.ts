import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

// Performance Tracking S4 (2026-10-28, migrations/2026-10-performance-
// tracking-qa-intake.sql) - one row per PM/Admin "Reopen after Pass". See
// ./qa-intake.ts.
@Entity('task_reopens')
export class TaskReopen {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  @Column()
  taskId: number;

  @Column()
  projectId: number;

  @Column({ type: 'varchar', length: 40 })
  fromStatus: string;

  @Column({ type: 'text' })
  reason: string;

  @Column()
  reopenedByUserId: number;

  @Column({ type: 'timestamp', default: () => 'now()' })
  reopenedAt: Date;

  // The QA/Peer round that passed it, when it passed, and the developer
  // whose submission passed - charged in Q3 even if reassigned since.
  @Column({ type: 'int', nullable: true })
  passedRoundId: number | null;

  @Column({ type: 'timestamp', nullable: true })
  passedAt: Date | null;

  @Column({ type: 'int', nullable: true })
  chargedUserId: number | null;

  @Column({ type: 'int', nullable: true })
  assigneeUserId: number | null;

  @Column({ type: 'date', nullable: true })
  previousDueDate: string | null;

  @Column({ type: 'date' })
  proposedDueDate: string;
}
