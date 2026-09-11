import { IsBoolean } from 'class-validator';

// Dedicated DTO for PATCH /tasks/:id/peer-review-flag - kept separate from
// UpdateTaskDto on purpose, so the general task edit path (PM/Assignee,
// canEdit()) is never touched by this feature; this one endpoint is the
// only place peerReviewEnabled can change on an existing task, gated to
// Program Manager or Admin (see TasksController).
export class SetPeerReviewFlagDto {
  @IsBoolean()
  peerReviewEnabled: boolean;
}
