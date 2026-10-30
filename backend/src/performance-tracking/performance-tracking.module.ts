import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Project } from '../projects/project.entity';
import { User } from '../users/user.entity';
import { UsersModule } from '../users/users.module';
import { GuardsModule } from '../common/guards.module';
import { AuditModule } from '../audit/audit.module';
import { PerformanceTrackingCoreModule } from './performance-tracking-core.module';
import { WorkCalendarModule } from '../work-calendar/work-calendar.module';
import { PerformanceTrackingController } from './performance-tracking.controller';
import { PerformanceMetricSnapshot } from './metrics/performance-metric-snapshot.entity';
import { PerformanceMetricRun } from './metrics/performance-metric-run.entity';
import { TrackingMetricsService } from './metrics/tracking-metrics.service';
import { PerformanceScoreOverride } from './scorecard/performance-score-override.entity';
import { ScorecardService } from './scorecard/scorecard.service';
import { ScorecardController } from './scorecard/scorecard.controller';
import { ScorecardFeedController } from './scorecard/scorecard-feed.controller';
import { PerformanceMetricsModule } from '../performance-metrics/performance-metrics.module';
import { TenantsModule } from '../tenants/tenants.module';

// Performance Tracking, Wave 1 (2026-10-28). task_status_events is written
// by database triggers, not here - see ./task-status-event.entity.ts.
// B2: the nightly metrics snapshot (./metrics/). B3: scorecard (./scorecard/).
// B4: the settings service lives in PerformanceTrackingCoreModule.
@Module({
  imports: [
    TypeOrmModule.forFeature([Project, User, PerformanceMetricSnapshot, PerformanceMetricRun, PerformanceScoreOverride]),
    PerformanceTrackingCoreModule,
    WorkCalendarModule,
    UsersModule,
    GuardsModule,
    AuditModule,
    PerformanceMetricsModule,
    TenantsModule,
  ],
  controllers: [PerformanceTrackingController, ScorecardController, ScorecardFeedController],
  providers: [TrackingMetricsService, ScorecardService],
  // Settings service for TaskActivityModule and the rest.
  exports: [PerformanceTrackingCoreModule],
})
export class PerformanceTrackingModule {}
