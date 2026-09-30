import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { MailService } from '../mail/mail.service';
import { UsersService } from '../users/users.service';
import { TestCase } from '../test-cases/test-case.entity';

// Test case PM review gate - same EventEmitter2 + MailService pattern as
// TaskNotificationsService. One email per action (not per test case), so
// a bulk submit/approve of 50 cases doesn't send 50 emails.
@Injectable()
export class TestCaseNotificationsService {
  private readonly logger = new Logger(TestCaseNotificationsService.name);

  constructor(
    private mailService: MailService,
    private usersService: UsersService,
  ) {}

  // Fired from TestCasesService.submitForReview() - notifies every
  // Program Manager.
  @OnEvent('testCases.submittedForReview')
  async onSubmittedForReview({
    testCases,
    submittedByEmail,
    tenantId,
  }: {
    testCases: TestCase[];
    submittedByEmail: string;
    tenantId: number;
  }): Promise<void> {
    const programManagers = await this.usersService.findProgramManagers(tenantId);
    if (programManagers.length === 0) {
      this.logger.debug(
        `${testCases.length} test case(s) were submitted for review, but no Program Manager is currently assigned - ` +
          'assign that role to someone from User Management to enable this notification.',
      );
      return;
    }

    const subject =
      testCases.length === 1
        ? `Test case ${label(testCases[0])} submitted for your review`
        : `${testCases.length} test cases submitted for your review`;
    const html =
      `<p><strong>${escapeHtml(submittedByEmail)}</strong> submitted the following test case(s) for your review:</p>` +
      caseList(testCases) +
      `<p>Approve or reject them from Test Cases (filter by Pending Review).</p>`;

    await Promise.all(programManagers.map((pm) => this.mailService.sendToAssignee(pm.email, subject, html)));
  }

  // Fired from TestCasesService.decideReview() - notifies whoever
  // submitted each case (grouped, so one email per submitter).
  @OnEvent('testCases.reviewed')
  async onReviewed({
    testCases,
    decision,
    comment,
    reviewedByEmail,
  }: {
    testCases: TestCase[];
    decision: 'approve' | 'reject';
    comment: string | null;
    reviewedByEmail: string;
  }): Promise<void> {
    const bySubmitter = new Map<string, TestCase[]>();
    for (const tc of testCases) {
      if (!tc.submittedForReviewByEmail) continue;
      const list = bySubmitter.get(tc.submittedForReviewByEmail) || [];
      list.push(tc);
      bySubmitter.set(tc.submittedForReviewByEmail, list);
    }

    const outcome = decision === 'approve' ? 'approved - Ready for Execution' : 'rejected';
    await Promise.all(
      [...bySubmitter.entries()].map(([email, cases]) => {
        const subject =
          cases.length === 1
            ? `Test case ${label(cases[0])} ${outcome}`
            : `${cases.length} test cases ${outcome}`;
        const html =
          `<p><strong>${escapeHtml(reviewedByEmail)}</strong> ${outcome} the following test case(s):</p>` +
          caseList(cases) +
          (comment ? `<p><strong>Comment:</strong> ${escapeHtml(comment)}</p>` : '') +
          (decision === 'reject' ? '<p>Update them and submit for review again.</p>' : '');
        return this.mailService.sendToAssignee(email, subject, html);
      }),
    );
  }
}

function label(tc: TestCase): string {
  return tc.caseNumber || `#${tc.id}`;
}

function caseList(testCases: TestCase[]): string {
  return `<ul>${testCases.map((tc) => `<li><strong>${escapeHtml(label(tc))}</strong> - ${escapeHtml(tc.title)}</li>`).join('')}</ul>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
