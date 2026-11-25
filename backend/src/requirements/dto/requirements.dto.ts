import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';
import { FAIL_REASON_MAX, TEXT_MAX, TITLE_MAX } from '../requirements';

// Something other than spaces.
const NOT_BLANK = /\S/;
const NOT_BLANK_MSG = { message: '$property cannot be empty' };

export class SaveRequirementsSettingsDto {
  @IsBoolean()
  requirementsTree: boolean;
}

// Fail needs a reason of at least FAIL_REASON_MIN characters (checked in
// the service, so the message is the friendly one).
export class SaveCriterionResultDto {
  @IsIn(['pass', 'fail'])
  result: 'pass' | 'fail';

  @IsOptional()
  @IsString()
  @MaxLength(FAIL_REASON_MAX)
  note?: string;
}

// ---- Stage 2 ----

export class CreateEpicDto {
  @IsString()
  @Matches(NOT_BLANK, NOT_BLANK_MSG)
  @MaxLength(TITLE_MAX)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  srsSection?: string;
}

export class UpdateEpicDto {
  @IsOptional()
  @IsString()
  @Matches(NOT_BLANK, NOT_BLANK_MSG)
  @MaxLength(TITLE_MAX)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  srsSection?: string;
}

export class CreateStoryDto {
  @IsString()
  @Matches(NOT_BLANK, NOT_BLANK_MSG)
  @MaxLength(TITLE_MAX)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(TEXT_MAX)
  asA?: string;

  @IsOptional()
  @IsString()
  @MaxLength(TEXT_MAX)
  iWant?: string;

  @IsOptional()
  @IsString()
  @MaxLength(TEXT_MAX)
  soThat?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsInt({ each: true })
  requirementIds?: number[];
}

export class UpdateStoryDto {
  @IsOptional()
  @IsString()
  @Matches(NOT_BLANK, NOT_BLANK_MSG)
  @MaxLength(TITLE_MAX)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(TEXT_MAX)
  asA?: string;

  @IsOptional()
  @IsString()
  @MaxLength(TEXT_MAX)
  iWant?: string;

  @IsOptional()
  @IsString()
  @MaxLength(TEXT_MAX)
  soThat?: string;

  @IsOptional()
  @IsInt()
  epicId?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsInt({ each: true })
  requirementIds?: number[];
}

export class ApproveAtRiskDto {
  @IsString()
  @MaxLength(TEXT_MAX)
  reason: string;
}

export class CreateCriterionDto {
  @IsString()
  @Matches(NOT_BLANK, NOT_BLANK_MSG)
  @MaxLength(TEXT_MAX)
  text: string;
}

export class UpdateCriterionDto {
  @IsString()
  @Matches(NOT_BLANK, NOT_BLANK_MSG)
  @MaxLength(TEXT_MAX)
  text: string;
}

export class ReorderCriteriaDto {
  @IsArray()
  @ArrayMaxSize(200)
  @IsInt({ each: true })
  criterionIds: number[];
}

// Multipart form fields that come with the signed document.
export class ClientSignOffDto {
  @IsString()
  @Matches(NOT_BLANK, NOT_BLANK_MSG)
  @MaxLength(255)
  clientName: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'signedOn must be a date (YYYY-MM-DD)' })
  signedOn: string;
}

export class CreateClientItemDto {
  @IsString()
  @Matches(NOT_BLANK, NOT_BLANK_MSG)
  @MaxLength(TEXT_MAX)
  question: string;

  @IsOptional()
  @IsString()
  @MaxLength(TEXT_MAX)
  baseline?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  owner?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsInt({ each: true })
  storyIds?: number[];
}

export class UpdateClientItemDto {
  @IsOptional()
  @IsString()
  @Matches(NOT_BLANK, NOT_BLANK_MSG)
  @MaxLength(TEXT_MAX)
  question?: string;

  @IsOptional()
  @IsString()
  @MaxLength(TEXT_MAX)
  baseline?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  owner?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsInt({ each: true })
  storyIds?: number[];
}

export class CloseClientItemDto {
  @IsString()
  @MaxLength(TEXT_MAX)
  resolution: string;
}

const KINDS = ['dev', 'qa'];

export class LinkTicketDto {
  @IsInt()
  @Min(1)
  taskId: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2)
  @IsIn(KINDS, { each: true })
  kinds: Array<'dev' | 'qa'>;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsInt({ each: true })
  criterionIds?: number[];
}

export class MoveTicketDto {
  @IsInt()
  @Min(1)
  storyId: number;
}

export class MapTicketsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsInt({ each: true })
  taskIds: number[];

  @IsInt()
  @Min(1)
  storyId: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2)
  @IsIn(KINDS, { each: true })
  kinds: Array<'dev' | 'qa'>;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsInt({ each: true })
  criterionIds?: number[];
}

export class MapTicketsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  status?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  assigneeUserId?: number;

  @IsOptional()
  @IsIn(['all', 'mapped', 'unmapped'])
  mapped?: 'all' | 'mapped' | 'unmapped';
}
