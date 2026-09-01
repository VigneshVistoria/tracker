import { Entity, Column, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

// The fixed list of valid Task status values - lives here since this
// module owns "the set of statuses and what each is worth." TasksService
// validates Task.status against this same list.
export const TASK_STATUSES = [
  'To Do',
  'In Progress',
  'Ready for Feedback',
  'Feedback Pass',
  'Feedback Failed',
  'Released - No Showstoppers',
  'Released - With Showstoppers',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

// Seed defaults only, confirmed with the user - the live mapping is this
// entity's rows, admin-editable via /task-status-config so the
// percentages can change later without a code deploy.
export const TASK_STATUS_PERCENT_DEFAULTS: Record<TaskStatus, number> = {
  'To Do': 0,
  'In Progress': 0,
  'Ready for Feedback': 50,
  'Feedback Pass': 90,
  'Feedback Failed': 0,
  'Released - No Showstoppers': 100,
  'Released - With Showstoppers': 0,
};

@Entity('task_status_percent_config')
export class TaskStatusPercent {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  @Column()
  status: string;

  @Column({ type: 'int' })
  percent: number;

  @Column({ nullable: true })
  updatedByUserId: number;

  @Column({ nullable: true })
  updatedByEmail: string;

  @UpdateDateColumn()
  updatedAt: Date;
}
