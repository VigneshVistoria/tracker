import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

@Entity('weekly_reports')
export class WeeklyReport {
  @PrimaryGeneratedColumn()
  id: number;

  // Multi-tenant conversion Phase A - unused until Phase C wires up query
  // filtering. Nullable only until the migration's backfill runs, which
  // also adds the NOT NULL + FK.
  @Column({ nullable: true })
  tenantId: number;

  // The Monday and Friday this report covers (business week).
  @Column({ type: 'date' })
  weekStartDate: string;

  @Column({ type: 'date' })
  weekEndDate: string;

  // The full computed report payload - see WeeklyReportsService for shape.
  @Column({ type: 'simple-json' })
  data: any;

  // Null if generated automatically by the Monday-morning scheduled job
  // rather than someone clicking "Generate Report".
  @Column({ nullable: true })
  generatedByUserId: number;

  @CreateDateColumn()
  generatedAt: Date;
}
