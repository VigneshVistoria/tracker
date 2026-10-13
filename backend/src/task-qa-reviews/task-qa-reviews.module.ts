import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TaskQaReview } from './task-qa-review.entity';
import { TaskQaReviewArtifact } from './task-qa-review-artifact.entity';
import { TaskQaReviewQaArtifact } from './task-qa-review-qa-artifact.entity';
import { TaskQaReviewsService } from './task-qa-reviews.service';
import { TaskQaReviewsController } from './task-qa-reviews.controller';
import { PmReviewsService } from './pm-reviews.service';
import { PmReviewsController } from './pm-reviews.controller';
import { ProjectTask } from '../tasks/project-task.entity';
import { Project } from '../projects/project.entity';
import { TasksModule } from '../tasks/tasks.module';
import { UsersModule } from '../users/users.module';
import { AuditModule } from '../audit/audit.module';
import { GuardsModule } from '../common/guards.module';
import { NoteQualityModule } from '../note-quality/note-quality.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([TaskQaReview, TaskQaReviewArtifact, TaskQaReviewQaArtifact, ProjectTask, Project]),
    TasksModule,
    UsersModule,
    AuditModule,
    GuardsModule,
    NoteQualityModule,
  ],
  controllers: [TaskQaReviewsController, PmReviewsController],
  providers: [TaskQaReviewsService, PmReviewsService],
  exports: [TaskQaReviewsService],
})
export class TaskQaReviewsModule {}
