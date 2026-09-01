import { IsString, IsOptional, IsInt, IsIn, IsDateString, MinLength } from 'class-validator';
import { PROJECT_PLAN_STATUSES, ProjectPlanStatus } from '../project-plan-entry.entity';

export class CreateProjectPlanEntryDto {
  // Required - must reference a real Project, validated in the service
  // via ProjectsService.findOne(). projectName isn't accepted from the
  // client - it's always resolved server-side from that lookup, so it
  // can't drift from the real Project name.
  @IsInt()
  projectId: number;

  @IsOptional()
  @IsInt()
  moduleId?: number;

  @IsOptional()
  @IsString()
  moduleName?: string;

  // "Phase" - see ProjectPlanEntry's class comment.
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

  @IsDateString()
  startDate: string;

  @IsDateString()
  targetDate: string;

  @IsOptional()
  @IsIn(PROJECT_PLAN_STATUSES)
  status?: ProjectPlanStatus;
}
