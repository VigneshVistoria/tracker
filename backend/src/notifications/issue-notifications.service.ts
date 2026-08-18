import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { MailService } from '../mail/mail.service';
import { UsersService } from '../users/users.service';
import { Issue } from '../issues/issue.entity';

@Injectable()
export class IssueNotificationsService {
  private readonly logger = new Logger(IssueNotificationsService.name);

  constructor(
    private mailService: MailService,
    private usersService: UsersService,
  ) {}

  @OnEvent('issue.assigned')
  async onAssigned({ issue }: { issue: Issue }): Promise<void> {
    if (!issue.assigneeEmail) return;
    await this.mailService.sendToAssignee(
      issue.assigneeEmail,
      `You've been assigned issue #${issue.id}: ${issue.title}`,
      `<p>You've been assigned issue <strong>#${issue.id} - ${escapeHtml(issue.title)}</strong>` +
        (issue.projectName ? ` in project <strong>${escapeHtml(issue.projectName)}</strong>` : '') +
        `.</p>` +
        (issue.description ? `<p>${escapeHtml(issue.description)}</p>` : ''),
    );
  }

  @OnEvent('issue.submittedForReview')
  async onSubmittedForReview({ issue, submittedByEmail }: { issue: Issue; submittedByEmail: string }): Promise<void> {
    const programManager = await this.usersService.findProgramManager();
    if (!programManager) {
      this.logger.debug(
        `Issue #${issue.id} was submitted for review, but no Program Manager is currently designated - ` +
          'set one from User Management to enable this notification.',
      );
      return;
    }
    await this.mailService.sendToAssignee(
      programManager.email,
      `Issue #${issue.id} submitted for your review`,
      `<p>${escapeHtml(submittedByEmail)} submitted issue <strong>#${issue.id} - ${escapeHtml(issue.title)}</strong> for your review.</p>`,
    );
  }

  @OnEvent('issue.approved')
  async onApproved({ issue }: { issue: Issue }): Promise<void> {
    if (!issue.assigneeEmail) return;
    await this.mailService.sendToAssignee(
      issue.assigneeEmail,
      `Issue #${issue.id} approved - marked Completed`,
      `<p>Your issue <strong>#${issue.id} - ${escapeHtml(issue.title)}</strong> has been reviewed and approved. Status: Completed.</p>`,
    );
  }

  @OnEvent('issue.rejected')
  async onRejected({ issue, reason }: { issue: Issue; reason?: string }): Promise<void> {
    if (!issue.assigneeEmail) return;
    await this.mailService.sendToAssignee(
      issue.assigneeEmail,
      `Issue #${issue.id} sent back for more work`,
      `<p>Issue <strong>#${issue.id} - ${escapeHtml(issue.title)}</strong> was sent back for more work.</p>` +
        (reason ? `<p><strong>Reason:</strong> ${escapeHtml(reason)}</p>` : ''),
    );
  }
}

// Minimal escaping so an issue title/description containing HTML-special
// characters can't break the notification email's markup.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
