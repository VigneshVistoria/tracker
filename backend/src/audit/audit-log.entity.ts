import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

// Append-only log backing ReleaseBot Section 39 (Audit & Compliance) and
// every other section that says "must be logged" (unauthorized ticket-
// creation attempts, report exclusions, production approvals, QA
// decisions, and so on). Deliberately generic - `action` is a free-form
// string (see AuditActions in audit-log.service.ts for the known set)
// rather than a rigid enum, since new event types will keep getting added
// phase by phase and a Postgres enum requires a migration for every new
// value. Rows are never updated or deleted from application code.
@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn()
  id: number;

  // Multi-tenant conversion Phase A - unused until Phase C wires up query
  // filtering. Nullable only until the migration's backfill runs, which
  // also adds the NOT NULL + FK.
  @Column({ nullable: true })
  tenantId: number;

  // Null for actions taken by an integration/system process (e.g. the
  // Teams bot itself, a scheduled escalation job) rather than a logged-in
  // person.
  @Column({ nullable: true })
  userId: number;

  @Column({ nullable: true })
  userEmail: string;

  // Snapshot of the user's role at the time of the action - roles can
  // change later, and the audit trail should reflect what was true when
  // it happened, not what's true now.
  @Column({ nullable: true })
  userRole: string;

  @Column()
  action: string;

  @Column({ nullable: true })
  entityType: string;

  @Column({ nullable: true })
  entityId: number;

  // Free-form JSON-stringified context (attempted values, block/rejection
  // reason, old vs. new values, etc.) - shape intentionally varies by
  // action type, so this stays text rather than a fixed set of columns.
  @Column({ type: 'text', nullable: true })
  details: string;

  @CreateDateColumn()
  createdAt: Date;
}
