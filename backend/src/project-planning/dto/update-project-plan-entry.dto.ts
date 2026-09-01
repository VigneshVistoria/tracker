import { IsString, IsOptional, IsInt, IsDateString } from 'class-validator';

// General field edits - deliberately excludes `status`, which goes
// through PATCH /project-planning/:id/status instead so status changes
// get their own audit entry, same split as UpdateDependencyDto.
export class UpdateProjectPlanEntryDto {
  @IsOptional()
  @IsInt()
  projectId?: number;

  @IsOptional()
  @IsInt()
  moduleId?: number;

  @IsOptional()
  @IsString()
  moduleName?: string;

  @IsOptional()
  @IsInt()
  sprintId?: number;

  @IsOptional()
  @IsString()
  sprintName?: string;

  @IsOptional()
  @IsInt()
  teamId?: number;

  @IsOptional()
  @IsString()
  teamName?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  targetDate?: string;
}
