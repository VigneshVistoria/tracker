import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

// Performance Tracking Q4 - see ../escaped-defect.ts.
export class UpdateEscapedDefectDto {
  @IsBoolean()
  foundInProduction: boolean;

  // null clears it.
  @IsOptional()
  @IsInt()
  @Min(1)
  escapedFromTaskId?: number | null;

  // YYYY-MM-DD; empty = from the Release Log.
  @IsOptional()
  @IsString()
  @MaxLength(10)
  productionReleaseDate?: string | null;
}
