import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TimeEntry } from './time-entry.entity';
import { TimeSheetsService } from './time-sheets.service';
import { TimeSheetsController } from './time-sheets.controller';
import { GuardsModule } from '../common/guards.module';
import { UsersModule } from '../users/users.module';
import { IssuesModule } from '../issues/issues.module';
import { ProjectsModule } from '../projects/projects.module';

@Module({
  imports: [TypeOrmModule.forFeature([TimeEntry]), GuardsModule, UsersModule, IssuesModule, ProjectsModule],
  controllers: [TimeSheetsController],
  providers: [TimeSheetsService],
})
export class TimeSheetsModule {}
