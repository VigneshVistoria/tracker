import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectTimelineRow } from './project-timeline-row.entity';
import { ProjectTimelineTeam } from './project-timeline-team.entity';
import { ProjectTimelineDependency } from './project-timeline-dependency.entity';
import { ProjectTimelineTicketLink } from './project-timeline-ticket-link.entity';
import { ProjectTask } from '../tasks/project-task.entity';
import { ProjectModule } from '../modules/project-module.entity';
import { Phase } from '../phases/phase.entity';
import { TaskStatusConfigModule } from '../task-status-config/task-status-config.module';
import { ProjectTimelineService } from './project-timeline.service';
import { ProjectTimelineController } from './project-timeline.controller';
import { Project } from '../projects/project.entity';
import { TeamSettings } from '../team-settings/team-settings.entity';
import { GuardsModule } from '../common/guards.module';
import { AuditModule } from '../audit/audit.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [TypeOrmModule.forFeature([ProjectTimelineRow, ProjectTimelineTeam, ProjectTimelineDependency, ProjectTimelineTicketLink, ProjectTask, ProjectModule, Phase, Project, TeamSettings]), GuardsModule, AuditModule, UsersModule, TaskStatusConfigModule],
  controllers: [ProjectTimelineController],
  providers: [ProjectTimelineService],
})
export class ProjectTimelineModule {}
