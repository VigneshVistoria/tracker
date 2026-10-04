import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectTask } from '../tasks/project-task.entity';
import { TaskBlockingDefect } from '../tasks/task-blocking-defect.entity';
import { TaskDependencyTicket } from '../task-dependency-tickets/task-dependency-ticket.entity';
import { UsersModule } from '../users/users.module';
import { GuardsModule } from '../common/guards.module';
import { StatusReviewController } from './status-review.controller';
import { StatusReviewService } from './status-review.service';

@Module({
  imports: [TypeOrmModule.forFeature([ProjectTask, TaskDependencyTicket, TaskBlockingDefect]), UsersModule, GuardsModule],
  controllers: [StatusReviewController],
  providers: [StatusReviewService],
})
export class StatusReviewModule {}
