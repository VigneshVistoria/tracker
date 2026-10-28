import { IsDateString, IsString, MaxLength } from 'class-validator';

// Performance Tracking S4 - PM/Admin "Reopen after Pass". The reason's
// minimum length is checked in the service (after trimming).
export class ReopenAfterPassDto {
  @IsString()
  @MaxLength(1000)
  reason: string;

  // The reopened work's proposed Due date - the assignee confirms it or
  // sets their own (a new commitment).
  @IsDateString({ strict: true })
  dueDate: string;
}
