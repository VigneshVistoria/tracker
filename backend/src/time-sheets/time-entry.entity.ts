import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('time_entries')
export class TimeEntry {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  // Who logged this entry - self-only at creation (see TimeSheetsService),
  // editable afterward only by the owner or an Admin.
  @Column()
  userId: number;

  @Column()
  userEmail: string;

  // Logged against a ticket, a project, or both - at least one is always
  // required (enforced in TimeSheetsService.create(), not here). When
  // issueId is set, projectId/projectName are derived from that issue
  // rather than trusted from the caller, so the two can never disagree.
  @Column({ nullable: true })
  issueId: number;

  @Column({ nullable: true })
  issueTitle: string;

  @Column({ nullable: true })
  projectId: number;

  @Column({ nullable: true })
  projectName: string;

  // The calendar day the work was done (not when it was logged) - same
  // convention as DailyUpdate.date.
  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'decimal', precision: 5, scale: 2 })
  hours: number;

  @Column({ type: 'text', nullable: true })
  notes: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
