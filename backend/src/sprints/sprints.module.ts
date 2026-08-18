import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Sprint } from './sprint.entity';
import { Issue } from '../issues/issue.entity';
import { SprintsService } from './sprints.service';
import { SprintsController } from './sprints.controller';
import { GuardsModule } from '../common/guards.module';
import { ProjectsModule } from '../projects/projects.module';
import { EventsModule } from '../events/events.module';

@Module({
  imports: [TypeOrmModule.forFeature([Sprint, Issue]), GuardsModule, ProjectsModule, EventsModule],
  controllers: [SprintsController],
  providers: [SprintsService],
  exports: [SprintsService],
})
export class SprintsModule {}
