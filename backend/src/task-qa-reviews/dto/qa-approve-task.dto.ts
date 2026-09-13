import { IsArray, IsOptional, IsString, Validate, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { QaReviewArtifactDto, UniqueQaArtifactTypesConstraint } from './qa-review-artifact.dto';

export class QaApproveTaskDto {
  // Unlike QaRejectTaskDto's comment, this is never required - an
  // approval needs no justification, but QA can leave a note if they
  // want one on the record. No @MinLength since an empty/omitted comment
  // is the expected common case here.
  @IsOptional()
  @IsString()
  comment?: string;

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
