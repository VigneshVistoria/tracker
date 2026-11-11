import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

// C6 (migrations/2026-11-performance-tracking-meeting-attendance.sql) - one
// held meeting of a tracked series, as read from Teams. Never deleted.
// no_report = held but Teams has no attendance report (yet);
// cancelled = the meeting was cancelled.
@Entity('meeting_occurrences')
export class MeetingOccurrence {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  @Column()
  organiserUserId: number;

  @Column({ type: 'varchar', length: 512 })
  seriesId: string;

  @Column({ type: 'varchar', length: 512 })
  eventId: string;

  @Column({ type: 'varchar', length: 255 })
  subject: string;

  @Column({ type: 'timestamp' })
  startAt: Date;

  @Column({ type: 'timestamp' })
  endAt: Date;

  @Column({ type: 'varchar', length: 512, nullable: true })
  reportId: string | null;

  @Column({ type: 'varchar', length: 20 })
  status: 'imported' | 'no_report' | 'cancelled';

  @Column({ type: 'int', default: 0 })
  invitedCount: number;

  @Column({ type: 'timestamp', default: () => 'now()' })
  importedAt: Date;
}
