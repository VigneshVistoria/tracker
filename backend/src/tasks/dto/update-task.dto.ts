import { IsString, IsOptional, IsInt, IsBoolean, IsDateString, IsUrl, IsNumber, Min } from 'class-validator';

// General field edits - deliberately excludes `status`, which goes
// through PATCH /tasks/:id/status instead so status changes get their
// own gating check and audit entry, same split as UpdateDependencyDto /
// UpdateProjectPlanEntryDto.
export class UpdateTaskDto {
  @IsOptional()
  @IsInt()
  projectId?: number;

  @IsOptional()
  @IsInt()
  moduleId?: number;

  @IsOptional()
  @IsInt()
  phaseId?: number;

  @IsOptional()
  @IsInt()
  sprintId?: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  assigneeUserId?: number;

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
}
