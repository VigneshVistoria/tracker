import { Column, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type ArtifactRequirement = 'optional' | 'required';
export const ARTIFACT_REQUIREMENTS: ArtifactRequirement[] = ['optional', 'required'];

// Per role (Developer / Designer / DevOps): which artifact types the role is
// offered, and whether each is required or optional (required applies at
// Ready for Feedback and Peer Review). A role with no rules is offered
// every active type, all optional.
@Entity('artifact_type_rules')
export class ArtifactTypeRule {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  @Column()
  artifactTypeId: number;

  @Column({ type: 'varchar', length: 30 })
  role: string;

  @Column({ type: 'varchar', length: 10, default: 'optional' })
  requirement: ArtifactRequirement;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
