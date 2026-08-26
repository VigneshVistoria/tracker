import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

export enum TestResult {
  PASSED = 'Passed',
  FAILED = 'Failed',
  BLOCKED = 'Blocked',
}

// One row per time someone actually runs a test case - append-only, same
// reasoning as Evidence: a correction is a new row, not an edit, so the
// full run history stays intact. TestCase.lastResult/lastExecutedAt below
// are a denormalized pointer at the most recent row here, purely so the
// test case list doesn't need to join/query into this table just to show
// current status.
@Entity('test_executions')
export class TestExecution {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  testCaseId: number;

  @Column({ nullable: true })
  testCaseTitle: string;

  @Column({ nullable: true })
  projectId: number;

  @Column({ nullable: true })
  projectName: string;

  @Column({ type: 'enum', enum: TestResult })
  result: TestResult;

  @Column({ type: 'text', nullable: true })
  notes: string;

  // If this run turned up a bug, the Issue raised for it - optional, set
  // after the fact once the defect ticket exists.
  @Column({ nullable: true })
  defectIssueId: number;

  @Column({ nullable: true })
  executedByUserId: number;

  @Column({ nullable: true })
  executedByEmail: string;

  @CreateDateColumn()
  executedAt: Date;
}
