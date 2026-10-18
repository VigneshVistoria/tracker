import { IsEnum, IsInt, IsOptional, IsString, IsUrl, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { RETURN_TO_QA_REASON_MIN, RETURN_TO_QA_TEXT_MAX } from '../return-to-qa';
import { QaArtifactType } from '../../task-qa-reviews/task-qa-review-qa-artifact.entity';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

// PM: send a ticket back to QA. qaUserId is optional when a default QA
// exists (the defect's raiser / the task's last QA reviewer).
export class ReturnToQaDto {
  @Transform(trim)
  @IsString()
  @MinLength(RETURN_TO_QA_REASON_MIN, { message: `Enter a reason (at least ${RETURN_TO_QA_REASON_MIN} characters).` })
  @MaxLength(RETURN_TO_QA_TEXT_MAX)
  reason: string;

  @IsOptional()
  @IsInt()
  qaUserId?: number;
}

// QA: send it back to the developer, with an optional note.
export class ReturnToQaSendBackDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(RETURN_TO_QA_TEXT_MAX)
  note?: string;
}

// QA: add one evidence link to a defect.
export class AddDefectEvidenceDto {
  @IsEnum(QaArtifactType, { message: 'A valid Artifact Type is required.' })
  type: QaArtifactType;

  @Transform(trim)
  @IsUrl({}, { message: 'Enter a valid URL.' })
  url: string;
}
