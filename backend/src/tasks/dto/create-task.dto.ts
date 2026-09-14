import { IsString, MinLength, MaxLength, IsInt, IsOptional, IsBoolean, IsEnum } from 'class-validator';
import { TASK_TITLE_MAX_LENGTH } from '../task-title.constants';
import { TaskPriority } from '../task-priority.enum';

// Stage 1 (Task Backlog creation, Program Manager only) - deliberately
// just the Project -> Module -> Phase chain plus Title/Description. No
// Assignee/Estimated Hours/Due Date here anymore - those are entered at
// later stages (assignment, then the Assignee's own My Tasks entry) via
// PATCH /tasks/:id/assign and PATCH /tasks/:id.
export class CreateTaskDto {
  @IsInt()
  projectId: number;

  @IsInt()
  moduleId: number;

  @IsInt()
  phaseId: number;

  // Short human-readable name shown everywhere the task is listed (My
  // Tasks, Team Tasks, Task Backlog, QA Review, notifications, ...) -
  // see ProjectTask.title. No uniqueness constraint, same as Issue.title.
  @IsString()
  @MinLength(1, { message: 'Title is required.' })
  @MaxLength(TASK_TITLE_MAX_LENGTH, { message: `Title must be ${TASK_TITLE_MAX_LENGTH} characters or fewer.` })
  title: string;

  @IsString()
  @MinLength(1, { message: 'Task description is required.' })
  description: string;

  // Opt-in alternative to QA review - see ProjectTask.peerReviewEnabled.
  // Defaults to false when omitted (TasksService.create()).
  @IsOptional()
  @IsBoolean()
  peerReviewEnabled?: boolean;

  // Program Manager only - enforced by ROLES_ALLOWED_TO_CREATE_TASKS on
  // this same endpoint, so no separate check is needed here. Left
  // undefined/omitted means "Not Set", never auto-assigned - see
  // ProjectTask.priority.
  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;
}
