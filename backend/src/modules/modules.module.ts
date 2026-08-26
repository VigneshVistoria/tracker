import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectModule } from './project-module.entity';
import { Issue } from '../issues/issue.entity';
import { ModulesService } from './modules.service';
import { ModulesController } from './modules.controller';
import { GuardsModule } from '../common/guards.module';
import { UsersModule } from '../users/users.module';
import { ProjectsModule } from '../projects/projects.module';
import { EventsModule } from '../events/events.module';

@Module({
  imports: [TypeOrmModule.forFeature([ProjectModule, Issue]), GuardsModule, UsersModule, ProjectsModule, EventsModule],
  controllers: [ModulesController],
  providers: [ModulesService],
  exports: [ModulesService],
})
export class ModulesModule {}
