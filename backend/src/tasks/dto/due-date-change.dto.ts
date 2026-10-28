import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';
import { DUE_DATE_REASON_MAX } from '../due-date-change';

// The minimum length is checked in the service (after trimming) so the
// message can say how many characters are missing.

// Assignee: the one free set or confirmation (same date = confirm).
export class CommitDueDateDto {
  @IsDateString({ strict: true })
  dueDate: string;
}

// Assignee: request a change. PM/Admin: change it directly.
export class DueDateChangeDto {
  @IsDateString({ strict: true })
  dueDate: string;

  @IsString()
  @MaxLength(DUE_DATE_REASON_MAX)
  reason: string;
}

export class DueDateDecisionDto {
  @IsOptional()
  @IsString()
  @MaxLength(DUE_DATE_REASON_MAX)
  note?: string;
}
