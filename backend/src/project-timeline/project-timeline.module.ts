import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectTimelineRow } from './project-timeline-row.entity';
import { ProjectTimelineTeam } from './project-timeline-team.entity';
import { ProjectTimelineService } from './project-timeline.service';
import { ProjectTimelineController } from './project-timeline.controller';
import { Project } from '../projects/project.entity';
import { TeamSettings } from '../team-settings/team-settings.entity';
import { GuardsModule } from '../common/guards.module';
import { AuditModule } from '../audit/audit.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [TypeOrmModule.forFeature([ProjectTimelineRow, ProjectTimelineTeam, Project, TeamSettings]), GuardsModule, AuditModule, UsersModule],
  controllers: [ProjectTimelineController],
  providers: [ProjectTimelineService],
})
export class ProjectTimelineModule {}
