import { IsDateString, IsInt, IsOptional, IsString, MinLength, MaxLength } from 'class-validator';
import { TASK_DEPENDENCY_TICKET_TITLE_MAX_LENGTH } from '../task-dependency-ticket-title.constants';

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

  @IsInt()
  ownerUserId: number;

  // Performance Tracking S3: required while the project's tracking is ON,
  // refused while it is OFF.
  @IsOptional()
  @IsDateString({ strict: true })
  needByDate?: string;
}
