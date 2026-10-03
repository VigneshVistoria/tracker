import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index } from 'typeorm';

// QA/Program Manager manually flagging an *existing* Defect as blocking a
// Task ("Link Blocking Defect" on the task detail page). Separate from
// ProjectTask.parentTaskId, which only records "this defect was spun off
// that task's QA rejection" - a defect has at most one parent but can
// block any number of tasks, and unlinking here must never erase that
// provenance. Both kinds feed the same gate,
// TasksService.assertNoOpenLinkedDefects().
@Entity('task_blocking_defects')
@Index(['taskId', 'defectId'], { unique: true })
export class TaskBlockingDefect {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  // The blocked (non-defect) task.
  @Column()
  taskId: number;

  // A ProjectTask row with isDefect = true.
  @Column()
  defectId: number;

  @Column({ nullable: true })
  linkedByUserId: number;

  @Column()
  linkedByEmail: string;

  @CreateDateColumn()
  createdAt: Date;
}
