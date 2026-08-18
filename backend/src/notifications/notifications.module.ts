import { Module } from '@nestjs/common';
import { IssueNotificationsService } from './issue-notifications.service';
import { MailModule } from '../mail/mail.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [MailModule, UsersModule],
  providers: [IssueNotificationsService],
})
export class NotificationsModule {}
