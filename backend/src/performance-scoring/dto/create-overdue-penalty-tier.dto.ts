import { IsInt, IsOptional, Min } from 'class-validator';

export class CreateOverduePenaltyTierDto {
  @IsInt()
  @Min(0)
  minDaysLate: number;

  // Omit for "and beyond" - the unbounded top tier.
  @IsOptional()
  @IsInt()
  @Min(0)
  maxDaysLate?: number;

  @IsInt()
  @Min(0)
  penaltyPercent: number;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}
