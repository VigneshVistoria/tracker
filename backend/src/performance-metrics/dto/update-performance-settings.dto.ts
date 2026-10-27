import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

// Every field optional - only what's sent changes. The time zone is
// checked against Node's time zone data in PerformanceMetricsService, and
// at least one day of the week must stay a working day.
export class UpdatePerformanceSettingsDto {
  @IsOptional()
  @IsString()
  timeZone?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(30)
  dueDateWorkingDays?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6, { message: 'At least one day of the week must be a working day.' })
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  weekendDays?: number[];

  @IsOptional()
  @IsInt()
  @Min(7)
  @Max(366)
  windowDays?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  minSample?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  onTimeOkPercent?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  changesOkPerTask?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  qaAcceptanceOkPercent?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  excludedStatuses?: string[];

  @IsOptional()
  @IsBoolean()
  includePeerReview?: boolean;

  @IsOptional()
  @IsBoolean()
  countEscalatedAsDecided?: boolean;

  @IsOptional()
  @IsBoolean()
  alreadyDatedCountsOnTime?: boolean;

  @IsOptional()
  @IsBoolean()
  othersSettingDateCountsOnTime?: boolean;

  // Non-Compliance Report "Flagged" thresholds.
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  lateToQaFlagCount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  rejectionRateFlagPercent?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  rejectionRateMinSubmissions?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  escalationFlagCount?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  vagueNotesFlagCount?: number;
}
