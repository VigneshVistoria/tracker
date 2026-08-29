import { IsString, IsOptional, IsInt, IsEnum, IsBoolean, IsDateString } from 'class-validator';
import { Priority } from '../../common/priority.enum';
import { DependencyImpactLevel } from '../dependency.entity';

// General field edits (owner reassignment, priority/date changes, etc.) -
// deliberately excludes `status`, which goes through PATCH
// /dependencies/:id/status instead so status transitions get their own
// audit entry and resolvedAt/escalatedAt side effects.
export class UpdateDependencyDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  blockingReason?: string;

  @IsOptional()
  @IsString()
  requestedTeam?: string;

  @IsOptional()
  @IsInt()
  ownerUserId?: number;

  @IsOptional()
  @IsString()
  ownerEmail?: string;

  @IsOptional()
  @IsEnum(Priority)
  priority?: Priority;

  @IsOptional()
  @IsDateString()
  requiredByDate?: string;

  @IsOptional()
  @IsInt()
  releaseId?: number;

  @IsOptional()
  @IsString()
  businessJustification?: string;

  @IsOptional()
  @IsEnum(DependencyImpactLevel)
  impactLevel?: DependencyImpactLevel;

  @IsOptional()
  @IsBoolean()
  blocking?: boolean;

  @IsOptional()
  @IsInt()
  estimatedDelayDays?: number;
}
