import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectModule } from './project-module.entity';
import { Issue } from '../issues/issue.entity';
import { ProjectPlanEntry } from '../project-planning/project-plan-entry.entity';
import { ProjectTask } from '../tasks/project-task.entity';
import { Phase } from '../phases/phase.entity';
import { ModulesService } from './modules.service';
import { ModulesController } from './modules.controller';
import { GuardsModule } from '../common/guards.module';
import { UsersModule } from '../users/users.module';
import { ProjectsModule } from '../projects/projects.module';
import { EventsModule } from '../events/events.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    // Phase entity only, not PhasesModule - PhasesModule already imports
    // ModulesModule (to resolve a Module when creating a Phase), so
    // importing PhasesModule back here would be circular. Registering
    // just the entity gives this module its own Phase repository without
    // that cycle - same technique already used for ProjectTask above.
    TypeOrmModule.forFeature([ProjectModule, Issue, ProjectPlanEntry, ProjectTask, Phase]),
    GuardsModule,
    UsersModule,
    ProjectsModule,
    EventsModule,
    AuditModule,
  ],
  controllers: [ModulesController],
  providers: [ModulesService],
  exports: [ModulesService],
})
export class ModulesModule {}
