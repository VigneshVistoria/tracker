import { IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

// PM/Admin reverting a mistaken QA decision - a short reason is required
// and goes to the audit log and the reverted round (2026-10-13).
export const REVERT_REASON_MIN = 3;
export const REVERT_REASON_MAX = 500;

export class QaRevertDecisionDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(REVERT_REASON_MIN, { message: `Enter a reason (at least ${REVERT_REASON_MIN} characters).` })
  @MaxLength(REVERT_REASON_MAX)
  reason: string;
}
