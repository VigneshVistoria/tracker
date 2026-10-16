import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { TIMELINE_STATUSES, MAX_MODULE_LENGTH, MAX_PHASE_LENGTH, MAX_TEAM_NAME_LENGTH, TimelineStatus } from '../project-timeline-rules';

// Project Timeline (2026-10-16). Row/file limits match the test case and
// issue bulk imports (5,000 rows, base64 JSON body - no multer).
const MAX_ROWS = 5000;
// Generous on raw file text - the real length checks (with a readable
// message per row) happen in the preview, not here.
const MAX_RAW_CELL = 2000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class ParseTimelineFileDto {
  @IsIn(['csv', 'xlsx'])
  format: 'csv' | 'xlsx';

  @IsString()
  @MinLength(1, { message: 'File content is required' })
  fileBase64: string;
}

// A file row as parsed (or as the PM fixed it in the preview) - strings.
export class TimelineRawRowDto {
  @IsInt()
  @Min(1)
  rowNumber: number;

  @IsOptional() @IsString() @MaxLength(MAX_RAW_CELL) module?: string;
  @IsOptional() @IsString() @MaxLength(MAX_RAW_CELL) phase?: string;
  @IsOptional() @IsString() @MaxLength(MAX_RAW_CELL) team?: string;
  @IsOptional() @IsString() @MaxLength(MAX_RAW_CELL) status?: string;
  @IsOptional() @IsString() @MaxLength(MAX_RAW_CELL) startDate?: string;
  @IsOptional() @IsString() @MaxLength(MAX_RAW_CELL) endDate?: string;

  // false = the PM unticked the row in the preview.
  @IsOptional()
  @IsBoolean()
  include?: boolean;
}

export class PreviewTimelineImportDto {
  @IsArray()
  @ArrayMaxSize(MAX_ROWS)
  @ValidateNested({ each: true })
  @Type(() => TimelineRawRowDto)
  rows: TimelineRawRowDto[];
}

export class ApplyTimelineImportDto extends PreviewTimelineImportDto {
  // Saved rows the file no longer has that the PM chose to delete - each
  // must be one of the preview's "missing" rows. Default: keep them.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ROWS)
  @IsInt({ each: true })
  deleteIds?: number[];
}

// "Save changes" - one batch, saved in one transaction or not at all.
// Dates are YYYY-MM-DD or null; teamId null clears the team.
export class TimelineRowCreateDto {
  // The page's temporary id for the new row, echoed back in errors.
  @IsOptional() @IsString() @MaxLength(50) tempId?: string;

  @IsString() @MaxLength(MAX_MODULE_LENGTH) module: string;
  @IsString() @MaxLength(MAX_PHASE_LENGTH) phase: string;
  @IsOptional() @IsInt() teamId?: number | null;
  @IsIn(TIMELINE_STATUSES as unknown as string[]) status: TimelineStatus;
  @IsOptional() @Matches(ISO_DATE, { message: 'startDate must be YYYY-MM-DD' }) startDate?: string | null;
  @IsOptional() @Matches(ISO_DATE, { message: 'endDate must be YYYY-MM-DD' }) endDate?: string | null;
  @IsOptional() @IsInt() sortOrder?: number;
}

// Only the fields present are changed. `version` is the one the page loaded.
export class TimelineRowUpdateDto {
  @IsInt() id: number;
  @IsInt() version: number;

  @IsOptional() @IsString() @MaxLength(MAX_MODULE_LENGTH) module?: string;
  @IsOptional() @IsString() @MaxLength(MAX_PHASE_LENGTH) phase?: string;
  @IsOptional() @IsInt() teamId?: number | null;
  @IsOptional() @IsIn(TIMELINE_STATUSES as unknown as string[]) status?: TimelineStatus;
  @IsOptional() @Matches(ISO_DATE, { message: 'startDate must be YYYY-MM-DD' }) startDate?: string | null;
  @IsOptional() @Matches(ISO_DATE, { message: 'endDate must be YYYY-MM-DD' }) endDate?: string | null;
  @IsOptional() @IsInt() sortOrder?: number;
}

export class TimelineRowDeleteDto {
  @IsInt() id: number;
  @IsInt() version: number;
}

export class SaveTimelineChangesDto {
  @IsOptional() @IsArray() @ArrayMaxSize(MAX_ROWS) @ValidateNested({ each: true }) @Type(() => TimelineRowCreateDto)
  creates?: TimelineRowCreateDto[];

  @IsOptional() @IsArray() @ArrayMaxSize(MAX_ROWS) @ValidateNested({ each: true }) @Type(() => TimelineRowUpdateDto)
  updates?: TimelineRowUpdateDto[];

  @IsOptional() @IsArray() @ArrayMaxSize(MAX_ROWS) @ValidateNested({ each: true }) @Type(() => TimelineRowDeleteDto)
  deletes?: TimelineRowDeleteDto[];
}

export class CreateTimelineTeamDto {
  @IsString()
  @MinLength(1, { message: 'Team name is required' })
  @MaxLength(MAX_TEAM_NAME_LENGTH)
  name: string;
}

export class ResetTimelineBaselineDto {
  @IsString()
  @MinLength(1, { message: 'A reason is required to reset the baseline.' })
  @MaxLength(1000)
  reason: string;
}
