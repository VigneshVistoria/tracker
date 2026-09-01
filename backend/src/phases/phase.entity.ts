import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

// A phase belongs to exactly one Module (which itself belongs to exactly
// one Project) - more granular than Sprint, which is Project-scoped only.
// Replaces Sprint's incidental use as "Phase" on Project Planning entries
// (Sprint itself is untouched as its own separate feature). Deliberately
// as thin as Module/Sprint - %Complete is never stored, only derived from
// Issue.phaseId on read (see PhasesService).
@Entity('phases')
export class Phase {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  // Denormalized from the Module at creation - resolved server-side, not
  // trusted from the client (same as Module resolves projectName from
  // ProjectsService).
  @Column()
  projectId: number;

  @Column()
  projectName: string;

  @Column()
  moduleId: number;

  @Column()
  moduleName: string;

  @Column()
  name: string;

  @Column({ default: true })
  isActive: boolean;

  @Column({ nullable: true })
  createdByUserId: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
