import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { MailService } from '../mail/mail.service';
import { UsersService } from '../users/users.service';
import { ProjectTask } from '../tasks/project-task.entity';

// First notification wired up for the Tasks module - same EventEmitter2 +
// MailService.sendToAssignee pattern IssueNotificationsService already
// uses for Issues (e.g. issue.submittedForReview), just not used for
// Tasks until now.
@Injectable()
export class TaskNotificationsService {
  private readonly logger = new Logger(TaskNotificationsService.name);

  constructor(
    private mailService: MailService,
    private usersService: UsersService,
  ) {}

  // Fired from TaskQaReviewsService.escalate() - notifies every Program
  // Manager, same "notify all PMs" pattern issue.submittedForReview uses
  // (Program Manager is a normal, possibly-multi-holder role, not a
  // singleton).
  @OnEvent('task.escalatedToPm')
  async onEscalatedToPm({
    task,
    escalatedByEmail,
    comment,
  }: {
    task: ProjectTask;
    escalatedByEmail: string;
    comment: string;
  }): Promise<void> {
    const programManagers = await this.usersService.findProgramManagers(task.tenantId);
    if (programManagers.length === 0) {
      this.logger.debug(
        `Task #${task.id} was escalated to PM, but no Program Manager is currently assigned - ` +
          'assign that role to someone from User Management to enable this notification.',
      );
      return;
    }

    const subject = `Task #${task.id} escalated to you for review`;
    const html =
      `<p><strong>${escapeHtml(escalatedByEmail)}</strong> escalated task <strong>#${task.id} - ${escapeHtml(task.description)}</strong>` +
      ` in project <strong>${escapeHtml(task.projectName)}</strong> instead of approving or rejecting it.</p>` +
      `<p><strong>Reason:</strong> ${escapeHtml(comment)}</p>` +
      `<p>Reassign it to a developer or close it as Junk from the Escalations queue.</p>`;

    await Promise.all(
      programManagers.map((pm) => this.mailService.sendToAssignee(pm.email, subject, html)),
    );
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
