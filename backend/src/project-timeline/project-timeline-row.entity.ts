import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import type { TimelineStatus } from './project-timeline-rules';

// One Module + Phase line of a project's Project Timeline (2026-10-16).
// Module and Phase are plain text, deliberately NOT links to the
// modules/phases master - a 97-row plan would otherwise flood every task
// and issue picker, and the master has no dates. Created by
// migrations/2026-10-project-timeline.sql, which also holds the status and
// date CHECKs and the deferred unique (tenantId, projectId, matchKey).
@Entity('project_timeline_rows')
export class ProjectTimelineRow {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  @Column()
  projectId: number;

  @Column({ type: 'varchar', length: 200 })
  module: string;

  @Column({ type: 'varchar', length: 300 })
  phase: string;

  // matchKeyFor(module, phase) - what re-uploads match on.
  @Column({ type: 'varchar', length: 520 })
  matchKey: string;

  @Column({ type: 'int', nullable: true })
  teamId: number | null;

  @Column({ type: 'varchar', length: 20, default: 'To Do' })
  status: TimelineStatus;

  // Plain YYYY-MM-DD strings, same as ProjectTask.dueDate.
  @Column({ type: 'date', nullable: true })
  startDate: string | null;

  @Column({ type: 'date', nullable: true })
  endDate: string | null;

  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  // Bumped on every update - "Save changes" sends the version it loaded, so
  // a save can never silently overwrite someone else's newer edit.
  @Column({ type: 'int', default: 1 })
  version: number;

  @Column({ type: 'int', nullable: true })
  createdByUserId: number | null;

  @Column({ type: 'varchar', nullable: true })
  createdByEmail: string | null;

  @Column({ type: 'int', nullable: true })
  updatedByUserId: number | null;

  @Column({ type: 'varchar', nullable: true })
  updatedByEmail: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
