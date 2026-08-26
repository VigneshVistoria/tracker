import { IsEnum, IsInt, IsOptional, Min } from 'class-validator';
import { OverduePenaltyMode } from '../performance-scoring-config.entity';

export class UpdatePerformanceScoringConfigDto {
  @IsOptional()
  @IsEnum(OverduePenaltyMode)
  overduePenaltyMode?: OverduePenaltyMode;

  @IsOptional()
  @IsInt()
  @Min(0)
  flatOverduePenaltyPercent?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  qaFailedWeightPercent?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  reopenedWeightPercent?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  lateDependencyWeightPercent?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  earlyCompletionBonusPercent?: number;
}
