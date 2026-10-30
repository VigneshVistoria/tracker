import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

// Q5 - the append-only evidence log of a technical review.
@Entity('tech_review_evidence')
export class TechReviewEvidence {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  @Column()
  reviewId: number;

  @Column({ type: 'text' })
  note: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  link: string | null;

  @Column()
  addedByUserId: number;

  @CreateDateColumn()
  createdAt: Date;
}
