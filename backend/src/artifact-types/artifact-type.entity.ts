import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

// Submission artifact types, editable by Admin / Program Manager (Admin ->
// Submission Checklist Settings -> Artifact types, 2026-11-06). Table from
// migrations/2026-11-artifact-types-config.sql. "code" is fixed forever and
// is what task_qa_review_artifacts.type stores; "label" is what people see.
// Types are deactivated, never deleted, so past submissions stay valid.
@Entity('artifact_types')
export class ArtifactType {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  @Column({ type: 'varchar', length: 60 })
  code: string;

  @Column({ type: 'varchar', length: 60 })
  label: string;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @Column({ type: 'integer', default: 0 })
  sortOrder: number;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
