import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Issue } from '../issues/issue.entity';
import { User } from '../users/user.entity';
import { MailModule } from '../mail/mail.module';
import { WeeklyReportService } from './weekly-report.service';

@Module({
  imports: [TypeOrmModule.forFeature([Issue, User]), MailModule],
  providers: [WeeklyReportService],
  exports: [WeeklyReportService],
})
export class WeeklyReportModule {}
