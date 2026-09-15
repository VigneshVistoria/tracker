import { IsString, MinLength, MaxLength, IsInt, IsOptional, IsBoolean, IsEnum } from 'class-validator';
import { TASK_TITLE_MAX_LENGTH } from '../task-title.constants';
import { TaskPriority } from '../task-priority.enum';

// Stage 1 (Task Backlog creation, Program Manager only) - just the
// Project -> Module -> Phase chain plus Title/Description/Assignee.
// Estimated Hours/Due Date still aren't here - those are entered at a
// later stage (the Assignee's own My Tasks entry) via PATCH /tasks/:id.
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

  // Optional - assign the task directly at creation instead of leaving it
  // in the Task Backlog for a separate assign step. Omitted/null keeps the
  // exact current behavior (unassigned). Any tenant user may be picked
  // (TasksService.create() validates existence only), same as the
  // existing assign/bulk-assign endpoints - the frontend's Create Task
  // form is the one that narrows the dropdown to the roles that actually
  // do task work (Developer, QA, Designer, DevOps, Client).
  @IsOptional()
  @IsInt()
  assigneeUserId?: number;

  // Program Manager only - enforced by ROLES_ALLOWED_TO_CREATE_TASKS on
  // this same endpoint, so no separate check is needed here. Left
  // undefined/omitted means "Not Set", never auto-assigned - see
  // ProjectTask.priority.
  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;
}
