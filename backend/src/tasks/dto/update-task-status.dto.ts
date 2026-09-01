import { IsIn } from 'class-validator';
import { TASK_STATUSES, TaskStatus } from '../../task-status-config/task-status-percent.entity';

export class UpdateTaskStatusDto {
  @IsIn(TASK_STATUSES)
  status: TaskStatus;
}
