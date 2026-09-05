import {
  ArrayMinSize,
  IsArray,
  IsEnum,
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
}
