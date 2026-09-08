import { IsArray, IsOptional, IsString, MinLength, Validate, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { QaReviewArtifactDto, UniqueQaArtifactTypesConstraint } from './qa-review-artifact.dto';

export class QaRejectTaskDto {
  @IsString()
  @MinLength(1, { message: 'A comment explaining the rejection is required.' })
  comment: string;

  // Optional, same as QaApproveTaskDto's artifacts field - QA can justify
  // a rejection with evidence (e.g. a Bug Report link) but isn't required
  // to.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QaReviewArtifactDto)
  @Validate(UniqueQaArtifactTypesConstraint)
  artifacts?: QaReviewArtifactDto[];
}
