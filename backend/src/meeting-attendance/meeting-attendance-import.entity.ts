import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

// C6 - one import run (nightly or "Import now"). skipped = another import
// for the tenant was still going, or C6 is off.
@Entity('meeting_attendance_imports')
export class MeetingAttendanceImport {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  @Column({ type: 'varchar', length: 10 })
  trigger: 'nightly' | 'manual';

  @Column({ type: 'int', nullable: true })
  userId: number | null;

  @Column({ type: 'varchar', length: 10 })
  status: 'running' | 'done' | 'failed' | 'skipped';

  @Column({ type: 'timestamp', default: () => 'now()' })
  startedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  finishedAt: Date | null;

  @Column({ type: 'int', default: 0 })
  meetingsFound: number;

  @Column({ type: 'int', default: 0 })
  reportsRead: number;

  @Column({ type: 'int', default: 0 })
  rowsWritten: number;

  @Column({ type: 'text', nullable: true })
  error: string | null;
}
