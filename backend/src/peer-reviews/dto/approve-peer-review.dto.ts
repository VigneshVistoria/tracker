import { IsArray, IsOptional, Validate, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { QaReviewArtifactDto, UniqueQaArtifactTypesConstraint } from '../../task-qa-reviews/dto/qa-review-artifact.dto';

// Reuses QA's own optional-evidence artifact shape (task/QaArtifactType is
// generic evidence - test/build/screenshot/etc. - not QA-role-specific)
// rather than defining a parallel one, same reasoning as QaApproveTaskDto.
export class ApprovePeerReviewDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QaReviewArtifactDto)
  @Validate(UniqueQaArtifactTypesConstraint)
  artifacts?: QaReviewArtifactDto[];
}
