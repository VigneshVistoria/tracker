import { IsEnum } from 'class-validator';
import { DependencyStatus } from '../dependency.entity';

export class UpdateDependencyStatusDto {
  @IsEnum(DependencyStatus, {
    message:
      'Status must be one of: Open, Under Review, Assigned, In Progress, Resolved, Closed, Blocked, Escalated',
  })
  status: DependencyStatus;
}
