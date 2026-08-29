import { IsString, IsOptional, IsInt, IsEnum, IsBoolean, IsDateString, MinLength } from 'class-validator';
import { Priority } from '../../common/priority.enum';
import { DependencyImpactLevel } from '../dependency.entity';

export class CreateDependencyDto {
  @IsString()
  @MinLength(1, { message: 'Title is required' })
  title: string;

  @IsString()
  @MinLength(1, { message: 'Description is required' })
  description: string;

  @IsString()
  @MinLength(1, { message: 'Blocking reason is required' })
  blockingReason: string;

  @IsString()
  @MinLength(1, { message: 'Requested team is required' })
  requestedTeam: string;

  // The dependency owner - who this is waiting on. Nullable on the entity
  // because the owning team member may not have an account yet (external
  // team), but their email is always required so there's someone to notify.
  @IsOptional()
  @IsInt()
  ownerUserId?: number;

  @IsString()
  @MinLength(1, { message: 'Owner email is required' })
  ownerEmail: string;

  @IsEnum(Priority)
  priority: Priority;

  @IsDateString()
  requiredByDate: string;

  // Section 4/5's mandatory link to a parent work item - enforced here by
  // being required, and validated against real issues in the service layer.
  @IsInt()
  impactedIssueId: number;

  @IsOptional()
  @IsInt()
  releaseId?: number;

  @IsString()
  @MinLength(1, { message: 'Business justification is required' })
  businessJustification: string;

  @IsEnum(DependencyImpactLevel)
  impactLevel: DependencyImpactLevel;

  @IsOptional()
  @IsBoolean()
  blocking?: boolean;

  @IsOptional()
  @IsInt()
  estimatedDelayDays?: number;
}
