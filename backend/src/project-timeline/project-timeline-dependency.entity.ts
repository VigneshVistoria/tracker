import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

// Project Timeline Stage B (migrations/2026-10-project-timeline-
// dependencies.sql): "successor starts after predecessor finishes", plus
// an optional gap of lagDays calendar days. Rows of one project only;
// cycles are refused by the service. Deleting either row deletes the link.
@Entity('project_timeline_dependencies')
export class ProjectTimelineDependency {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  @Column()
  projectId: number;

  @Column()
  predecessorRowId: number;

  @Column()
  successorRowId: number;

  @Column({ type: 'int', default: 0 })
  lagDays: number;

  @Column({ type: 'int', nullable: true })
  createdByUserId: number | null;

  @CreateDateColumn()
  createdAt: Date;
}
