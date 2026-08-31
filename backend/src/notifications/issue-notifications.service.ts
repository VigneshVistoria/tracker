import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { MailService } from '../mail/mail.service';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/user.entity';
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

  // Fires once per false -> true showstopper transition (see
  // IssuesService.handleShowstopperFlagged) - notifies every Program
  // Manager plus the assignee (if one's set) with the SLA deadline
  // resolved from the Showstopper target configured on the SLA
  // Configuration page. Fires regardless of what the classification
  // heuristic concluded - the point is making sure a claimed showstopper
  // gets seen fast, independent of whether it turns out to be legitimate.
  @OnEvent('issue.showstopperFlagged')
  async onShowstopperFlagged({
    issue,
    slaTargetHours,
    dueAt,
  }: {
    issue: Issue;
    slaTargetHours: number;
    dueAt: string;
  }): Promise<void> {
    const programManagers = await this.usersService.findProgramManagers(issue.tenantId);
    const recipientEmails = new Set(programManagers.map((pm) => pm.email));
    if (issue.assigneeEmail) recipientEmails.add(issue.assigneeEmail);

    if (recipientEmails.size === 0) {
      this.logger.debug(
        `Issue #${issue.id} was flagged as a Showstopper, but there's no Program Manager or assignee to notify.`,
      );
      return;
    }

    const dueAtFormatted = new Date(dueAt).toLocaleString();
    const subject = `SHOWSTOPPER: #${issue.id} must be resolved within ${slaTargetHours}h`;
    const html =
      `<p><strong>#${issue.id} - ${escapeHtml(issue.title)}</strong> was just marked a Showstopper` +
      (issue.projectName ? ` in project <strong>${escapeHtml(issue.projectName)}</strong>` : '') +
      `.</p>` +
      `<p>This must be resolved within <strong>${slaTargetHours} hours</strong> - by <strong>${dueAtFormatted}</strong>.</p>` +
      (issue.description ? `<p>${escapeHtml(issue.description)}</p>` : '');

    await Promise.all(
      Array.from(recipientEmails).map((email) => this.mailService.sendToAssignee(email, subject, html)),
    );
  }

  // Fires from SlaDueSoonSchedulerService's recurring poll, at most once per
  // issue (dedupe tracked via Issue.slaDueSoonNotifiedAt) - notifies every
  // Program Manager plus the assignee, same recipient list as the
  // showstopper-flagged email above.
  @OnEvent('issue.slaDueSoon')
  async onSlaDueSoon({
    issue,
    dueAt,
  }: {
    issue: Issue;
    dueAt: string;
    targetHours: number;
  }): Promise<void> {
    const programManagers = await this.usersService.findProgramManagers(issue.tenantId);
    const recipientEmails = new Set(programManagers.map((pm) => pm.email));
    if (issue.assigneeEmail) recipientEmails.add(issue.assigneeEmail);

    if (recipientEmails.size === 0) {
      this.logger.debug(
        `Issue #${issue.id} is due within the hour, but there's no Program Manager or assignee to notify.`,
      );
      return;
    }

    const dueAtFormatted = new Date(dueAt).toLocaleString();
    const subject = `Due soon: #${issue.id} is due within the hour`;
    const html =
      `<p><strong>#${issue.id} - ${escapeHtml(issue.title)}</strong>` +
      (issue.projectName ? ` in project <strong>${escapeHtml(issue.projectName)}</strong>` : '') +
      ` is due within the hour - by <strong>${dueAtFormatted}</strong>.</p>` +
      (issue.description ? `<p>${escapeHtml(issue.description)}</p>` : '');

    await Promise.all(
      Array.from(recipientEmails).map((email) => this.mailService.sendToAssignee(email, subject, html)),
    );
  }

  @OnEvent('issue.submittedForReview')
  async onSubmittedForReview({ issue, submittedByEmail }: { issue: Issue; submittedByEmail: string }): Promise<void> {
    // Program Manager is a normal role now (ReleaseBot, 2026-08-22), so
    // more than one person can hold it - notify all of them rather than
    // a single designated person.
    const programManagers = await this.usersService.findProgramManagers(issue.tenantId);
    if (programManagers.length === 0) {
      this.logger.debug(
        `Issue #${issue.id} was submitted for review, but no Program Manager is currently assigned - ` +
          'assign that role to someone from User Management to enable this notification.',
      );
      return;
    }
    await Promise.all(
      programManagers.map((programManager) =>
        this.mailService.sendToAssignee(
          programManager.email,
          `Issue #${issue.id} submitted for your review`,
          `<p>${escapeHtml(submittedByEmail)} submitted issue <strong>#${issue.id} - ${escapeHtml(issue.title)}</strong> for your review.</p>`,
        ),
      ),
    );
  }

  @OnEvent('issue.approved')
  async onApproved({ issue }: { issue: Issue }): Promise<void> {
    if (issue.assigneeEmail) {
      await this.mailService.sendToAssignee(
        issue.assigneeEmail,
        `Issue #${issue.id} approved for QA testing`,
        `<p>Your issue <strong>#${issue.id} - ${escapeHtml(issue.title)}</strong> was reviewed and approved by the Program Manager, and is now with QA for testing.</p>`,
      );
    }

    const qaUsers = await this.usersService.findByRole(UserRole.QA, issue.tenantId);
    if (qaUsers.length === 0) {
      this.logger.debug(
        `Issue #${issue.id} was approved for QA testing, but no QA user exists to notify - ` +
          'assign the QA role to someone from User Management to enable this notification.',
      );
      return;
    }
    await Promise.all(
      qaUsers.map((qaUser) =>
        this.mailService.sendToAssignee(
          qaUser.email,
          `Issue #${issue.id} is ready for QA testing`,
          `<p>Issue <strong>#${issue.id} - ${escapeHtml(issue.title)}</strong> was approved by the Program Manager and is ready for you to test.</p>`,
        ),
      ),
    );
  }

  @OnEvent('issue.qaApproved')
  async onQaApproved({ issue }: { issue: Issue }): Promise<void> {
    if (!issue.assigneeEmail) return;
    await this.mailService.sendToAssignee(
      issue.assigneeEmail,
      `Issue #${issue.id} passed QA - Ready for Production`,
      `<p>Your issue <strong>#${issue.id} - ${escapeHtml(issue.title)}</strong> passed QA testing and is now marked Ready for Production.</p>`,
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

  @OnEvent('issue.qaRejected')
  async onQaRejected({ issue, reason }: { issue: Issue; reason?: string }): Promise<void> {
    if (!issue.assigneeEmail) return;
    await this.mailService.sendToAssignee(
      issue.assigneeEmail,
      `Issue #${issue.id} failed QA testing`,
      `<p>Issue <strong>#${issue.id} - ${escapeHtml(issue.title)}</strong> failed QA testing and needs more work. ` +
        `Move it back to "In Progress" once you're ready to start fixing it.</p>` +
        (reason ? `<p><strong>Reason:</strong> ${escapeHtml(reason)}</p>` : ''),
    );
  }

  // Section 34: an Executive/Program Manager-filed ticket is a Leadership
  // Request - notify every QA-role user. sendToAssignee() already cc's
  // every configured executive, which doubles as the "+ stakeholders"
  // half of this requirement without needing a separate stakeholder list.
  @OnEvent('issue.leadershipRequestCreated')
  async onLeadershipRequestCreated({ issue }: { issue: Issue }): Promise<void> {
    const qaUsers = await this.usersService.findByRole(UserRole.QA, issue.tenantId);
    if (qaUsers.length === 0) {
      this.logger.debug(
        `Leadership Request issue #${issue.id} was created, but no QA user exists to notify - ` +
          'assign the QA role to someone from User Management to enable this notification.',
      );
      return;
    }
    await Promise.all(
      qaUsers.map((qaUser) =>
        this.mailService.sendToAssignee(
          qaUser.email,
          `Leadership Request: new High-priority ticket #${issue.id}`,
          `<p>A new ticket was filed as a <strong>Leadership Request</strong> and has been auto-set to ` +
            `<strong>High priority</strong>: <strong>#${issue.id} - ${escapeHtml(issue.title)}</strong>` +
            (issue.createdByEmail ? ` (filed by ${escapeHtml(issue.createdByEmail)})` : '') +
            `.</p>` +
            (issue.description ? `<p>${escapeHtml(issue.description)}</p>` : ''),
        ),
      ),
    );
  }

  // Section 3: a blocked ticket-creation attempt (Developer role) is
  // logged to the AuditLog by IssuesService already - this notifies every
  // Administrator so it doesn't go unnoticed.
  @OnEvent('issue.creationBlocked')
  async onCreationBlocked({
    attemptedByEmail,
    attemptedByRole,
    attemptedTitle,
    tenantId,
  }: {
    attemptedByEmail: string;
    attemptedByRole: string;
    attemptedTitle: string;
    tenantId: number;
  }): Promise<void> {
    const admins = await this.usersService.findByRole(UserRole.ADMIN, tenantId);
    if (admins.length === 0) {
      this.logger.warn('A blocked ticket-creation attempt occurred, but no Administrator exists to notify.');
      return;
    }
    await Promise.all(
      admins.map((admin) =>
        this.mailService.sendToAssignee(
          admin.email,
          `Blocked ticket-creation attempt by ${attemptedByEmail}`,
          `<p><strong>${escapeHtml(attemptedByEmail)}</strong> (role: ${escapeHtml(attemptedByRole)}) attempted to create ` +
            `a ticket titled <strong>"${escapeHtml(attemptedTitle)}"</strong>, but that role is not permitted to create ` +
            `tickets directly. Logged to the audit trail.</p>`,
        ),
      ),
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
