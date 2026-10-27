import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TaskQaReview } from './task-qa-review.entity';
import { TaskQaReviewArtifact } from './task-qa-review-artifact.entity';
import { TaskQaReviewQaArtifact } from './task-qa-review-qa-artifact.entity';
import { TaskQaReviewsService } from './task-qa-reviews.service';
import { QaReviewSettingsController, TaskQaReviewsController } from './task-qa-reviews.controller';
import { PmReviewsService } from './pm-reviews.service';
import { PmReviewsController } from './pm-reviews.controller';
import { PmReviewReminderService } from './pm-review-reminder.service';
import { TeamSettings } from '../team-settings/team-settings.entity';
import { TenantsModule } from '../tenants/tenants.module';
import { ProjectTask } from '../tasks/project-task.entity';
import { Project } from '../projects/project.entity';
import { TasksModule } from '../tasks/tasks.module';
import { UsersModule } from '../users/users.module';
import { AuditModule } from '../audit/audit.module';
import { GuardsModule } from '../common/guards.module';
import { NoteQualityModule } from '../note-quality/note-quality.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([TaskQaReview, TaskQaReviewArtifact, TaskQaReviewQaArtifact, ProjectTask, Project, TeamSettings]),
    TenantsModule,
    TasksModule,
    UsersModule,
    AuditModule,
    GuardsModule,
    NoteQualityModule,
  ],
  controllers: [TaskQaReviewsController, QaReviewSettingsController, PmReviewsController],
  providers: [TaskQaReviewsService, PmReviewsService, PmReviewReminderService],
  exports: [TaskQaReviewsService],
})
export class TaskQaReviewsModule {}
