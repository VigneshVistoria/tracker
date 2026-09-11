import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsString,
  IsUrl,
  Min,
  MinLength,
  Validate,
  ValidateNested,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TaskArtifactType } from '../../task-qa-reviews/task-qa-review.entity';

// Same shape as QaSubmitTaskArtifactDto (task-qa-reviews/dto/qa-submit-task.dto.ts)
// - not imported directly since that file's uniqueness validator isn't
// exported, and duplicating this small DTO keeps this module fully
// independent of task-qa-reviews' internals.
export class PeerReviewSubmitArtifactDto {
  @IsEnum(TaskArtifactType, { message: 'A valid Artifact Type is required.' })
  type: TaskArtifactType;

  @IsUrl({}, { message: 'Each selected Artifact Type needs a valid URL.' })
  url: string;
}

@ValidatorConstraint({ name: 'UniquePeerReviewArtifactTypes', async: false })
class UniquePeerReviewArtifactTypesConstraint implements ValidatorConstraintInterface {
  validate(items: unknown): boolean {
    if (!Array.isArray(items)) return true; // let @IsArray report the real problem
    const types = items.map((item) => item?.type);
    return new Set(types).size === types.length;
  }

  defaultMessage(): string {
    return 'Each Artifact Type can only be selected once per submission.';
  }
}

// Same mandatory Resolution + >=1 Artifact + Actual Hours requirement as
// QaSubmitTaskDto, plus the one Peer-Review-specific field: the Developer
// the Assignee picked as reviewer. Self-selection is blocked in
// PeerReviewsService.submit(), not here, since it needs the current user.
export class SubmitPeerReviewDto {
  @IsString()
  @MinLength(1, { message: 'Resolution is required.' })
  resolution: string;

  @IsNumber()
  @Min(0, { message: 'Actual Hours must be zero or more.' })
  actualHours: number;

  @IsArray()
  @ArrayMinSize(1, { message: 'Select at least one Artifact Type.' })
  @ValidateNested({ each: true })
  @Type(() => PeerReviewSubmitArtifactDto)
  @Validate(UniquePeerReviewArtifactTypesConstraint)
  artifacts: PeerReviewSubmitArtifactDto[];

  @IsInt()
  reviewerUserId: number;
}
