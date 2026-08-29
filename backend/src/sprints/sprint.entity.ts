import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

export enum SprintStatus {
  PLANNED = 'Planned',
  ACTIVE = 'Active',
  COMPLETED = 'Completed',
}

@Entity('sprints')
export class Sprint {
  @PrimaryGeneratedColumn()
  id: number;

  // Multi-tenant conversion Phase A - unused until Phase C wires up query
  // filtering. Nullable only until the migration's backfill runs, which
  // also adds the NOT NULL + FK.
  @Column({ nullable: true })
  tenantId: number;

  // Sprints belong to exactly one project - there's no cross-project sprint.
  @Column()
  projectId: number;

  @Column({ nullable: true })
  projectName: string;

  @Column()
  name: string;

  @Column({ type: 'text', nullable: true })
  goal: string;

  @Column({ type: 'date', nullable: true })
  startDate: string;

  @Column({ type: 'date', nullable: true })
  endDate: string;

  @Column({ type: 'enum', enum: SprintStatus, default: SprintStatus.PLANNED })
  status: SprintStatus;

  @Column({ nullable: true })
  createdByUserId: number;

  @CreateDateColumn()
  createdAt: Date;
}
