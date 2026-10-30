import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

// Performance Tracking P3/P4 (migrations/2026-11-performance-tracking-
// security-findings.sql) - see ./security-findings.ts.
@Entity('security_findings')
export class SecurityFinding {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  @Column()
  projectId: number;

  @Column({ type: 'int', nullable: true })
  taskId: number | null;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'varchar', length: 10 })
  severity: string;

  // Where it came from (manual review, pen test, a scanner...).
  @Column({ type: 'varchar', length: 100, nullable: true })
  source: string | null;

  @Column({ type: 'text', nullable: true })
  details: string | null;

  @Column()
  ownerUserId: number;

  @Column({ type: 'date' })
  foundOn: string;

  // The finding's own SLA (from foundOn) - shown, not charged.
  @Column({ type: 'date' })
  dueOn: string;

  // When the current owner got it, and their due day (P4) - reassignment restarts both.
  @Column({ type: 'date' })
  assignedOn: string;

  @Column({ type: 'date' })
  ownerDueOn: string;

  @Column({ type: 'varchar', length: 20, default: 'open' })
  status: string;

  @Column({ type: 'timestamp', nullable: true })
  fixSubmittedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  fixNote: string | null;

  @Column({ type: 'int', default: 0 })
  verifyAttempts: number;

  @Column({ type: 'varchar', length: 10, nullable: true })
  firstVerifyResult: string | null;

  @Column({ type: 'timestamp', nullable: true })
  firstVerifiedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  fixedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  verifiedAt: Date | null;

  @Column({ type: 'int', nullable: true })
  verifiedByUserId: number | null;

  @Column({ type: 'timestamp', nullable: true })
  riskAcceptedAt: Date | null;

  @Column({ type: 'int', nullable: true })
  riskAcceptedByUserId: number | null;

  @Column({ type: 'text', nullable: true })
  riskReason: string | null;

  @Column()
  createdByUserId: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
