import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

// Project Timeline's managed Team list (Amanah, Vistoria, ...) - tenant-
// wide, a plain list on purpose: not the clients table (Vistoria isn't a
// client) and not project_teams (that one is Program-Manager-only to edit,
// Project Timeline lets Admin add teams too). Created by
// migrations/2026-10-project-timeline.sql, which also adds the
// case-insensitive unique name index.
@Entity('project_timeline_teams')
export class ProjectTimelineTeam {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'int', nullable: true })
  createdByUserId: number | null;

  @CreateDateColumn()
  createdAt: Date;
}
