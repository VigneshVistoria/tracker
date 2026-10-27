import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  BUILD_MAX,
  CLASSIFICATION_FIELDS,
  DISPUTE_TEXT_MAX,
  LIST_ITEM_MAX,
  LIST_MAX_COUNT,
  PM_DISPUTE_DECISIONS,
  PmDisputeDecision,
  TRIAGE_WORKING_DAYS_MAX,
} from '../defect-triage';

// Defect triage (2026-10-27) - see ../defect-triage.ts. The service checks
// the reason against the list, the comment's length and the ticket number.
export class DisputeDefectDto {
  @IsString({ message: 'Pick a reason.' })
  @MaxLength(LIST_ITEM_MAX)
  reason: string;

  @IsString({ message: 'A comment is required.' })
  @MaxLength(DISPUTE_TEXT_MAX)
  comment: string;

  @IsOptional()
  @IsInt({ message: 'The duplicate ticket number must be a number.' })
  duplicateOfTaskId?: number;
}

export class DecideDisputeDto {
  @IsIn(PM_DISPUTE_DECISIONS, { message: 'Pick a decision.' })
  decision: PmDisputeDecision;

  @IsOptional()
  @IsString()
  @MaxLength(DISPUTE_TEXT_MAX)
  comment?: string;

  // Required for 'reassigned'.
  @IsOptional()
  @IsInt()
  assigneeUserId?: number;
}

export class UpdateDefectClassificationDto {
  @IsOptional()
  @IsString()
  @MaxLength(LIST_ITEM_MAX)
  severity?: string;

  @IsOptional()
  @IsString()
  @MaxLength(LIST_ITEM_MAX)
  defectType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(LIST_ITEM_MAX)
  defectOrigin?: string;

  @IsOptional()
  @IsString()
  @MaxLength(BUILD_MAX)
  foundInBuild?: string;

  @IsOptional()
  @IsString()
  @MaxLength(LIST_ITEM_MAX)
  foundInEnvironment?: string;
}

export class SetDefectTriageSwitchDto {
  @IsBoolean()
  enabled: boolean;
}

export class DisputeReasonDto {
  @IsString()
  @MaxLength(LIST_ITEM_MAX)
  label: string;

  @IsBoolean()
  needsTicket: boolean;

  @IsBoolean()
  notLateTriage: boolean;
}

// The whole settings object is saved at once; the service trims, drops
// blanks and repeats, and keeps at least one item per list.
export class SaveDefectTriageSettingsDto {
  @IsArray()
  @ArrayMaxSize(LIST_MAX_COUNT)
  @IsString({ each: true })
  @MaxLength(LIST_ITEM_MAX, { each: true })
  severities: string[];

  @IsArray()
  @ArrayMaxSize(LIST_MAX_COUNT)
  @IsString({ each: true })
  @MaxLength(LIST_ITEM_MAX, { each: true })
  types: string[];

  @IsArray()
  @ArrayMaxSize(LIST_MAX_COUNT)
  @IsString({ each: true })
  @MaxLength(LIST_ITEM_MAX, { each: true })
  origins: string[];

  @IsArray()
  @ArrayMaxSize(LIST_MAX_COUNT)
  @IsString({ each: true })
  @MaxLength(LIST_ITEM_MAX, { each: true })
  environments: string[];

  @IsArray()
  @ArrayMaxSize(LIST_MAX_COUNT)
  @ValidateNested({ each: true })
  @Type(() => DisputeReasonDto)
  disputeReasons: DisputeReasonDto[];

  @IsArray()
  @IsIn(CLASSIFICATION_FIELDS as unknown as string[], { each: true })
  requiredFields: string[];

  @IsInt()
  @Min(1)
  @Max(TRIAGE_WORKING_DAYS_MAX)
  triageWorkingDays: number;
}
