import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

// ReleaseBot Section 11's accepted evidence types. Kept as an enum (rather
// than free text) so the mandatory-evidence gate and reporting can reason
// about "is this a link vs. an upload" consistently.
export enum EvidenceType {
  SHAREPOINT_LINK = 'SharePoint Link',
  ONEDRIVE_LINK = 'OneDrive Link',
  AZURE_DEVOPS_LINK = 'Azure DevOps Link',
  PULL_REQUEST_LINK = 'Pull Request Link',
  GIT_COMMIT_LINK = 'Git Commit Link',
  BUILD_PIPELINE_LINK = 'Build Pipeline Link',
  DEPLOYMENT_REPORT = 'Deployment Report',
  FUNCTIONAL_TEST_EVIDENCE = 'Functional Test Evidence',
  SCREENSHOT = 'Screenshot',
  DEMO_VIDEO = 'Demo Video',
  TECHNICAL_DOCUMENTATION = 'Technical Documentation',
}

// First-class evidence record (ReleaseBot Sections 11-14). One issue can
// have many; the mandatory-evidence gate before "Development Completed"
// (Section 12) just checks "does at least one of these exist for this
// issue" - enforced in IssuesService, not here.
@Entity('evidence')
export class Evidence {
  @PrimaryGeneratedColumn()
  id: number;

  // Multi-tenant conversion Phase A - unused until Phase C wires up query
  // filtering. Nullable only until the migration's backfill runs, which
  // also adds the NOT NULL + FK.
  @Column({ nullable: true })
  tenantId: number;

  @Column()
  issueId: number;

  @Column()
  title: string;

  @Column({ type: 'enum', enum: EvidenceType })
  type: EvidenceType;

  // text, not varchar - some of these (SharePoint/OneDrive share links in
  // particular) run well past a typical varchar's comfort length.
  @Column({ type: 'text' })
  url: string;

  @Column({ nullable: true })
  submittedByUserId: number;

  @Column()
  submittedByEmail: string;

  @Column({ type: 'text', nullable: true })
  comments: string;

  // Doubles as Section 11's "Submission Date" - no separate column, since
  // evidence rows are never edited after creation (a correction is a new
  // row, so the history stays intact for audit purposes).
  @CreateDateColumn()
  createdAt: Date;
}
