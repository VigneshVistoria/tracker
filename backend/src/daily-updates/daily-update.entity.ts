import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
} from 'typeorm';

export enum UpdateStatus {
  ON_TRACK = 'on_track',
  AT_RISK = 'at_risk',
  BLOCKED = 'blocked',
}

@Entity('daily_updates')
export class DailyUpdate {
  @PrimaryGeneratedColumn()
  id: number;

  // Multi-tenant conversion Phase A - unused until Phase C wires up query
  // filtering. Nullable only until the migration's backfill runs, which
  // also adds the NOT NULL + FK.
  @Column({ nullable: true })
  tenantId: number;

  @Column()
  userId: number;

  @Column()
  userEmail: string;

  // The calendar day this update is *for* (not when it was submitted).
  @Column({ type: 'date' })
  date: string;

  // What the person actually typed, kept verbatim for reference.
  @Column({ type: 'text', nullable: true })
  completedText: string;

  @Column({ type: 'text', nullable: true })
  pendingText: string;

  @Column({ type: 'text', nullable: true })
  blockersText: string;

  // Parsed line-by-line from the raw text above (one entry per line typed).
  @Column({ type: 'simple-json', nullable: true })
  completedTasks: string[];

  @Column({ type: 'simple-json', nullable: true })
  pendingTasks: string[];

  @Column({ type: 'simple-json', nullable: true })
  risks: string[];

  // Pending items from the person's most recent prior update that still
  // haven't shown up as completed today.
  @Column({ type: 'simple-json', nullable: true })
  carryForwardTasks: string[];

  @Column({ type: 'int', default: 0 })
  productivityScore: number;

  @Column({ type: 'enum', enum: UpdateStatus, default: UpdateStatus.ON_TRACK })
  status: UpdateStatus;

  @Column({ type: 'text', nullable: true })
  managerSummary: string;

  @CreateDateColumn()
  createdAt: Date;
}
