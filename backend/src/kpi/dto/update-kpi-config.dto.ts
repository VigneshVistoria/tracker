import { IsInt, IsNumber, IsOptional, Min } from 'class-validator';

export class UpdateKpiConfigDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  hoursExceedWeight?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  overdueWeight?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  targetMissWeight?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  qaRejectionWeight?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  outboundDependencyWeight?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  completionBonusWeight?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  completionBonusCap?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  excessiveRejectionThreshold?: number;
}
