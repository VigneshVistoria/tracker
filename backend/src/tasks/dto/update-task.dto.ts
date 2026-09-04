import { IsString, IsOptional, IsInt, IsDateString, IsNumber, Min } from 'class-validator';

// General field edits - deliberately excludes `status`, which is now
// fully auto-computed by task events (task creation, QA submit/approve/
// reject) and never settable through this or any other endpoint. Also
// excludes bulk/single assignment, which goes through PATCH /tasks/:id/
// assign and PATCH /tasks/bulk-assign instead so assignment gets its own
// Program-Manager-only gating and its own TASK_ASSIGNED audit action -
// TasksService.update() rejects assigneeUserId here to prevent that check
// being bypassed.
//
// projectId/moduleId/phaseId/description are "backlog fields" - only
// Program Manager may set them (enforced in TasksService.update());
// estimatedHours/dueDate are the Assignee's own Stage 2 fields, each
// locked to a one-time entry for the Assignee once set (Program Manager
// can always re-edit either one, no lock applies to PM's own edits).
// Admin has view-only access to Tasks, same as Executive - neither can
// reach any of these fields.
export class UpdateTaskDto {
  @IsOptional()
  @IsInt()
  projectId?: number;

  @IsOptional()
  @IsInt()
  moduleId?: number;

  @IsOptional()
  @IsInt()
  phaseId?: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  estimatedHours?: number;

  @IsOptional()
  @IsDateString()
  dueDate?: string;
}
