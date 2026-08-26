import { IsIn } from 'class-validator';

export class ShowstopperReviewDecisionDto {
  @IsIn(['confirm', 'downgrade'], { message: 'Decision must be "confirm" or "downgrade"' })
  decision: 'confirm' | 'downgrade';
}
