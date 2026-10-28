import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';
import { THRESHOLD_LIMITS } from '../performance-tracking';

// Every field optional - only what's sent changes.
export class UpdatePerformanceTrackingSettingsDto {
  @IsOptional()
  @IsInt()
  @Min(THRESHOLD_LIMITS.baselineDays[0])
  @Max(THRESHOLD_LIMITS.baselineDays[1])
  baselineDays?: number;

  @IsOptional()
  @IsBoolean()
  notReadyDeclaredDependencyExempt?: boolean;

  @IsOptional()
  @IsInt()
  @Min(THRESHOLD_LIMITS.earlyWarningWorkingDays[0])
  @Max(THRESHOLD_LIMITS.earlyWarningWorkingDays[1])
  earlyWarningWorkingDays?: number;

  @IsOptional()
  @IsInt()
  @Min(THRESHOLD_LIMITS.dateMovesFlagCount[0])
  @Max(THRESHOLD_LIMITS.dateMovesFlagCount[1])
  dateMovesFlagCount?: number;

  @IsOptional()
  @IsInt()
  @Min(THRESHOLD_LIMITS.statusFreshWorkingDays[0])
  @Max(THRESHOLD_LIMITS.statusFreshWorkingDays[1])
  statusFreshWorkingDays?: number;

  @IsOptional()
  @IsInt()
  @Min(THRESHOLD_LIMITS.chasesPerTasks[0])
  @Max(THRESHOLD_LIMITS.chasesPerTasks[1])
  chasesPerTasks?: number;
}

export class SetPerformanceTrackingSwitchDto {
  @IsBoolean()
  enabled: boolean;
}
