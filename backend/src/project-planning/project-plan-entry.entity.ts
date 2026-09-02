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
// computeCompletion(). "Phase" is backed by the real Phase entity
// (backend/src/phases) - a Phase belongs to exactly one Module, and
// Issue.phaseId links to it, so it can meaningfully narrow the completion
// query too. (Previously stood in for Sprint before Phase existed as its
// own entity - Sprint is untouched as its own separate feature.) Team
// references the per-Project `project_teams` table (backend/src/project-
// teams), scoped to whichever Project the entry belongs to - but is
// informational only, same as Phase/Module: Issue has no teamId, so Team
// can never narrow the completion query.
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

  // "Phase" - see class comment above.
  @Column({ nullable: true })
  phaseId: number;

  @Column({ nullable: true })
  phaseName: string;

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
