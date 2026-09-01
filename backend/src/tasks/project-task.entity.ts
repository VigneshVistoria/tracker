import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

// A task-level work item, required through the full Project -> Module ->
// Phase -> Sprint chain - a more granular, more constrained concept than
// Issue (which links to all four only optionally). Deliberately a
// separate entity rather than extending Issue, following the same
// plain-FK-plus-denormalized-name convention Issue already uses for
// sprintId/sprintName. No isActive - Tasks are never deactivated.
@Entity('project_tasks')
export class ProjectTask {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  @Column()
  projectId: number;

  @Column()
  projectName: string;

  @Column()
  moduleId: number;

  @Column()
  moduleName: string;

  @Column()
  phaseId: number;

  @Column()
  phaseName: string;

  @Column()
  sprintId: number;

  @Column()
  sprintName: string;

  @Column({ type: 'text' })
  description: string;

  @Column()
  assigneeUserId: number;

  @Column()
  assigneeEmail: string;

  // "E.Hrs" - one-time entry: once non-null, only Admin/Program Manager
  // can change it further (enforced in TasksService.update(), not here).
  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  estimatedHours: number;

  @Column({ type: 'date', nullable: true })
  dueDate: string;

  @Column({ default: false })
  dependency: boolean;

  @Column({ type: 'text', nullable: true })
  dependencyDescription: string;

  // Restricted to UserRole.DEVELOPER, enforced in TasksService.
  @Column({ nullable: true })
  dependencyOwnerUserId: number;

  @Column({ nullable: true })
  dependencyOwnerEmail: string;

  // One of TASK_STATUSES (task-status-config/task-status-percent.entity) -
  // null until estimatedHours and dueDate are both set (enforced in
  // TasksService.updateStatus()/create()).
  @Column({ nullable: true })
  status: string;

  @Column({ nullable: true })
  feedbackLink: string;

  @Column({ nullable: true })
  createdByUserId: number;

  @Column()
  createdByEmail: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
