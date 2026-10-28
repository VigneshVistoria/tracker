import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TaskFlag } from './task-flag.entity';
import { TaskFlagsService } from './task-flags.service';
import { TaskFlagsController } from './task-flags.controller';
import { TasksModule } from '../tasks/tasks.module';
import { UsersModule } from '../users/users.module';
import { AuditModule } from '../audit/audit.module';
import { GuardsModule } from '../common/guards.module';

// Performance Tracking S3 (2026-10-28) - risk and blocker flags. The
// dependency needed-by date lives in TaskDependencyTicketsService.
@Module({
  imports: [TypeOrmModule.forFeature([TaskFlag]), TasksModule, UsersModule, AuditModule, GuardsModule],
  controllers: [TaskFlagsController],
  providers: [TaskFlagsService],
})
export class TaskFlagsModule {}
