import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectTask } from '../tasks/project-task.entity';
import { TaskBlockingDefect } from '../tasks/task-blocking-defect.entity';
import { TaskDependencyTicket } from '../task-dependency-tickets/task-dependency-ticket.entity';
import { TaskQaReview } from '../task-qa-reviews/task-qa-review.entity';
import { AuditLog } from '../audit/audit-log.entity';
import { TestExecution } from '../test-cases/test-execution.entity';
import { UsersModule } from '../users/users.module';
import { GuardsModule } from '../common/guards.module';
import { AuditModule } from '../audit/audit.module';
import { TeamSettings } from '../team-settings/team-settings.entity';
import { DailyScrumController } from './daily-scrum.controller';
import { DailyScrumService } from './daily-scrum.service';
import { ExternalWaitsService } from './external-waits.service';
import { ScrumExternalWait } from './scrum-external-wait.entity';

// Daily Scrum (Stage 1, 2026-10-12) - additive: its own table
// (team_settings) and read-only use of the existing ones. Stage 3 adds
// scrum_external_waits ("Waiting on the city office").
@Module({
  imports: [
    TypeOrmModule.forFeature([TeamSettings, ScrumExternalWait, ProjectTask, TaskBlockingDefect, TaskDependencyTicket, TaskQaReview, AuditLog, TestExecution]),
    UsersModule,
    GuardsModule,
    AuditModule,
  ],
  controllers: [DailyScrumController],
  providers: [DailyScrumService, ExternalWaitsService],
})
export class DailyScrumModule {}
