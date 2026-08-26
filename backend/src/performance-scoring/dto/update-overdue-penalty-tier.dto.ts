import { IsInt, IsOptional, Min } from 'class-validator';

export class UpdateOverduePenaltyTierDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  minDaysLate?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  maxDaysLate?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  penaltyPercent?: number;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}
