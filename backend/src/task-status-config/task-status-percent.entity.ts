import { Entity, Column, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

// The fixed list of valid Task status values - lives here since this
// module owns "the set of statuses and what each is worth." TasksService
// validates Task.status against this same list.
//
// Development/Feedback/Re-Feedback/Failed/Pass are the only statuses any
// task can reach going forward - Status is fully auto-computed by task
// events (see TasksService.create()/TaskQaReviewsService), there is no
// more manual status selection anywhere in the Task flow. The two
// Released statuses are kept here deliberately dormant (confirmed with
// the user 2026-09): existing tasks already in a Released status keep
// it, and the % Complete config below still carries a row for each so an
// admin can still see/edit their percent, but no code path sets them
// anymore now that the manual status endpoint is gone.
// 'Peer Review'/'Re-Peer-Review' parallel 'Feedback'/'Re-Feedback' - the
// same first-submission/resubmission split, but for a task with
// peerReviewEnabled set (see ProjectTask.peerReviewEnabled,
// PeerReviewsService.submit()) instead of going through QA. Kept as their
// own status values (not a reuse of Feedback/Re-Feedback with a type
// flag) so TasksService.findQaQueue()'s status filter never picks up a
// peer-pending task.
export const TASK_STATUSES = [
  'Development',
  'Feedback',
  'Re-Feedback',
  'Peer Review',
  'Re-Peer-Review',
  'Failed',
  'Pass',
  'Released - No Showstoppers',
  'Released - With Showstoppers',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

// Seed defaults only, confirmed with the user - the live mapping is this
// entity's rows, admin-editable via /task-status-config so the
// percentages can change later without a code deploy.
export const TASK_STATUS_PERCENT_DEFAULTS: Record<TaskStatus, number> = {
  Development: 0,
  Feedback: 50,
  'Re-Feedback': 50,
  'Peer Review': 50,
  'Re-Peer-Review': 50,
  Failed: 0,
  Pass: 100,
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
