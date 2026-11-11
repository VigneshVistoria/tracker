import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { UserRole } from '../../users/user.entity';
import { EXCUSE_NOTE_MAX, EXCUSE_REASON_MAX, MAX_EXCUSE_REASONS, MAX_TRACKED_SERIES, MEETING_EXCUSE_ROLE_CHOICES, MEETING_LIMITS } from '../meeting-attendance';

export class TrackedSeriesDto {
  @IsInt()
  organiserUserId: number;

  @IsString()
  @MinLength(1)
  @MaxLength(512)
  seriesId: string;

  @IsString()
  @MaxLength(255)
  subject: string;
}

// C6 settings - Admin only. Every field optional; the rest stay as saved.
export class UpdateMeetingAttendanceSettingsDto {
  @IsOptional()
  @IsBoolean()
  meetingAttendanceEnabled?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsInt({ each: true })
  meetingAttendanceProjectIds?: number[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsInt({ each: true })
  meetingOrganiserUserIds?: number[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_TRACKED_SERIES)
  @ValidateNested({ each: true })
  @Type(() => TrackedSeriesDto)
  meetingTrackedSeries?: TrackedSeriesDto[];

  @IsOptional()
  @IsInt()
  @Min(MEETING_LIMITS.meetingLateMinutes[0])
  @Max(MEETING_LIMITS.meetingLateMinutes[1])
  meetingLateMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(MEETING_LIMITS.meetingMinStayPercent[0])
  @Max(MEETING_LIMITS.meetingMinStayPercent[1])
  meetingMinStayPercent?: number;

  @IsOptional()
  @IsInt()
  @Min(MEETING_LIMITS.meetingMinSample[0])
  @Max(MEETING_LIMITS.meetingMinSample[1])
  meetingMinSample?: number;

  @IsOptional()
  @IsInt()
  @Min(MEETING_LIMITS.meetingImportDays[0])
  @Max(MEETING_LIMITS.meetingImportDays[1])
  meetingImportDays?: number;

  @IsOptional()
  @IsBoolean()
  meetingCountInScores?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_EXCUSE_REASONS)
  @IsString({ each: true })
  @MaxLength(EXCUSE_REASON_MAX + 20, { each: true })
  meetingExcuseReasons?: string[];

  @IsOptional()
  @IsArray()
  @IsIn(MEETING_EXCUSE_ROLE_CHOICES, { each: true })
  meetingExcuseRoles?: UserRole[];
}

// Decision 6 - the reason must be one of meetingExcuseReasons.
export class ExcuseAttendanceDto {
  @IsString()
  @MaxLength(EXCUSE_REASON_MAX)
  reason: string;

  @IsOptional()
  @IsString()
  @MaxLength(EXCUSE_NOTE_MAX)
  note?: string;
}
