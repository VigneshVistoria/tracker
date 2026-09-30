import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Release } from './release.entity';
import { ReleaseItem } from './release-item.entity';
import { ReleaseLogsService } from './release-logs.service';
import { ReleaseLogsController } from './release-logs.controller';
import { PdfReleaseService } from './pdf-release.service';
import { ProjectTask } from '../tasks/project-task.entity';
import { TaskQaReview } from '../task-qa-reviews/task-qa-review.entity';
import { GuardsModule } from '../common/guards.module';
import { AuditModule } from '../audit/audit.module';
import { UsersModule } from '../users/users.module';
import { ProjectsModule } from '../projects/projects.module';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Release, ReleaseItem, ProjectTask, TaskQaReview]),
    GuardsModule,
    AuditModule,
    UsersModule,
    ProjectsModule,
    MailModule,
  ],
  controllers: [ReleaseLogsController],
  providers: [ReleaseLogsService, PdfReleaseService],
})
export class ReleaseLogsModule {}
