import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export type ExternalWaitStatus = 'open' | 'resolved';

// Daily Scrum Stage 3 (migrations/2026-10-daily-scrum-external-waits.sql):
// the "Waiting on the city office" box. A hand-kept list - one row per
// thing the team waits on from outside the app's users - added, edited and
// resolved by Admin/Program Manager from the Team tab. Never deleted.
@Entity('scrum_external_waits')
export class ScrumExternalWait {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  // Who we're waiting on - 'City office' unless the PM types another.
  @Column({ type: 'varchar', length: 120, default: 'City office' })
  party: string;

  // The ticket held up by it, if any.
  @Column({ type: 'int', nullable: true })
  taskId: number | null;

  // The team member chasing it, if any.
  @Column({ type: 'int', nullable: true })
  followUpUserId: number | null;

  // YYYY-MM-DD
  @Column({ type: 'date' })
  requestedOn: string;

  @Column({ type: 'date', nullable: true })
  expectedBy: string | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ type: 'varchar', length: 20, default: 'open' })
  status: ExternalWaitStatus;

  @Column({ type: 'timestamp', nullable: true })
  resolvedAt: Date | null;

  @Column({ type: 'int', nullable: true })
  resolvedByUserId: number | null;

  @Column()
  createdByUserId: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ type: 'int', nullable: true })
  updatedByUserId: number | null;
}
