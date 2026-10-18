import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

// A screenshot the deciding QA attached to a review round (approve,
// reject or escalate - incl. a retest). Same shape, storage and rules as
// TaskAttachment (defect screenshots); see migrations/
// 2026-10-qa-review-attachments.sql.
@Entity('task_qa_review_attachments')
export class TaskQaReviewAttachment {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  @Column()
  taskQaReviewId: number;

  @Column()
  taskId: number;

  @Column()
  uploadedByUserId: number;

  @Column({ length: 200 })
  fileName: string;

  @Column({ length: 100 })
  mimeType: string;

  @Column()
  sizeBytes: number;

  @Column({ length: 300 })
  storageKey: string;

  @CreateDateColumn()
  createdAt: Date;
}
