import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';
import { RequirementPriority } from '../requirements';

// One requirement ID (LN-01, NFR-1). code = prefix + '-' + seq. Unique per
// SRS including soft-deleted rows, so an ID is never reused.
@Entity('srs_requirements')
export class SrsRequirement {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  @Column()
  srsId: number;

  // The SRS section (Stage 3 editor); null until then.
  @Column({ type: 'int', nullable: true })
  sectionId: number | null;

  @Column({ type: 'varchar', length: 20 })
  code: string;

  @Column({ type: 'varchar', length: 10 })
  prefix: string;

  @Column({ type: 'int' })
  seq: number;

  @Column({ type: 'text' })
  text: string;

  @Column({ type: 'varchar', length: 10 })
  priority: RequirementPriority;

  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  @Column({ type: 'timestamp', default: () => 'now()' })
  createdAt: Date;

  @Column({ type: 'timestamp', default: () => 'now()' })
  updatedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  deletedAt: Date | null;
}
