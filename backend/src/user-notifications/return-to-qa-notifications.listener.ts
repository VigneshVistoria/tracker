import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { UserNotificationsService } from './user-notifications.service';
import { UsersService } from '../users/users.service';
import { TaskReturnToQaSentBackEvent, TaskReturnedToQaEvent } from '../tasks/return-to-qa';

// In-app notifications for Return to QA (see tasks/return-to-qa.ts). Kept
// beside UserNotificationListenersService rather than inside it; same
// rules: never fails the request, no self-notifications (the service
// drops those), reasons cut to 200 characters.
@Injectable()
export class ReturnToQaNotificationsListener {
  private readonly logger = new Logger(ReturnToQaNotificationsListener.name);

  constructor(
    private notifications: UserNotificationsService,
    private usersService: UsersService,
  ) {}

  private async actorName(userId: number, fallback: string, tenantId: number) {
    const actor = await this.usersService.findByIdAndTenant(userId, tenantId);
    return actor?.fullName || actor?.email || fallback;
  }

  private short(text: string | null) {
    if (!text) return null;
    return text.length > 200 ? `${text.slice(0, 197)}...` : text;
  }

  // The QA gets the ticket and the PM's reason; the developer learns it
  // is with QA for now (and that they can't submit it meanwhile).
  @OnEvent('task.returnedToQa')
  async onReturned(e: TaskReturnedToQaEvent) {
    try {
      const actorName = await this.actorName(e.actorUserId, e.actorEmail, e.tenantId);
      const reason = this.short(e.reason);
      const sends = [
        this.notifications.create({
          tenantId: e.tenantId,
          userId: e.qaUserId,
          type: 'task.returnedToQa',
          title: `PM sent #${e.taskId} back to you`,
          body: `${e.title} - ${reason}`,
          link: `/tasks/${e.taskId}`,
          actorUserId: e.actorUserId,
          actorName,
        }),
      ];
      if (e.assigneeUserId) {
        sends.push(
          this.notifications.create({
            tenantId: e.tenantId,
            userId: e.assigneeUserId,
            type: 'task.returnedToQa',
            title: `#${e.taskId} is back with QA for now`,
            body: `${e.title} - ${reason}`,
            link: `/tasks/${e.taskId}`,
            actorUserId: e.actorUserId,
            actorName,
          }),
        );
      }
      await Promise.all(sends);
    } catch (err) {
      this.logger.error(`task.returnedToQa notification failed: ${err}`);
    }
  }

  // QA is done: the developer gets it back, and the PM who returned it
  // hears it is settled.
  @OnEvent('task.returnToQaSentBack')
  async onSentBack(e: TaskReturnToQaSentBackEvent) {
    try {
      const actorName = await this.actorName(e.actorUserId, e.actorEmail, e.tenantId);
      const note = this.short(e.note);
      const body = note ? `${e.title} - ${note}` : e.title;
      const sends: Promise<void>[] = [];
      if (e.assigneeUserId) {
        sends.push(
          this.notifications.create({
            tenantId: e.tenantId,
            userId: e.assigneeUserId,
            type: 'task.returnToQaSentBack',
            title: `#${e.taskId} is back with you`,
            body,
            link: `/tasks/${e.taskId}`,
            actorUserId: e.actorUserId,
            actorName,
          }),
        );
      }
      if (e.pmUserId !== e.assigneeUserId) {
        sends.push(
          this.notifications.create({
            tenantId: e.tenantId,
            userId: e.pmUserId,
            type: 'task.returnToQaSentBack',
            title: `QA sent #${e.taskId} back to the developer`,
            body,
            link: `/tasks/${e.taskId}`,
            actorUserId: e.actorUserId,
            actorName,
          }),
        );
      }
      await Promise.all(sends);
    } catch (err) {
      this.logger.error(`task.returnToQaSentBack notification failed: ${err}`);
    }
  }
}
