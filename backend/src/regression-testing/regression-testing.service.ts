import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import {
  RegressionTestRun,
  RegressionRunStatus,
  RegressionCheckResult,
} from './regression-test-run.entity';
import { User, UserRole } from '../users/user.entity';
import { Project } from '../projects/project.entity';
import { Issue, IssueMode, IssueStatus } from '../issues/issue.entity';
import { DailyUpdate } from '../daily-updates/daily-update.entity';
import { AuthService } from '../auth/auth.service';
import { IssuesService } from '../issues/issues.service';
import { ProjectsService } from '../projects/projects.service';
import { DailyUpdatesService } from '../daily-updates/daily-updates.service';
import { IssueAnalyzerService } from '../issues/issue-analyzer.service';
import { EventsGateway } from '../events/events.gateway';
import * as bcrypt from 'bcryptjs';

// All test data this run creates gets this prefix in its title/name/email,
// so it's unmistakable if cleanup ever fails and something is left behind.
const TEST_TAG = '[Regression Test]';

@Injectable()
export class RegressionTestingService {
  private readonly logger = new Logger(RegressionTestingService.name);

  constructor(
    @InjectDataSource() private dataSource: DataSource,
    @InjectRepository(RegressionTestRun) private runsRepository: Repository<RegressionTestRun>,
    @InjectRepository(User) private usersRepository: Repository<User>,
    @InjectRepository(Project) private projectsRepository: Repository<Project>,
    @InjectRepository(Issue) private issuesRepository: Repository<Issue>,
    @InjectRepository(DailyUpdate) private dailyUpdatesRepository: Repository<DailyUpdate>,
    private configService: ConfigService,
    private authService: AuthService,
    private issuesService: IssuesService,
    private projectsService: ProjectsService,
    private dailyUpdatesService: DailyUpdatesService,
    private issueAnalyzerService: IssueAnalyzerService,
    private eventsGateway: EventsGateway,
  ) {}

  async run(triggeredByUserId?: number, triggeredByEmail?: string): Promise<RegressionTestRun> {
    const results: RegressionCheckResult[] = [];

    results.push(...(await this.runHealthChecks()));
    results.push(...(await this.runFeatureTests()));

    const passedCount = results.filter((r) => r.passed).length;
    const failedCount = results.length - passedCount;
    const totalDurationMs = results.reduce((sum, r) => sum + r.durationMs, 0);

    const run = this.runsRepository.create({
      status: failedCount === 0 ? RegressionRunStatus.PASSED : RegressionRunStatus.FAILED,
      triggeredByUserId: triggeredByUserId ?? null,
      triggeredByEmail: triggeredByEmail ?? null,
      results,
      passedCount,
      failedCount,
      totalDurationMs,
      finishedAt: new Date(),
    });

    const saved = await this.runsRepository.save(run);
    this.eventsGateway.emitRegressionTestCompleted(saved);
    return saved;
  }

  findHistory(limit = 20): Promise<RegressionTestRun[]> {
    return this.runsRepository.find({ order: { startedAt: 'DESC' }, take: limit });
  }

  findOne(id: number): Promise<RegressionTestRun | null> {
    return this.runsRepository.findOne({ where: { id } });
  }

  // ---- Health checks: is the environment itself okay? ----------------

  private async runHealthChecks(): Promise<RegressionCheckResult[]> {
    return [
      await this.check('health', 'Database connectivity', async () => {
        await this.dataSource.query('SELECT 1');
        return 'Query executed successfully against the configured database.';
      }),

      await this.check('health', 'Required tables reachable', async () => {
        const [users, projects, issues, dailyUpdates] = await Promise.all([
          this.usersRepository.count(),
          this.projectsRepository.count(),
          this.issuesRepository.count(),
          this.dailyUpdatesRepository.count(),
        ]);
        return `users=${users}, projects=${projects}, issues=${issues}, dailyUpdates=${dailyUpdates}`;
      }),

      await this.check('health', 'Required environment variables set', async () => {
        const required = ['DB_HOST', 'DB_USERNAME', 'DB_PASSWORD', 'DB_NAME', 'JWT_SECRET'];
        const missing = required.filter((key) => !this.configService.get<string>(key));
        if (missing.length > 0) {
          throw new Error(`Missing environment variable(s): ${missing.join(', ')}`);
        }
        return 'DB_HOST, DB_USERNAME, DB_PASSWORD, DB_NAME, and JWT_SECRET are all set.';
      }),

      await this.check('health', 'At least one admin account exists', async () => {
        const adminCount = await this.usersRepository.count({ where: { role: 'admin' as any } });
        if (adminCount === 0) {
          throw new Error('No user with the admin role was found - someone needs to be promoted via User Management.');
        }
        return `${adminCount} admin account(s) found.`;
      }),

      await this.check('health', 'Real-time (Socket.IO) gateway initialized', async () => {
        if (!this.eventsGateway.server) {
          throw new Error('The Socket.IO server has not initialized - live updates will not reach browser tabs.');
        }
        return 'Socket.IO server is initialized and accepting connections.';
      }),
    ];
  }

  // ---- Feature tests: exercise the real code paths end-to-end --------

  private async runFeatureTests(): Promise<RegressionCheckResult[]> {
    const results: RegressionCheckResult[] = [];
    const stamp = Date.now();
    const testEmail = `regression.test.${stamp}@internal.test`;
    const testPassword = 'RegressionTest!12345';

    let testUserId: number | null = null;
    let testProjectId: number | null = null;
    let testIssueId: number | null = null;
    let testDailyUpdateId: number | null = null;

    try {
      results.push(
        await this.check('feature', 'User registration', async () => {
          const passwordHash = await bcrypt.hash(testPassword, 10); const user = await this.usersRepository.save(this.usersRepository.create({ email: testEmail, passwordHash, fullName: `${TEST_TAG} User`, role: UserRole.DEVELOPER }));
          testUserId = user.id;
          return `Registered test user #${user.id}.`;
        }),
      );

      results.push(
        await this.check('feature', 'Login with correct password', async () => {
          const { accessToken } = await this.authService.login({ email: testEmail, password: testPassword });
          if (!accessToken) throw new Error('Login succeeded but no access token was returned.');
          return 'Login returned a valid access token.';
        }),
      );

      results.push(
        await this.check('feature', 'Login is rejected with wrong password', async () => {
          try {
            await this.authService.login({ email: testEmail, password: 'not-the-right-password' });
          } catch (err) {
            if (err instanceof UnauthorizedException) {
              return 'Login correctly rejected an incorrect password.';
            }
            throw err;
          }
          throw new Error('Login succeeded with an incorrect password - this should never happen.');
        }),
      );

      results.push(
        await this.check('feature', 'Project creation', async () => {
          const project = await this.projectsService.create({
            name: `${TEST_TAG} Project ${stamp}`,
            description: 'Created automatically by the regression test suite. Safe to ignore - removed automatically at the end of the run.',
          });
          testProjectId = project.id;
          return `Created test project #${project.id}.`;
        }),
      );

      results.push(
        await this.check('feature', 'Issue creation defaults to Backlog', async () => {
          if (!testUserId || !testProjectId) throw new Error('Skipped - an earlier setup step failed.');
          const issue = await this.issuesService.create(
            {
              title: `${TEST_TAG} Sample issue`,
              description: 'Created automatically by the regression test suite.',
              assigneeUserId: testUserId,
              projectId: testProjectId,
              mode: IssueMode.MANUAL,
              showstopper: false,
            } as any,
            testUserId,
            testEmail,
          );
          testIssueId = issue.id;
          if (issue.status !== IssueStatus.BACKLOG) {
            throw new Error(`Expected a new issue to default to "Backlog", got "${issue.status}".`);
          }
          if (issue.assigneeEmail !== testEmail) {
            throw new Error('Issue was created but the assignee was not attached correctly.');
          }
          return `Created issue #${issue.id} with status "${issue.status}" and correct assignee.`;
        }),
      );

      results.push(
        await this.check('feature', 'Assignee can move an issue from Backlog to In Progress', async () => {
          if (!testIssueId || !testUserId) throw new Error('Skipped - the issue creation step failed.');
          const updated = await this.issuesService.update(
            testIssueId,
            { status: IssueStatus.IN_PROGRESS } as any,
            { id: testUserId, role: 'user' as any },
          );
          if (updated.status !== IssueStatus.IN_PROGRESS) {
            throw new Error(`Expected status "In Progress", got "${updated.status}".`);
          }
          return 'Backlog -> In Progress transition succeeded for the assignee.';
        }),
      );

      results.push(
        await this.check('feature', 'A regular user cannot skip straight to In Review via update()', async () => {
          if (!testIssueId || !testUserId) throw new Error('Skipped - an earlier step failed.');
          try {
            await this.issuesService.update(
              testIssueId,
              { status: IssueStatus.IN_REVIEW } as any,
              { id: testUserId, role: 'user' as any },
            );
          } catch (err: any) {
            return `Correctly rejected: ${err.message}`;
          }
          throw new Error('Expected this transition to be rejected, but it succeeded.');
        }),
      );

      results.push(
        await this.check('feature', 'Submit for review moves status to In Review', async () => {
          if (!testIssueId || !testUserId) throw new Error('Skipped - an earlier step failed.');
          const updated = await this.issuesService.submitForReview(testIssueId, testUserId, testEmail);
          if (updated.status !== IssueStatus.IN_REVIEW) {
            throw new Error(`Expected status "In Review", got "${updated.status}".`);
          }
          if (!updated.submittedForReviewAt) {
            throw new Error('submittedForReviewAt was not set.');
          }
          return `Submitted for review at ${updated.submittedForReviewAt.toISOString()}.`;
        }),
      );

      results.push(
        await this.check('feature', 'Program Manager rejection sends it back to In Progress', async () => {
          if (!testIssueId) throw new Error('Skipped - an earlier step failed.');
          const updated = await this.issuesService.reject(testIssueId, testUserId, testEmail, 'Needs more detail');
          if (updated.status !== IssueStatus.IN_PROGRESS) {
            throw new Error(`Expected status "In Progress" after rejection, got "${updated.status}".`);
          }
          if (updated.lastRejectionReason !== 'Needs more detail') {
            throw new Error('Rejection reason was not saved.');
          }
          return 'Rejection correctly returned the issue to "In Progress" with a reason recorded.';
        }),
      );

      results.push(
        await this.check('feature', 'Approval completes the workflow and sets Closed On', async () => {
          if (!testIssueId || !testUserId) throw new Error('Skipped - an earlier step failed.');
          // Re-submit after the rejection above, then approve.
          await this.issuesService.submitForReview(testIssueId, testUserId, testEmail);
          const updated = await this.issuesService.approve(testIssueId, testUserId, testEmail);
          if (updated.status !== IssueStatus.COMPLETED) {
            throw new Error(`Expected status "Completed", got "${updated.status}".`);
          }
          if (!updated.closedOn) {
            throw new Error('Issue was approved but closedOn was not populated.');
          }
          return `Approved and completed; closedOn set to ${updated.closedOn.toISOString()}.`;
        }),
      );

      results.push(
        await this.check('feature', 'Issue quality analyzer flags a weak issue', async () => {
          const result = this.issueAnalyzerService.analyze('bug', '');
          if (result.status !== 'invalid') {
            throw new Error(`Expected an empty description to be flagged "invalid", got "${result.status}".`);
          }
          return 'Weak/empty issue content correctly flagged as invalid.';
        }),
      );

      results.push(
        await this.check('feature', 'Issue quality analyzer accepts a well-written issue', async () => {
          const result = this.issueAnalyzerService.analyze(
            'Login button unresponsive on Safari',
            'Steps to reproduce: 1. Open Safari 2. Go to the login page 3. Click "Log in". ' +
              'Expected the login modal to open. Actual: nothing happens. ' +
              'Tested on macOS 14, Safari 17. Screenshot and console error attached.',
          );
          if (result.status !== 'valid') {
            throw new Error(`Expected a well-written issue to be marked "valid", got "${result.status}" (gaps: ${result.gaps.join('; ') || 'none'}).`);
          }
          return 'Well-written issue content correctly marked as valid.';
        }),
      );

      results.push(
        await this.check('feature', 'Daily update submission and scoring', async () => {
          if (!testUserId) throw new Error('Skipped - user registration failed.');
          const update = await this.dailyUpdatesService.create(
            {
              completedText: `${TEST_TAG} Fixed sample bug\nWrote regression test`,
              pendingText: 'Deploy to production',
              blockersText: '',
            } as any,
            testUserId,
            testEmail,
          );
          testDailyUpdateId = update.id;
          if (update.completedTasks.length !== 2) {
            throw new Error(`Expected 2 completed tasks to be parsed, got ${update.completedTasks.length}.`);
          }
          if (typeof update.productivityScore !== 'number') {
            throw new Error('Productivity score was not calculated.');
          }
          return `Daily update saved with productivity score ${update.productivityScore}% and status "${update.status}".`;
        }),
      );
    } finally {
      await this.cleanupTestData({ testUserId, testProjectId, testIssueId, testDailyUpdateId });
    }

    return results;
  }

  // Best-effort cleanup - runs even if a check above failed, and never
  // throws, so a cleanup hiccup can't hide the actual test results.
  private async cleanupTestData(ids: {
    testUserId: number | null;
    testProjectId: number | null;
    testIssueId: number | null;
    testDailyUpdateId: number | null;
  }): Promise<void> {
    const { testUserId, testProjectId, testIssueId, testDailyUpdateId } = ids;
    try {
      if (testDailyUpdateId) await this.dailyUpdatesRepository.delete(testDailyUpdateId);
      if (testIssueId) await this.issuesRepository.delete(testIssueId);
      if (testProjectId) await this.projectsRepository.delete(testProjectId);
      if (testUserId) await this.usersRepository.delete(testUserId);
    } catch (err) {
      this.logger.warn(
        `Regression test cleanup did not fully complete - there may be leftover ${TEST_TAG} records to remove by hand. ${err.message}`,
      );
    }
  }

  // Runs a single named check, timing it and capturing pass/fail + error
  // detail in a consistent shape regardless of what the check does.
  private async check(
    category: 'health' | 'feature',
    name: string,
    fn: () => Promise<string>,
  ): Promise<RegressionCheckResult> {
    const start = Date.now();
    try {
      const details = await fn();
      return { name, category, passed: true, durationMs: Date.now() - start, details };
    } catch (err: any) {
      this.logger.error(`Regression check failed: ${name} - ${err.message}`, err.stack);
      return {
        name,
        category,
        passed: false,
        durationMs: Date.now() - start,
        error: err.message || String(err),
        stack: err.stack,
      };
    }
  }
}
