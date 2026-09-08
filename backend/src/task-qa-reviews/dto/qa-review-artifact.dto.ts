import { IsEnum, IsUrl, ValidatorConstraint, ValidatorConstraintInterface } from 'class-validator';
import { QaArtifactType } from '../task-qa-review-qa-artifact.entity';

export class QaReviewArtifactDto {
  @IsEnum(QaArtifactType, { message: 'A valid Artifact Type is required.' })
  type: QaArtifactType;

  @IsUrl({}, { message: 'Each selected Artifact Type needs a valid URL.' })
  url: string;
}

// Same reasoning as UniqueTaskArtifactTypesConstraint - the frontend's
// per-row Artifact Type dropdowns can't stop someone editing two rows to
// the same type, so it's enforced here instead.
@ValidatorConstraint({ name: 'UniqueQaArtifactTypes', async: false })
export class UniqueQaArtifactTypesConstraint implements ValidatorConstraintInterface {
  validate(items: unknown): boolean {
    if (!Array.isArray(items)) return true; // let @IsArray report the real problem
    const types = items.map((item) => item?.type);
    return new Set(types).size === types.length;
  }

  defaultMessage(): string {
    return 'Each Artifact Type can only be selected once per submission.';
  }
}
