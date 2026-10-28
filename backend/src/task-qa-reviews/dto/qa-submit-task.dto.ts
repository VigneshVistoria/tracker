import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  Max,
  MaxLength,
  IsEnum,
  IsIn,
  IsNumber,
  IsString,
  IsUrl,
  Min,
  MinLength,
  Validate,
  ValidateNested,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TaskArtifactType } from '../task-qa-review.entity';
import { CHECKLIST_SHORT_MAX, CHECKLIST_TEXT_MAX, MAX_SELF_TEST_SCREENSHOTS } from '../../tasks/submission-checklist';

export class QaSubmitTaskArtifactDto {
  @IsEnum(TaskArtifactType, { message: 'A valid Artifact Type is required.' })
  type: TaskArtifactType;

  @IsUrl({}, { message: 'Each selected Artifact Type needs a valid URL.' })
  url: string;
}

// Same reasoning as Evidence's UniqueArtifactTypesConstraint - the
// frontend's per-row Artifact Type dropdowns can't stop someone editing
// two rows to the same type, so it's enforced here instead.
@ValidatorConstraint({ name: 'UniqueTaskArtifactTypes', async: false })
class UniqueTaskArtifactTypesConstraint implements ValidatorConstraintInterface {
  validate(items: unknown): boolean {
    if (!Array.isArray(items)) return true; // let @IsArray report the real problem
    const types = items.map((item) => item?.type);
    return new Set(types).size === types.length;
  }

  defaultMessage(): string {
    return 'Each Artifact Type can only be selected once per submission.';
  }
}

// Developer submission checklist (defect triage Stage 2, 2026-10-27) - only
// checked when the task's project has it on; see tasks/submission-checklist.ts.
export class SubmissionChecklistDto {
  @IsOptional()
  @IsString()
  @MaxLength(CHECKLIST_SHORT_MAX)
  rootCause?: string;

  @IsOptional()
  @IsString()
  @MaxLength(CHECKLIST_TEXT_MAX)
  rootCauseNote?: string;

  @IsOptional()
  @IsString()
  @MaxLength(CHECKLIST_TEXT_MAX)
  testSteps?: string;

  @IsOptional()
  @IsString()
  @MaxLength(CHECKLIST_TEXT_MAX)
  testData?: string;

  @IsOptional()
  @IsString()
  @MaxLength(CHECKLIST_TEXT_MAX)
  affectedAreas?: string;

  @IsOptional()
  @IsBoolean()
  noAreasAffected?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(CHECKLIST_SHORT_MAX)
  build?: string;

  @IsOptional()
  @IsString()
  @MaxLength(CHECKLIST_SHORT_MAX)
  environment?: string;

  @IsOptional()
  @IsBoolean()
  confirmedBuild?: boolean;

  // Screenshots pasted on the form, uploaded to the round right after.
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_SELF_TEST_SCREENSHOTS)
  selfTestScreenshots?: number;
}

// Performance Tracking S4 - a dependency already recorded on the task.
export class DeclaredDependencyRefDto {
  @IsIn(['ticket', 'blocker'])
  kind: 'ticket' | 'blocker';

  @IsInt()
  id: number;
}

// "Dependencies met?" - required on a tracked project (the service checks).
export class DependencyDeclarationDto {
  @IsBoolean()
  met: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  waitingOn?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DeclaredDependencyRefDto)
  waitingOnDependencies?: DeclaredDependencyRefDto[];
}

export class QaSubmitTaskDto {
  @IsString()
  @MinLength(1, { message: 'Resolution is required.' })
  resolution: string;

  // Feeds the KPI module's Hours Exceed % - required here since this is
  // the one Assignee-initiated action where they know total time spent.
  @IsNumber()
  @Min(0, { message: 'Actual Hours must be zero or more.' })
  actualHours: number;

  @IsArray()
  @ArrayMinSize(1, { message: 'Select at least one Artifact Type.' })
  @ValidateNested({ each: true })
  @Type(() => QaSubmitTaskArtifactDto)
  @Validate(UniqueTaskArtifactTypesConstraint)
  artifacts: QaSubmitTaskArtifactDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => SubmissionChecklistDto)
  checklist?: SubmissionChecklistDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => DependencyDeclarationDto)
  dependencies?: DependencyDeclarationDto;
}
