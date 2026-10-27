import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { TaskArtifactType } from '../task-qa-review.entity';
import { CHECKLIST_ITEMS, MIN_TEXT_LENGTH_MAX } from '../../tasks/submission-checklist';
import { LIST_ITEM_MAX, LIST_MAX_COUNT } from '../../tasks/defect-triage';

// Submission checklist settings (defect triage Stage 2, 2026-10-27) - the
// whole object is saved at once; the service trims, drops blanks and
// repeats, and keeps at least one root cause.
export class RootCauseDto {
  @IsString()
  @MaxLength(LIST_ITEM_MAX)
  label: string;

  @IsBoolean()
  needsNote: boolean;
}

export class RequiredChecklistItemsDto {
  @IsArray()
  @IsIn(CHECKLIST_ITEMS, { each: true })
  defect: string[];

  @IsArray()
  @IsIn(CHECKLIST_ITEMS, { each: true })
  task: string[];
}

export class SaveSubmissionChecklistSettingsDto {
  @IsArray()
  @ArrayMaxSize(LIST_MAX_COUNT)
  @ValidateNested({ each: true })
  @Type(() => RootCauseDto)
  rootCauses: RootCauseDto[];

  @IsArray()
  @IsIn(Object.values(TaskArtifactType), { each: true })
  linkArtifactTypes: string[];

  @IsArray()
  @IsIn(Object.values(TaskArtifactType), { each: true })
  evidenceArtifactTypes: string[];

  @ValidateNested()
  @Type(() => RequiredChecklistItemsDto)
  required: RequiredChecklistItemsDto;

  @IsInt()
  @Min(1)
  @Max(MIN_TEXT_LENGTH_MAX)
  minTextLength: number;
}

export class SetSubmissionChecklistSwitchDto {
  @IsBoolean()
  enabled: boolean;
}
