import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';
import { StoryStatus } from '../requirements';

// A user story: "As a / I want / so that", traced to requirement IDs
// (srs_story_requirements). Status Draft -> Approved -> In progress -> Done;
// In progress and Done are set automatically (see ../requirements.ts).
@Entity('srs_stories')
export class SrsStory {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  @Column()
  srsId: number;

  @Column()
  epicId: number;

  @Column({ type: 'varchar', length: 20 })
  code: string;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'text', nullable: true })
  asA: string | null;

  @Column({ type: 'text', nullable: true })
  iWant: string | null;

  @Column({ type: 'text', nullable: true })
  soThat: string | null;

  @Column({ type: 'varchar', length: 20, default: 'draft' })
  status: StoryStatus;

  @Column({ type: 'int', nullable: true })
  approvedByUserId: number | null;

  @Column({ type: 'timestamp', nullable: true })
  approvedAt: Date | null;

  // Stage 4 change impact.
  @Column({ default: false })
  needsReview: boolean;

  // "Approve at risk" (Stage 2): approved before the SRS was client-signed,
  // with a reason. The At risk label shows until the SRS is client-signed.
  @Column({ default: false })
  atRisk: boolean;

  @Column({ type: 'text', nullable: true })
  atRiskReason: string | null;

  @Column({ type: 'int', nullable: true })
  atRiskByUserId: number | null;

  @Column({ type: 'timestamp', nullable: true })
  atRiskAt: Date | null;

  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  @Column({ type: 'int', nullable: true })
  createdByUserId: number | null;

  @Column({ type: 'timestamp', default: () => 'now()' })
  createdAt: Date;

  @Column({ type: 'timestamp', default: () => 'now()' })
  updatedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  deletedAt: Date | null;

  @Column({ type: 'int', nullable: true })
  deletedByUserId: number | null;
}
