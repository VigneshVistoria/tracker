import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Project } from './project.entity';
import { ProjectsService } from './projects.service';
import { ProjectsController } from './projects.controller';
import { GuardsModule } from '../common/guards.module';
import { UsersModule } from '../users/users.module';
import { EventsModule } from '../events/events.module';

@Module({
  imports: [TypeOrmModule.forFeature([Project]), GuardsModule, UsersModule, EventsModule],
  controllers: [ProjectsController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
