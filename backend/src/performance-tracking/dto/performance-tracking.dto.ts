import { ArrayMaxSize, ArrayMinSize, ArrayNotEmpty, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
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

  // B4. People and the calendar are checked in the service.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsInt({ each: true })
  overrideUserIds?: number[];

  @IsOptional()
  @IsString()
  @MaxLength(60)
  calendarTimeZone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5)
  calendarWorkStart?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5)
  calendarWorkEnd?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @IsInt({ each: true })
  calendarWeekendDays?: number[];

  @IsOptional()
  @IsInt()
  @Min(THRESHOLD_LIMITS.responseTargetWorkingHours[0])
  @Max(THRESHOLD_LIMITS.responseTargetWorkingHours[1])
  responseTargetWorkingHours?: number;

  // Q4.
  @IsOptional()
  @IsInt()
  @Min(THRESHOLD_LIMITS.escapeWindowDays[0])
  @Max(THRESHOLD_LIMITS.escapeWindowDays[1])
  escapeWindowDays?: number;

  @IsOptional()
  @IsInt()
  @Min(THRESHOLD_LIMITS.escapedPerTasks[0])
  @Max(THRESHOLD_LIMITS.escapedPerTasks[1])
  escapedPerTasks?: number;

  // Q5. People and the rubric are checked in the service.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsInt({ each: true })
  techReviewerUserIds?: number[];

  @IsOptional()
  @IsInt()
  @Min(THRESHOLD_LIMITS.techReviewsPerMonth[0])
  @Max(THRESHOLD_LIMITS.techReviewsPerMonth[1])
  techReviewsPerMonth?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  techReviewCriteria?: string[];

  // C3. The time is checked in the service.
  @IsOptional()
  @IsInt()
  @Min(THRESHOLD_LIMITS.weeklyReportDeadlineDay[0])
  @Max(THRESHOLD_LIMITS.weeklyReportDeadlineDay[1])
  weeklyReportDeadlineDay?: number;

  @IsOptional()
  @IsString()
  @MaxLength(5)
  weeklyReportDeadlineTime?: string;

  @IsOptional()
  @IsInt()
  @Min(THRESHOLD_LIMITS.weeklyReportMinLength[0])
  @Max(THRESHOLD_LIMITS.weeklyReportMinLength[1])
  weeklyReportMinLength?: number;

  // C4.
  @IsOptional()
  @IsInt()
  @Min(THRESHOLD_LIMITS.handoverFieldMin[0])
  @Max(THRESHOLD_LIMITS.handoverFieldMin[1])
  handoverFieldMin?: number;
}

export class SetPerformanceTrackingSwitchDto {
  @IsBoolean()
  enabled: boolean;
}

// B2: Admin "Recalculate now" - today by default, or a past night.
export class RecalculateMetricsDto {
  @IsOptional()
  @IsDateString({ strict: true })
  snapshotDate?: string;
}
