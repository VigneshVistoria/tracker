import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KpiConfig } from './kpi-config.entity';
import { KpiPeriodScore } from './kpi-period-score.entity';
import { ProjectTask } from '../tasks/project-task.entity';
import { TaskQaReview } from '../task-qa-reviews/task-qa-review.entity';
import { TaskDependencyTicket } from '../task-dependency-tickets/task-dependency-ticket.entity';
import { KpiService } from './kpi.service';
import { KpiController } from './kpi.controller';
import { KpiConfigController } from './kpi-config.controller';
import { KpiSchedulerService } from './kpi-scheduler.service';
import { GuardsModule } from '../common/guards.module';
import { AuditModule } from '../audit/audit.module';
import { UsersModule } from '../users/users.module';
import { TenantsModule } from '../tenants/tenants.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([KpiConfig, KpiPeriodScore, ProjectTask, TaskQaReview, TaskDependencyTicket]),
    GuardsModule,
    AuditModule,
    UsersModule,
    TenantsModule,
  ],
  controllers: [KpiController, KpiConfigController],
  providers: [KpiService, KpiSchedulerService],
  exports: [KpiService],
})
export class KpiModule {}
