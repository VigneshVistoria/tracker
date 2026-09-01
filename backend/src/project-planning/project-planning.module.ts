import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectPlanEntry } from './project-plan-entry.entity';
import { ProjectPlanningService } from './project-planning.service';
import { ProjectPlanningController } from './project-planning.controller';
import { Issue } from '../issues/issue.entity';
import { ProjectsModule } from '../projects/projects.module';
import { GuardsModule } from '../common/guards.module';
import { AuditModule } from '../audit/audit.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ProjectPlanEntry, Issue]),
    ProjectsModule,
    GuardsModule,
    AuditModule,
    UsersModule,
  ],
  controllers: [ProjectPlanningController],
  providers: [ProjectPlanningService],
  exports: [ProjectPlanningService],
})
export class ProjectPlanningModule {}
