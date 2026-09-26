import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

// One ticket (project task) in a Release. `resolution` is a snapshot of
// the task's latest QA/Peer Review round's Resolution (already
// sanitizeRichText()'d HTML) taken when the row was added, so the log
// stays a fixed record of what shipped. sourceReviewId is the
// task_qa_reviews row it was copied from.
@Entity('release_items')
export class ReleaseItem {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  @Column()
  releaseId: number;

  @Column()
  taskId: number;

  @Column()
  taskTitle: string;

  @Column({ type: 'text', nullable: true })
  resolution: string;

  @Column({ nullable: true })
  sourceReviewId: number;

  @Column({ nullable: true })
  addedByUserId: number;

  @CreateDateColumn()
  createdAt: Date;
}
