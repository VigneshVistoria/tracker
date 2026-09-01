import { IsString, MinLength, IsOptional, IsInt, IsBoolean, IsDateString, IsUrl, IsIn, IsNumber, Min } from 'class-validator';
import { TASK_STATUSES, TaskStatus } from '../../task-status-config/task-status-percent.entity';

export class CreateTaskDto {
  @IsInt()
  projectId: number;

  @IsInt()
  moduleId: number;

  @IsInt()
  phaseId: number;

  @IsInt()
  sprintId: number;

  @IsString()
  @MinLength(1, { message: 'Task description is required.' })
  description: string;

  @IsInt()
  assigneeUserId: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  estimatedHours?: number;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsBoolean()
  dependency?: boolean;

  @IsOptional()
  @IsString()
  dependencyDescription?: string;

  @IsOptional()
  @IsInt()
  dependencyOwnerUserId?: number;

  @IsOptional()
  @IsUrl()
  feedbackLink?: string;

  // Only honored if estimatedHours and dueDate are both supplied here too -
  // same gating rule that applies to PATCH /tasks/:id/status, checked in
  // TasksService.create().
  @IsOptional()
  @IsIn(TASK_STATUSES)
  status?: TaskStatus;
}
