import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron } from '@nestjs/schedule';
import { IsNull, LessThan, Repository } from 'typeorm';
import { UserNotification } from './user-notification.entity';
import { EventsGateway } from '../events/events.gateway';

const RETENTION_DAYS = 90;
const MAX_LIST = 50;

export interface CreateUserNotificationInput {
  tenantId: number;
  userId: number;
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
  actorUserId?: number | null;
  actorName?: string | null;
}

@Injectable()
export class UserNotificationsService {
  private readonly logger = new Logger(UserNotificationsService.name);

  constructor(
    @InjectRepository(UserNotification)
    private notificationsRepository: Repository<UserNotification>,
    private eventsGateway: EventsGateway,
  ) {}

  // Never throws - a notification is a side effect of some other action
  // and must never fail it.
  async create(input: CreateUserNotificationInput): Promise<void> {
    try {
      if (input.actorUserId && input.actorUserId === input.userId) return; // no self-notifications
      const saved = await this.notificationsRepository.save(
        this.notificationsRepository.create({
          tenantId: input.tenantId,
          userId: input.userId,
          type: input.type,
          title: input.title.slice(0, 300),
          body: input.body ?? null,
          link: input.link ?? null,
          actorUserId: input.actorUserId ?? null,
          actorName: input.actorName ?? null,
        }),
      );
      this.eventsGateway.emitToUser(saved.userId, 'notification:new', saved);
    } catch (err) {
      this.logger.error(`Failed to create ${input.type} notification for user #${input.userId}: ${err}`);
    }
  }

  findForUser(userId: number, tenantId: number, limit = 30): Promise<UserNotification[]> {
    return this.notificationsRepository.find({
      where: { userId, tenantId },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: Math.min(Math.max(limit, 1), MAX_LIST),
    });
  }

  countUnread(userId: number, tenantId: number): Promise<number> {
    return this.notificationsRepository.count({ where: { userId, tenantId, readAt: IsNull() } });
  }

  async markRead(id: number, userId: number, tenantId: number): Promise<UserNotification> {
    const notification = await this.notificationsRepository.findOne({ where: { id, userId, tenantId } });
    if (!notification) throw new NotFoundException(`Notification #${id} not found`);
    if (!notification.readAt) {
      notification.readAt = new Date();
      await this.notificationsRepository.save(notification);
    }
    return notification;
  }

  async markAllRead(userId: number, tenantId: number): Promise<{ updated: number }> {
    const result = await this.notificationsRepository.update({ userId, tenantId, readAt: IsNull() }, { readAt: new Date() });
    return { updated: result.affected ?? 0 };
  }

  @Cron('30 3 * * *')
  async pruneOld(): Promise<void> {
    try {
      const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
      const result = await this.notificationsRepository.delete({ createdAt: LessThan(cutoff) });
      if (result.affected) this.logger.log(`Pruned ${result.affected} notifications older than ${RETENTION_DAYS} days`);
    } catch (err) {
      this.logger.error(`Notification prune failed: ${err}`);
    }
  }
}
