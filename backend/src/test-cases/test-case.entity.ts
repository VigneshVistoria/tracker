import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';
import { Priority } from '../common/priority.enum';
import { IssueCategory } from '../issues/issue.entity';
import { TestResult } from './test-execution.entity';

// A test case's own lifecycle (still usable vs. retired) is separate from
// its most recent run result below - a test case can be Active and have
// last failed, or Deprecated after having passed for years. There's no
// hard delete for test cases, same reasoning Evidence uses for not
// editing rows after creation: retiring one via status keeps its
// execution history meaningful instead of orphaning it.
export enum TestCaseStatus {
  ACTIVE = 'Active',
  DEPRECATED = 'Deprecated',
}

@Entity('test_cases')
export class TestCase {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ type: 'text', nullable: true })
  preconditions: string;

  @Column({ type: 'text' })
  steps: string;

  @Column({ type: 'text' })
  expectedResult: string;

  @Column({ type: 'enum', enum: Priority, nullable: true })
  priority: Priority;

  // Reuses Issue's category enum rather than inventing a parallel one -
  // "what kind of work is this" means the same thing for a test case as
  // it does for an issue.
  @Column({ type: 'enum', enum: IssueCategory, nullable: true })
  category: IssueCategory;

  @Column({ nullable: true })
  projectId: number;

  @Column({ nullable: true })
  projectName: string;

  @Column({ type: 'enum', enum: TestCaseStatus, default: TestCaseStatus.ACTIVE })
  status: TestCaseStatus;

  @Column({ nullable: true })
  createdByUserId: number;

  @Column({ nullable: true })
  createdByEmail: string;

  // Denormalized from this test case's most recent TestExecution row -
  // see that entity's comment for why. Null until it's been run once.
  @Column({ type: 'enum', enum: TestResult, nullable: true })
  lastResult: TestResult;

  @Column({ type: 'timestamp', nullable: true })
  lastExecutedAt: Date;

  @Column({ nullable: true })
  lastExecutedByEmail: string;

  @CreateDateColumn()
  createdAt: Date;
}
