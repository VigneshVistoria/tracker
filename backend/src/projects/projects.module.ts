import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Project } from './project.entity';
import { ProjectsService } from './projects.service';
import { ProjectsController } from './projects.controller';
import { GuardsModule } from '../common/guards.module';
import { UsersModule } from '../users/users.module';
import { EventsModule } from '../events/events.module';
import { AuditModule } from '../audit/audit.module';
import { Issue } from '../issues/issue.entity';
import { ProjectModule as ProjectModuleEntity } from '../modules/project-module.entity';
import { Phase } from '../phases/phase.entity';
import { ProjectPlanEntry } from '../project-planning/project-plan-entry.entity';
import { ProjectTeam } from '../project-teams/project-team.entity';
import { Sprint } from '../sprints/sprint.entity';
import { ProjectTask } from '../tasks/project-task.entity';
import { TestCase } from '../test-cases/test-case.entity';
import { TestExecution } from '../test-cases/test-execution.entity';
import { TimeEntry } from '../time-sheets/time-entry.entity';

@Module({
  imports: [
    // Every entity below just registers its repository here (not the
    // owning module) - each of those modules already imports
    // ProjectsModule (to resolve a Project on create), so importing them
    // back would be circular. Needed so ProjectsService.update() can push
    // a rename out to every denormalized projectName copy in one place -
    // see the cascade there.
    TypeOrmModule.forFeature([
      Project,
      Issue,
      ProjectModuleEntity,
      Phase,
      ProjectPlanEntry,
      ProjectTeam,
      Sprint,
      ProjectTask,
      TestCase,
      TestExecution,
      TimeEntry,
    ]),
    GuardsModule,
    UsersModule,
    EventsModule,
    AuditModule,
  ],
  controllers: [ProjectsController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
