import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

// Public holidays skipped when counting working days for the performance
// metrics (2026-10-27). Entered by hand from Admin -> Performance Metrics
// Settings - Ethiopian holidays move from year to year, so there is no
// built-in calendar. One date per tenant.
@Entity('performance_holidays')
export class PerformanceHoliday {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'int', nullable: true })
  createdByUserId: number | null;

  @CreateDateColumn()
  createdAt: Date;
}
