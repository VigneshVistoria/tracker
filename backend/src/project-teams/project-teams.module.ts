import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectTeam } from './project-team.entity';
import { ProjectTeamsService } from './project-teams.service';
import { ProjectTeamsController } from './project-teams.controller';
import { GuardsModule } from '../common/guards.module';
import { AuditModule } from '../audit/audit.module';
import { UsersModule } from '../users/users.module';
import { ProjectsModule } from '../projects/projects.module';

@Module({
  imports: [TypeOrmModule.forFeature([ProjectTeam]), GuardsModule, AuditModule, UsersModule, ProjectsModule],
  controllers: [ProjectTeamsController],
  providers: [ProjectTeamsService],
  exports: [ProjectTeamsService],
})
export class ProjectTeamsModule {}
