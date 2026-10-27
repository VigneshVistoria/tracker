import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

@Entity('projects')
export class Project {
  @PrimaryGeneratedColumn()
  id: number;

  // Multi-tenant conversion Phase A - unused until Phase C wires up query
  // filtering. Nullable only until the migration's backfill runs, which
  // also adds the NOT NULL + FK.
  @Column({ nullable: true })
  tenantId: number;

  @Column()
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  // PM review gate (2026-10-13): when on, a developer's task submission
  // waits for a PM before QA (backend/src/tasks/pm-review.ts). Admin
  // switches it per project; default off.
  @Column({ default: false })
  pmReviewEnabled: boolean;

  // Defect classification + triage (2026-10-27): when on, QA classifies
  // new defects and the developer must Accept or Dispute each one
  // (backend/src/tasks/defect-triage.ts). Admin or Program Manager
  // switches it per project; default off.
  @Column({ default: false })
  defectTriageEnabled: boolean;

  // Developer submission checklist (defect triage Stage 2, 2026-10-27):
  // when on, Submit for QA needs the checklist complete
  // (backend/src/tasks/submission-checklist.ts). Admin or Program Manager
  // switches it per project; default off.
  @Column({ default: false })
  submissionChecklistEnabled: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
