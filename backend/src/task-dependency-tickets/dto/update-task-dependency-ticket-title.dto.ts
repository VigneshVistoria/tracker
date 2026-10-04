import { IsString, MinLength, MaxLength } from 'class-validator';
import { TASK_DEPENDENCY_TICKET_TITLE_MAX_LENGTH } from '../task-dependency-ticket-title.constants';

// Title is the only editable field on a ticket - see
// TaskDependencyTicketsService.updateTitle() for who may edit it.
export class UpdateTaskDependencyTicketTitleDto {
  @IsString()
  @MinLength(1, { message: 'Dependency Title is required.' })
  @MaxLength(TASK_DEPENDENCY_TICKET_TITLE_MAX_LENGTH, {
    message: `Dependency Title must be ${TASK_DEPENDENCY_TICKET_TITLE_MAX_LENGTH} characters or fewer.`,
  })
  title: string;
}
