import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

// Performance Tracking S4b - see ../task-fields.ts. Lengths and who may
// change what are checked in TaskFieldsService.
export class UpdateTaskFieldsDto {
  @IsOptional()
  @IsString()
  @MaxLength(20)
  taskType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  requirementId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  clientImpact?: string;
}

export class ImprovementDecisionDto {
  @IsIn(['accepted', 'declined'])
  decision: 'accepted' | 'declined';

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}
