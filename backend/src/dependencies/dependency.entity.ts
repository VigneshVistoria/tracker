import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { Priority } from '../common/priority.enum';

// ReleaseBot Section 6's workflow. OPEN is the starting state for every
// dependency; from there it either proceeds through the normal happy path
// (UNDER_REVIEW -> ASSIGNED -> IN_PROGRESS -> RESOLVED -> CLOSED) or - if
// impact.blocking is true and it doesn't move - diverts to BLOCKED and
// eventually ESCALATED per the Section 8 timers.
export enum DependencyStatus {
  OPEN = 'Open',
  UNDER_REVIEW = 'Under Review',
  ASSIGNED = 'Assigned',
  IN_PROGRESS = 'In Progress',
  RESOLVED = 'Resolved',
  CLOSED = 'Closed',
  BLOCKED = 'Blocked',
  ESCALATED = 'Escalated',
}

// Section 7's "Impact Level" - deliberately a separate concept from
// Priority (which is about how fast someone should act on it); a
// dependency can be low priority to schedule but still high impact once
// it actually lands.
export enum DependencyImpactLevel {
  CRITICAL = 'Critical',
  HIGH = 'High',
  MEDIUM = 'Medium',
  LOW = 'Low',
}

// First-class dependency record (ReleaseBot Sections 4-8), replacing the
// old approach of just spinning off a plain child Issue via
// Issue.parentIssueId. That approach couldn't carry a workflow, impact
// fields, or escalation timers - this can.
//
// "Feature" isn't a concept this app models yet, so Section 4's "must be
// linked to Parent Work Item / Parent Feature / Parent Release" is
// satisfied today via impactedIssueId (required) and releaseId (nullable
// until the Release entity exists in a later phase). Revisit if a
// separate Feature entity is ever introduced.
@Entity('dependencies')
export class Dependency {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  title: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'text' })
  blockingReason: string;

  @Column()
  requestedTeam: string;

  // The team/person this dependency is waiting on, not who filed it.
  @Column({ nullable: true })
  ownerUserId: number;

  @Column()
  ownerEmail: string;

  @Column({ type: 'enum', enum: Priority })
  priority: Priority;

  @Column({ type: 'date' })
  requiredByDate: string;

  // Section 4/5's mandatory link to a parent work item - standalone
  // dependencies are rejected at creation (enforced in the service layer,
  // not here, so both the REST API and the Teams #dependency command go
  // through the same check).
  @Column()
  impactedIssueId: number;

  // Nullable until a first-class Release entity exists (planned for a
  // later phase); set this once that lands.
  @Column({ nullable: true })
  releaseId: number;

  @Column({ type: 'text' })
  businessJustification: string;

  @Column({ type: 'enum', enum: DependencyStatus, default: DependencyStatus.OPEN })
  status: DependencyStatus;

  @Column({ type: 'enum', enum: DependencyImpactLevel })
  impactLevel: DependencyImpactLevel;

  // Section 7: "If Blocking = YES" drives auto-marking the linked task
  // Blocked and notifying the Program Manager/QA Lead.
  @Column({ type: 'boolean', default: false })
  blocking: boolean;

  @Column({ type: 'int', nullable: true })
  estimatedDelayDays: number;

  @Column({ nullable: true })
  createdByUserId: number;

  @Column()
  createdByEmail: string;

  @Column({ type: 'timestamp', nullable: true })
  resolvedAt: Date;

  // Set the first time this dependency crosses any Section 8 escalation
  // threshold, so the daily escalation job can tell "already escalated
  // once" apart from "just crossed the line right now."
  @Column({ type: 'timestamp', nullable: true })
  escalatedAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
