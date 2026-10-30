import { Entity, Column, PrimaryGeneratedColumn, Unique } from 'typeorm';

// C3 (migrations/2026-11-performance-tracking-weekly-status.sql) - one
// person's weekly status report. submittedAt is the FIRST submission and
// never changes; deadlineAt is the deadline in force then. See
// ./weekly-status.ts.
@Entity('weekly_status_reports')
@Unique('UQ_weekly_status_reports_week', ['tenantId', 'userId', 'weekStart'])
export class WeeklyStatusReport {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  @Column()
  userId: number;

  // The Monday, YYYY-MM-DD.
  @Column({ type: 'date' })
  weekStart: string;

  @Column({ type: 'text' })
  done: string;

  @Column({ type: 'text' })
  plan: string;

  @Column({ type: 'text', nullable: true })
  blockers: string | null;

  @Column({ type: 'timestamp' })
  submittedAt: Date;

  @Column({ type: 'timestamp' })
  deadlineAt: Date;

  @Column({ type: 'timestamp' })
  updatedAt: Date;
}
