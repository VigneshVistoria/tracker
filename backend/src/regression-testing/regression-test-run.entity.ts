import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
} from 'typeorm';

export enum RegressionRunStatus {
  RUNNING = 'running',
  PASSED = 'passed',
  FAILED = 'failed',
}

// One row per check performed during a run (a health check like "DB
// reachable" or a feature test like "create issue"). Stored as JSON on
// the run itself - simplest option since we never need to query into
// individual checks separately, only display them alongside their run.
export interface RegressionCheckResult {
  name: string; // e.g. "Database connectivity"
  category: 'health' | 'feature';
  passed: boolean;
  durationMs: number;
  details?: string; // short human-readable outcome, shown even when passed
  error?: string; // error message, present only when passed === false
  stack?: string; // stack trace / extra log detail, present only when passed === false
}

@Entity('regression_test_runs')
export class RegressionTestRun {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'enum', enum: RegressionRunStatus, default: RegressionRunStatus.RUNNING })
  status: RegressionRunStatus;

  @Column({ nullable: true })
  triggeredByUserId: number;

  @Column({ nullable: true })
  triggeredByEmail: string;

  // Full list of individual check results, health checks first then
  // feature tests, in the order they ran.
  @Column({ type: 'simple-json', nullable: true })
  results: RegressionCheckResult[];

  @Column({ type: 'int', default: 0 })
  passedCount: number;

  @Column({ type: 'int', default: 0 })
  failedCount: number;

  @Column({ type: 'int', default: 0 })
  totalDurationMs: number;

  @CreateDateColumn()
  startedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  finishedAt: Date;
}
