import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TaskUatResult } from './task-uat-result.entity';
import { ReleaseSatisfaction } from './release-satisfaction.entity';
import { TaskPriorityTierEvent } from './task-priority-tier-event.entity';
import { Release } from '../release-logs/release.entity';
import { User } from '../users/user.entity';
import { ClientMeasuresService } from './client-measures.service';
import { ClientMeasuresController } from './client-measures.controller';
import { TasksModule } from '../tasks/tasks.module';
import { UsersModule } from '../users/users.module';
import { AuditModule } from '../audit/audit.module';
import { GuardsModule } from '../common/guards.module';
import { PerformanceTrackingCoreModule } from '../performance-tracking/performance-tracking-core.module';

// Performance Tracking L3-L5 (2026-10-30) - client priority tier, UAT results, release satisfaction.
@Module({
  imports: [TypeOrmModule.forFeature([TaskUatResult, ReleaseSatisfaction, TaskPriorityTierEvent, Release, User]), TasksModule, UsersModule, AuditModule, GuardsModule, PerformanceTrackingCoreModule],
  controllers: [ClientMeasuresController],
  providers: [ClientMeasuresService],
})
export class ClientMeasuresModule {}
