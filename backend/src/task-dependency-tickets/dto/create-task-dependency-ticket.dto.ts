import { IsDateString, IsInt, IsOptional, IsString, MinLength, MaxLength } from 'class-validator';
import { TASK_DEPENDENCY_TICKET_TITLE_MAX_LENGTH } from '../task-dependency-ticket-title.constants';

// Matches the ownerExternal column (varchar(200)).
export const DEPENDENCY_EXTERNAL_OWNER_MAX_LENGTH = 200;

export class CreateTaskDependencyTicketDto {
  @IsInt()
  parentTaskId: number;

  // See TaskDependencyTicket.title.
  @IsString()
  @MinLength(1, { message: 'Dependency Title is required.' })
  @MaxLength(TASK_DEPENDENCY_TICKET_TITLE_MAX_LENGTH, {
    message: `Dependency Title must be ${TASK_DEPENDENCY_TICKET_TITLE_MAX_LENGTH} characters or fewer.`,
  })
  title: string;

  @IsString()
  @MinLength(1, { message: 'Dependency Description is required.' })
  description: string;

  // Exactly one of ownerUserId / ownerExternal (checked in the service).
  @IsOptional()
  @IsInt()
  ownerUserId?: number;

  // Dependency tasks Stage 4 (2026-11-05): an owner outside the app, as
  // free text (no client-portal users). Such a ticket never gets a task.
  @IsOptional()
  @IsString()
  @MaxLength(DEPENDENCY_EXTERNAL_OWNER_MAX_LENGTH, {
    message: `External owner must be ${DEPENDENCY_EXTERNAL_OWNER_MAX_LENGTH} characters or fewer.`,
  })
  ownerExternal?: string;

  // Performance Tracking S3: required while the project's tracking is ON,
  // refused while it is OFF.
  @IsOptional()
  @IsDateString({ strict: true })
  needByDate?: string;
}
