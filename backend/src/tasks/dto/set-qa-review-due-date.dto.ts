import { IsDateString } from 'class-validator';

// Dedicated DTO for PATCH /tasks/:id/qa-review-due-date - kept separate
// from UpdateTaskDto on purpose, same reasoning as SetPeerReviewFlagDto:
// the general task edit path (PM/Assignee, canEdit()) is never touched by
// this feature, and this one endpoint is the only place
// qaReviewDueDate can be changed by hand, gated to QA/Program
// Manager/Admin (see TasksController).
export class SetQaReviewDueDateDto {
  @IsDateString()
  qaReviewDueDate: string;
}
