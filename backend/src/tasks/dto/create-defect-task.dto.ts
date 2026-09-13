import { IsString, MinLength, IsInt, IsArray, IsOptional, ValidateNested, Validate } from 'class-validator';
import { Type } from 'class-transformer';
import { QaReviewArtifactDto, UniqueQaArtifactTypesConstraint } from '../../task-qa-reviews/dto/qa-review-artifact.dto';

// Create Defect (QA only, TasksController.createDefect) - always a fresh,
// standalone ticket assigned straight to a Developer, skipping the Task
// Backlog entirely. Project/Module/Phase stay required, same as every
// other task (needed for scoping/KPI/dashboards) - only difference from
// CreateTaskDto is assigneeUserId being required up front instead of set
// later via PATCH /tasks/:id/assign.
export class CreateDefectTaskDto {
  @IsInt()
  projectId: number;

  @IsInt()
  moduleId: number;

  @IsInt()
  phaseId: number;

  @IsString()
  @MinLength(1, { message: 'Task description is required.' })
  description: string;

  @IsInt()
  assigneeUserId: number;

  // Optional evidence QA attaches when filing the defect - reuses the
  // exact same DTO/validator TaskQaReviewsService's QA-side artifacts use
  // (QaApproveTaskDto/QaRejectTaskDto), same reasoning: optional, unlike
  // the Assignee's mandatory submission-time artifacts.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QaReviewArtifactDto)
  @Validate(UniqueQaArtifactTypesConstraint)
  artifacts?: QaReviewArtifactDto[];
}
