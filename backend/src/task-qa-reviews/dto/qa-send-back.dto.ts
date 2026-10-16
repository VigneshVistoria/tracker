import { IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

// PM/Admin pulling a task back from QA to the developer (2026-10-16) - a
// reason of at least 10 characters is required; it is shown to the
// developer on the task page and goes to the review history and audit.
// assigneeUserId: send it to a different developer (Program Manager only).
export const QA_SEND_BACK_REASON_MIN = 10;
export const QA_SEND_BACK_REASON_MAX = 1000;

export class QaSendBackDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(QA_SEND_BACK_REASON_MIN, { message: `Enter a reason (at least ${QA_SEND_BACK_REASON_MIN} characters).` })
  @MaxLength(QA_SEND_BACK_REASON_MAX)
  reason: string;

  @IsOptional()
  @IsInt()
  assigneeUserId?: number;
}
