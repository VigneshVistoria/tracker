import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectTask } from '../tasks/project-task.entity';
import { TaskQaReview } from '../task-qa-reviews/task-qa-review.entity';
import { UsersModule } from '../users/users.module';
import { GuardsModule } from '../common/guards.module';
import { AuditModule } from '../audit/audit.module';
import { TaskCommitmentEvent } from './task-commitment-event.entity';
import { PerformanceMetricSettings } from './performance-metric-settings.entity';
import { PerformanceHoliday } from './performance-holiday.entity';
import { PerformanceMetricsService } from './performance-metrics.service';
import { PerformanceMetricsController } from './performance-metrics.controller';

// The events themselves are written by AuditLogService (AuditModule), not
// here - see ./commitment-events.ts. Exported for the Non-Compliance PDF.
@Module({
  imports: [
    TypeOrmModule.forFeature([TaskCommitmentEvent, PerformanceMetricSettings, PerformanceHoliday, ProjectTask, TaskQaReview]),
    UsersModule,
    GuardsModule,
    AuditModule,
  ],
  controllers: [PerformanceMetricsController],
  providers: [PerformanceMetricsService],
  exports: [PerformanceMetricsService],
})
export class PerformanceMetricsModule {}
