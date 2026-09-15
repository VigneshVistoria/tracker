import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectTask } from './project-task.entity';
import { TaskDefectArtifact } from './task-defect-artifact.entity';
import { TaskDependencyTicket } from '../task-dependency-tickets/task-dependency-ticket.entity';
import { TaskQaReview } from '../task-qa-reviews/task-qa-review.entity';
import { ProjectModule as ProjectModuleEntity } from '../modules/project-module.entity';
import { Phase } from '../phases/phase.entity';
import { TasksService } from './tasks.service';
import { TasksController } from './tasks.controller';
import { TasksBulkController } from './tasks-bulk.controller';
import { TasksBulkService } from './tasks-bulk.service';
import { TaskSpreadsheetService } from './spreadsheet/task-spreadsheet.service';
import { ProjectsModule } from '../projects/projects.module';
import { ModulesModule } from '../modules/modules.module';
import { PhasesModule } from '../phases/phases.module';
import { TaskStatusConfigModule } from '../task-status-config/task-status-config.module';
import { GuardsModule } from '../common/guards.module';
import { AuditModule } from '../audit/audit.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ProjectTask, TaskDependencyTicket, TaskQaReview, TaskDefectArtifact, ProjectModuleEntity, Phase]),
    ProjectsModule,
    ModulesModule,
    PhasesModule,
    TaskStatusConfigModule,
    GuardsModule,
    AuditModule,
    UsersModule,
  ],
  // TasksBulkController registered first - it owns the more specific
  // `bulk-export`/`bulk-import`/`bulk-import-template` routes under the
  // shared `tasks` prefix, and must be matched before TasksController's
  // `:id` catch-all below (same ordering precedent as IssuesModule).
  controllers: [TasksBulkController, TasksController],
  providers: [TasksService, TasksBulkService, TaskSpreadsheetService],
  exports: [TasksService],
})
export class TasksModule {}
