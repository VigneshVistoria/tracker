import { ArrayMaxSize, ArrayMinSize, ArrayNotEmpty, IsArray, IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { UserRole } from '../../users/user.entity';
import {
  BLOCKER_LAG_CLOCK_STARTS,
  BlockerLagClockStart,
  CHASE_ROLE_CHOICES,
  NON_COMPLIANCE_DISPLAYS,
  NonComplianceDisplay,
  REQUEST_SOURCES,
  RequestSource,
  THRESHOLD_LIMITS,
} from '../performance-tracking';

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

  @IsOptional()
  @IsInt()
  @Min(THRESHOLD_LIMITS.reopenWindowDays[0])
  @Max(THRESHOLD_LIMITS.reopenWindowDays[1])
  reopenWindowDays?: number;

  // B1 (2026-10-30). Band order is checked in the service (bandProblem).
  @IsOptional()
  @IsIn(BLOCKER_LAG_CLOCK_STARTS)
  blockerLagClockStart?: BlockerLagClockStart;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(4)
  @ArrayMaxSize(4)
  @IsInt({ each: true })
  percentBands?: number[];

  @IsOptional()
  @IsArray()
  @ArrayMinSize(4)
  @ArrayMaxSize(4)
  @IsInt({ each: true })
  breachBands?: number[];

  @IsOptional()
  @IsIn(NON_COMPLIANCE_DISPLAYS)
  nonComplianceDisplay?: NonComplianceDisplay;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(REQUEST_SOURCES, { each: true })
  requestSources?: RequestSource[];

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(CHASE_ROLE_CHOICES, { each: true })
  chaseRoles?: UserRole[];

  @IsOptional()
  @IsInt()
  @Min(THRESHOLD_LIMITS.chaseCooldownHours[0])
  @Max(THRESHOLD_LIMITS.chaseCooldownHours[1])
  chaseCooldownHours?: number;

  @IsOptional()
  @IsInt()
  @Min(THRESHOLD_LIMITS.progressNoteMin[0])
  @Max(THRESHOLD_LIMITS.progressNoteMin[1])
  progressNoteMin?: number;
}

export class SetPerformanceTrackingSwitchDto {
  @IsBoolean()
  enabled: boolean;
}
