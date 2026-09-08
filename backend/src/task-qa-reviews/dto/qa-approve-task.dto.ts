import { IsArray, IsOptional, Validate, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { QaReviewArtifactDto, UniqueQaArtifactTypesConstraint } from './qa-review-artifact.dto';

export class QaApproveTaskDto {
  // Optional, unlike the Assignee's submission-time artifacts - QA can
  // approve without attaching evidence, but the option is there for
  // whichever types are worth recording.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QaReviewArtifactDto)
  @Validate(UniqueQaArtifactTypesConstraint)
  artifacts?: QaReviewArtifactDto[];
}
