import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectTask } from './project-task.entity';
import { TaskDefectArtifact } from './task-defect-artifact.entity';
import { TaskBlockingDefect } from './task-blocking-defect.entity';
import { TaskAttachment } from './task-attachment.entity';
import { TaskQaReviewAttachment } from './task-qa-review-attachment.entity';
import { QaReviewAttachmentsService } from './qa-review-attachments.service';
import { TaskDependencyTicket } from '../task-dependency-tickets/task-dependency-ticket.entity';
import { TaskQaReview } from '../task-qa-reviews/task-qa-review.entity';
import { ProjectModule as ProjectModuleEntity } from '../modules/project-module.entity';
import { Phase } from '../phases/phase.entity';
import { TeamSettings } from '../team-settings/team-settings.entity';
import { TasksService } from './tasks.service';
import { QaSummaryService } from './qa-summary.service';
import { TasksController } from './tasks.controller';
import { TaskAttachmentsController } from './task-attachments.controller';
import { TaskAttachmentsService } from './task-attachments.service';
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
import { StorageModule } from '../storage/storage.module';
import { ReturnToQaController } from './return-to-qa.controller';
import { ReturnToQaService } from './return-to-qa.service';
import { DefectTriage } from './defect-triage.entity';
import { DefectTriageController } from './defect-triage.controller';
import { DefectTriageService } from './defect-triage.service';
import { TeamTasksExportService } from './team-export/team-tasks-export.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ProjectTask, TaskDependencyTicket, TaskQaReview, TaskDefectArtifact, TaskBlockingDefect, TaskAttachment, TaskQaReviewAttachment, ProjectModuleEntity, Phase, TeamSettings, DefectTriage]),
    ProjectsModule,
    ModulesModule,
    PhasesModule,
    TaskStatusConfigModule,
    GuardsModule,
    AuditModule,
    UsersModule,
    StorageModule,
  ],
  // TasksBulkController registered first - it owns the more specific
  // `bulk-export`/`bulk-import`/`bulk-import-template` routes under the
  // shared `tasks` prefix, and must be matched before TasksController's
  // `:id` catch-all below (same ordering precedent as IssuesModule).
  // TaskAttachmentsController (defect screenshots) likewise goes first.
  // ReturnToQaController likewise ('returned-to-qa' vs ':id').
  // DefectTriageController has its own 'defect-triage' prefix.
  controllers: [TasksBulkController, TaskAttachmentsController, ReturnToQaController, DefectTriageController, TasksController],
  providers: [TasksService, TeamTasksExportService, TasksBulkService, TaskSpreadsheetService, TaskAttachmentsService, QaSummaryService, ReturnToQaService, QaReviewAttachmentsService, DefectTriageService],
  exports: [TasksService],
})
export class TasksModule {}
