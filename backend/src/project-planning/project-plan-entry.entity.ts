import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

// Fixed set, plain text (not a DB enum) - same choice made for
// Issue.category, avoids an enum-migration if this list ever needs to
// change later.
export const PROJECT_PLAN_STATUSES = ['ToDo', 'In Progress', 'Completed', 'Delayed'] as const;
export type ProjectPlanStatus = (typeof PROJECT_PLAN_STATUSES)[number];

// Plans work above the level of individual tickets - which Project (and
// optionally Module/Phase/Team) it belongs to, and a target timeline.
// %-complete is deliberately NOT a column here - ProjectPlanningService
// computes it live from the real Issues in scope on every read, see
// computeCompletion(). "Phase" is backed by the existing Sprint entity
// (sprintId/sprintName below), not a new concept - Sprint already has a
// name/date-range/status scoped to one project, and Issues already link
// to it, so it can meaningfully narrow the completion query too. Team
// references the standalone `teams` catalog, but is informational only -
// Issue has no teamId, so Team can never narrow the completion query.
@Entity('project_plan_entries')
export class ProjectPlanEntry {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  @Column()
  projectId: number;

  @Column()
  projectName: string;

  @Column({ nullable: true })
  moduleId: number;

  @Column({ nullable: true })
  moduleName: string;

  // "Phase" - see class comment above for why this points at Sprint.
  @Column({ nullable: true })
  sprintId: number;

  @Column({ nullable: true })
  sprintName: string;

  @Column({ nullable: true })
  teamId: number;

  @Column({ nullable: true })
  teamName: string;

  @Column({ type: 'date' })
  startDate: string;

  @Column({ type: 'date' })
  targetDate: string;

  @Column({ default: 'ToDo' })
  status: ProjectPlanStatus;

  @Column({ default: true })
  isActive: boolean;

  @Column({ nullable: true })
  createdByUserId: number;

  @Column()
  createdByEmail: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
