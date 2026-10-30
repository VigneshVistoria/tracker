import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { UAT_RESULTS, UatResult } from '../client-measures';

// L3-L5 - see ../client-measures.ts.
export class SetClientPriorityTierDto {
  // 1 = the first (most urgent) tier; null clears it.
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  tier: number | null;
}

export class RecordUatResultDto {
  @IsIn(UAT_RESULTS)
  result: UatResult;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  note?: string | null;
}

export class SaveReleaseSatisfactionDto {
  @IsArray()
  @ArrayMaxSize(5)
  scores: number[];

  @IsOptional()
  @IsString()
  @MaxLength(120)
  respondent?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  comment?: string | null;
}
