import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { UserNotificationsService } from './user-notifications.service';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/user.entity';
import { TaskFlagSetEvent } from '../task-flags/task-flags';
import { TaskReopenedEvent } from '../tasks/qa-intake';
import { TaskChasedEvent } from '../task-activity/task-activity';
import { TaskRequestEvent } from '../task-requests/task-requests';
import { TaskHandoverEvent } from '../task-handovers/task-handovers';
import { formatLongDate } from '../tasks/team-export/team-tasks-export';

// In-app notifications for risk and blocker flags (Performance Tracking
// S3, see task-flags/task-flags.ts). In-app only (2026-10-28: SMTP is not
// configured and Teams Graph returns 403). A new blocker goes to its
// blocking owner (a tracker user) and every Program Manager; a new risk to
// every Program Manager. Same rules as the other listeners: never fails
// the request, no self-notifications (the service drops those), reasons
// cut to 200 characters.
@Injectable()
export class TaskFlagsNotificationsListener {
  private readonly logger = new Logger(TaskFlagsNotificationsListener.name);

  constructor(
    private notifications: UserNotificationsService,
    private usersService: UsersService,
  ) {}

  @OnEvent('task.flagSet')
  async onSet(e: TaskFlagSetEvent) {
    try {
      const actor = await this.usersService.findByIdAndTenant(e.actorUserId, e.tenantId);
      const actorName = actor?.fullName || actor?.email || e.actorEmail;
      const pms = await this.usersService.findByRole(UserRole.PROGRAM_MANAGER, e.tenantId);
      const recipients = new Set(pms.map((u) => u.id));
      if (e.kind === 'blocker' && e.blockingOwnerUserId) recipients.add(e.blockingOwnerUserId);
      const reason = e.reason.length > 200 ? `${e.reason.slice(0, 197)}...` : e.reason;
      await Promise.all(
        [...recipients].map((userId) =>
          this.notifications.create({
            tenantId: e.tenantId,
            userId,
            type: e.kind === 'blocker' ? 'task.blockerSet' : 'task.riskSet',
            title:
              e.kind === 'blocker'
                ? userId === e.blockingOwnerUserId
                  ? `${actorName} says #${e.taskId} is blocked waiting on you`
                  : `${actorName} flagged #${e.taskId} as blocked`
                : `${actorName} flagged #${e.taskId} at risk`,
            body: `${e.title} - ${reason}`,
            link: `/tasks/${e.taskId}#flags`,
            actorUserId: e.actorUserId,
            actorName,
          }),
        ),
      );
    } catch (err) {
      this.logger.error(`task.flagSet notification failed: ${err}`);
    }
  }

  // Performance Tracking S4: Reopen after Pass - the assignee (with the new
  // proposed Due date) and the QA who passed it. In-app only.
  @OnEvent('task.reopenedAfterPass')
  async onReopened(e: TaskReopenedEvent) {
    try {
      const actor = await this.usersService.findByIdAndTenant(e.actorUserId, e.tenantId);
      const actorName = actor?.fullName || actor?.email || e.actorEmail;
      const reason = e.reason.length > 200 ? `${e.reason.slice(0, 197)}...` : e.reason;
      const sends: Promise<void>[] = [];
      if (e.assigneeUserId) {
        sends.push(
          this.notifications.create({
            tenantId: e.tenantId,
            userId: e.assigneeUserId,
            type: 'task.reopenedAfterPass',
            title: `${actorName} reopened #${e.taskId} - proposed Due date ${formatLongDate(e.proposedDueDate)}, confirm it or set your own`,
            body: `${e.title} - ${reason}`,
            link: `/tasks/${e.taskId}`,
            actorUserId: e.actorUserId,
            actorName,
          }),
        );
      }
      if (e.passedByQaUserId && e.passedByQaUserId !== e.assigneeUserId) {
        sends.push(
          this.notifications.create({
            tenantId: e.tenantId,
            userId: e.passedByQaUserId,
            type: 'task.reopenedAfterPass',
            title: `${actorName} reopened #${e.taskId}, which you passed`,
            body: `${e.title} - ${reason}`,
            link: `/tasks/${e.taskId}`,
            actorUserId: e.actorUserId,
            actorName,
          }),
        );
      }
      await Promise.all(sends);
    } catch (err) {
      this.logger.error(`task.reopenedAfterPass notification failed: ${err}`);
    }
  }

  // Performance Tracking B1: a Chase goes to the task's assignee. In-app only.
  @OnEvent('task.chased')
  async onChased(e: TaskChasedEvent) {
    try {
      const actor = await this.usersService.findByIdAndTenant(e.actorUserId, e.tenantId);
      const actorName = actor?.fullName || actor?.email || e.actorEmail;
      const note = e.note && e.note.length > 200 ? `${e.note.slice(0, 197)}...` : e.note;
      await this.notifications.create({
        tenantId: e.tenantId,
        userId: e.assigneeUserId,
        type: 'task.chased',
        title: `${actorName} is asking for an update on #${e.taskId}`,
        body: note ? `${e.title} - ${note}` : e.title,
        link: `/tasks/${e.taskId}#activity`,
        actorUserId: e.actorUserId,
        actorName,
      });
    } catch (err) {
      this.logger.error(`task.chased notification failed: ${err}`);
    }
  }

  // Performance Tracking B4: a request goes to the person asked; an answer
  // back to whoever asked. In-app only.
  @OnEvent('task.request')
  async onRequest(e: TaskRequestEvent) {
    try {
      const actor = await this.usersService.findByIdAndTenant(e.actorUserId, e.tenantId);
      const actorName = actor?.fullName || actor?.email || e.actorEmail;
      const text = e.text.length > 200 ? `${e.text.slice(0, 197)}...` : e.text;
      await this.notifications.create({
        tenantId: e.tenantId,
        userId: e.recipientUserId,
        type: e.kind === 'created' ? 'task.requestCreated' : 'task.requestAnswered',
        title: e.kind === 'created' ? `${actorName} has a request for you on #${e.taskId}` : `${actorName} answered your request on #${e.taskId}`,
        body: `${e.title} - ${text}`,
        link: `/tasks/${e.taskId}#requests`,
        actorUserId: e.actorUserId,
        actorName,
      });
    } catch (err) {
      this.logger.error(`task.request notification failed: ${err}`);
    }
  }

  // Performance Tracking C4: a handover goes to the next owner; the
  // decision back to whoever handed it over. In-app only.
  @OnEvent('task.handover')
  async onHandover(e: TaskHandoverEvent) {
    try {
      const actor = await this.usersService.findByIdAndTenant(e.actorUserId, e.tenantId);
      const actorName = actor?.fullName || actor?.email || e.actorEmail;
      const title = {
        started: `${actorName} is handing #${e.taskId} over to you`,
        accepted: `${actorName} accepted your handover of #${e.taskId}`,
        rejected: `${actorName} rejected your handover of #${e.taskId}`,
        cancelled: `${actorName} cancelled the handover of #${e.taskId}`,
      }[e.kind];
      await this.notifications.create({
        tenantId: e.tenantId,
        userId: e.recipientUserId,
        type: `task.handover${e.kind[0].toUpperCase()}${e.kind.slice(1)}`,
        title,
        body: e.kind === 'rejected' && e.reason ? `${e.title} - ${e.reason.length > 200 ? `${e.reason.slice(0, 197)}...` : e.reason}` : e.title,
        link: `/tasks/${e.taskId}#handover`,
        actorUserId: e.actorUserId,
        actorName,
      });
    } catch (err) {
      this.logger.error(`task.handover notification failed: ${err}`);
    }
  }
}
