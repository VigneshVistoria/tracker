import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';
import { AttendanceOutcome } from './meeting-attendance';

// C6 - one invited person at one meeting (see ./meeting-attendance.ts for
// the outcome rules). Excused rows never count either way.
@Entity('meeting_attendance')
export class MeetingAttendance {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  @Column()
  occurrenceId: number;

  @Column()
  userId: number;

  @Column({ type: 'timestamp', nullable: true })
  firstJoinAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  lastLeaveAt: Date | null;

  @Column({ type: 'int', default: 0 })
  attendedSeconds: number;

  @Column({ type: 'varchar', length: 10 })
  outcome: AttendanceOutcome;

  @Column({ default: false })
  excused: boolean;

  @Column({ type: 'varchar', length: 80, nullable: true })
  excuseReason: string | null;

  @Column({ type: 'text', nullable: true })
  excuseNote: string | null;

  @Column({ type: 'int', nullable: true })
  excusedByUserId: number | null;

  @Column({ type: 'timestamp', nullable: true })
  excusedAt: Date | null;
}
