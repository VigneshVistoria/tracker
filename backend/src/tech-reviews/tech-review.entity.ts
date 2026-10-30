import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

// Q5 (migrations/2026-11-performance-tracking-tech-reviews.sql) - one
// reviewed item of a person's work, scored 1-5 per rubric item. See
// ./tech-reviews.ts.
@Entity('tech_reviews')
export class TechReview {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  @Column()
  projectId: number;

  @Column()
  revieweeUserId: number;

  @Column()
  reviewerUserId: number;

  // YYYY-MM.
  @Column({ type: 'varchar', length: 7 })
  month: string;

  @Column({ type: 'varchar', length: 200 })
  itemTitle: string;

  @Column({ type: 'int', nullable: true })
  taskId: number | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  itemLink: string | null;

  // { criterion: 1-5 } - the rubric as it was when scored.
  @Column({ type: 'jsonb' })
  scores: Record<string, number>;

  @Column({ type: 'numeric', precision: 4, scale: 2 })
  average: string;

  @Column({ type: 'text', nullable: true })
  comment: string | null;

  @CreateDateColumn()
  reviewedAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
