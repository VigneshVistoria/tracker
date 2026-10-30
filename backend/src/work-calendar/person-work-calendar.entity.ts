import { Entity, Column, PrimaryColumn } from 'typeorm';
import { Country } from './work-calendar';

// B4 (migrations/2026-11-performance-tracking-calendar-requests.sql) - a
// person's own calendar; no row = the tenant default. See ./work-calendar.ts.
@Entity('person_work_calendars')
export class PersonWorkCalendar {
  @PrimaryColumn()
  tenantId: number;

  @PrimaryColumn()
  userId: number;

  @Column({ type: 'varchar', length: 60 })
  timeZone: string;

  @Column({ type: 'varchar', length: 5 })
  workStart: string;

  @Column({ type: 'varchar', length: 5 })
  workEnd: string;

  @Column({ type: 'jsonb' })
  weekendDays: number[];

  @Column({ type: 'varchar', length: 20, nullable: true })
  country: Country | null;

  @Column({ type: 'int', nullable: true })
  updatedByUserId: number | null;

  @Column({ type: 'timestamp', default: () => 'now()' })
  updatedAt: Date;
}
