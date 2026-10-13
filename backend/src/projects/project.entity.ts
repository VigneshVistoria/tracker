import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

@Entity('projects')
export class Project {
  @PrimaryGeneratedColumn()
  id: number;

  // Multi-tenant conversion Phase A - unused until Phase C wires up query
  // filtering. Nullable only until the migration's backfill runs, which
  // also adds the NOT NULL + FK.
  @Column({ nullable: true })
  tenantId: number;

  @Column()
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  // PM review gate (2026-10-13): when on, a developer's task submission
  // waits for a PM before QA (backend/src/tasks/pm-review.ts). Admin
  // switches it per project; default off.
  @Column({ default: false })
  pmReviewEnabled: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
