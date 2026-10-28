import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { UserNotificationsService } from './user-notifications.service';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/user.entity';
import { TaskFlagSetEvent } from '../task-flags/task-flags';

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
}
