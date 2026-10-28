import { ArrayMaxSize, ArrayMinSize, IsArray, IsOptional, IsString, MaxLength, MinLength, Validate, ValidateNested } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { QaReviewArtifactDto, UniqueQaArtifactTypesConstraint } from './qa-review-artifact.dto';
import { QA_NOT_READY_REASON_MAX, QA_NOT_READY_REASONS_MAX_COUNT } from '../../tasks/qa-not-ready';

// QA Reject as "Not ready for testing" (2026-10-27) - both a reason from
// the editable list and a comment are required (the service checks the
// reason is on the list and the comment has real text, at least
// QA_NOT_READY_COMMENT_MIN characters once the rich text is stripped).
export class QaNotReadyTaskDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'Pick a reason.' })
  @MinLength(1, { message: 'Pick a reason.' })
  @MaxLength(QA_NOT_READY_REASON_MAX)
  reason: string;

  @IsString({ message: 'A comment is required.' })
  @MinLength(1, { message: 'A comment is required.' })
  comment: string;

  // Optional, same as on a rejection.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QaReviewArtifactDto)
  @Validate(UniqueQaArtifactTypesConstraint)
  artifacts?: QaReviewArtifactDto[];
}

// The editable reasons list (Admin -> QA Review Settings).
export class SetQaNotReadyReasonsDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'Keep at least one reason.' })
  @ArrayMaxSize(QA_NOT_READY_REASONS_MAX_COUNT)
  @IsString({ each: true })
  @MaxLength(QA_NOT_READY_REASON_MAX, { each: true })
  reasons: string[];

  // Performance Tracking S4: the label (new or unchanged) of the reason
  // with the fixed "blocked by a dependency" code. Omitted = unchanged.
  // Ignored by the Test failed list.
  @IsOptional()
  @IsString()
  @MaxLength(QA_NOT_READY_REASON_MAX)
  dependencyReason?: string;
}
