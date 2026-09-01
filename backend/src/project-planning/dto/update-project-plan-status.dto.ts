import { IsIn } from 'class-validator';
import { PROJECT_PLAN_STATUSES, ProjectPlanStatus } from '../project-plan-entry.entity';

export class UpdateProjectPlanStatusDto {
  @IsIn(PROJECT_PLAN_STATUSES)
  status: ProjectPlanStatus;
}
