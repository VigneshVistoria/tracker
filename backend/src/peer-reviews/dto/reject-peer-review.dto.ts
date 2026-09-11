import { IsArray, IsOptional, IsString, MinLength, Validate, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { QaReviewArtifactDto, UniqueQaArtifactTypesConstraint } from '../../task-qa-reviews/dto/qa-review-artifact.dto';

export class RejectPeerReviewDto {
  @IsString()
  @MinLength(1, { message: 'A comment explaining the rejection is required.' })
  comment: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QaReviewArtifactDto)
  @Validate(UniqueQaArtifactTypesConstraint)
  artifacts?: QaReviewArtifactDto[];
}
