import { IsInt, IsOptional } from 'class-validator';

// Team Tasks - PM edits the Assignee on an already-assigned (or even
// still-Backlog) task directly, PATCH /tasks/:id/reassign. Unlike
// AssignTaskDto (Task Backlog's Stage 2 kickoff, assigneeUserId required),
// assigneeUserId is optional/nullable here - sending null clears the
// Assignee, which sends the task back to the Task Backlog exactly like an
// unassigned task there (see TasksService.reassignTeamTask()).
export class ReassignTeamTaskDto {
  @IsOptional()
  @IsInt()
  assigneeUserId?: number | null;
}
