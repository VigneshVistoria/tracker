import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WeeklyStatusReport } from './weekly-status-report.entity';
import { User } from '../users/user.entity';
import { Project } from '../projects/project.entity';
import { WeeklyStatusService } from './weekly-status.service';
import { WeeklyStatusController } from './weekly-status.controller';
import { UsersModule } from '../users/users.module';
import { AuditModule } from '../audit/audit.module';
import { GuardsModule } from '../common/guards.module';
import { PerformanceTrackingCoreModule } from '../performance-tracking/performance-tracking-core.module';

// Performance Tracking C3 (2026-10-30) - weekly status report.
@Module({
  imports: [TypeOrmModule.forFeature([WeeklyStatusReport, User, Project]), UsersModule, AuditModule, GuardsModule, PerformanceTrackingCoreModule],
  controllers: [WeeklyStatusController],
  providers: [WeeklyStatusService],
})
export class WeeklyStatusModule {}
