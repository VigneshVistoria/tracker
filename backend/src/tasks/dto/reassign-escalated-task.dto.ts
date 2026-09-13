import { IsInt } from 'class-validator';

// PM reassigns an escalated task to a Developer (any Developer, not
// necessarily the original assignee) - PATCH /tasks/:id/escalation-reassign.
export class ReassignEscalatedTaskDto {
  @IsInt()
  assigneeUserId: number;
}
