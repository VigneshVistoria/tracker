import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WeeklyReport } from './weekly-report.entity';
import { Issue } from '../issues/issue.entity';
import { WeeklyReportsService } from './weekly-reports.service';
import { WeeklyReportsController } from './weekly-reports.controller';
import { WeeklyReportSchedulerService } from './weekly-report-scheduler.service';
import { PerformanceReportSchedulerService } from './performance-report-scheduler.service';
import { PdfPerformanceReportService } from './pdf-performance-report.service';
import { GuardsModule } from '../common/guards.module';
import { MailModule } from '../mail/mail.module';
import { UsersModule } from '../users/users.module';
import { TenantsModule } from '../tenants/tenants.module';

@Module({
  imports: [TypeOrmModule.forFeature([WeeklyReport, Issue]), GuardsModule, MailModule, UsersModule, TenantsModule],
  controllers: [WeeklyReportsController],
  providers: [
    WeeklyReportsService,
    WeeklyReportSchedulerService,
    PerformanceReportSchedulerService,
    PdfPerformanceReportService,
  ],
})
export class ReportsModule {}
