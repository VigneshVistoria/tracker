import { IsString, MinLength } from 'class-validator';

// QA escalates the pending QA Feedback round to PM instead of Approve/
// Reject - a comment explaining why (unclear/unrelated resolution) is
// required, same as QaRejectTaskDto's rejection comment.
export class QaEscalateTaskDto {
  @IsString()
  @MinLength(1, { message: 'A comment explaining the escalation is required.' })
  comment: string;
}
