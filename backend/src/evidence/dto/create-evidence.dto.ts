import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  Validate,
  ValidateNested,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { EvidenceType } from '../evidence.entity';

export class CreateEvidenceItemDto {
  @IsEnum(EvidenceType, { message: 'A valid Artifact Type is required.' })
  type: EvidenceType;

  @IsUrl({}, { message: 'Each selected Artifact Type needs a valid URL.' })
  url: string;

  @IsOptional()
  @IsString()
  comments?: string;
}

// The multi-select on the frontend can't itself prevent picking the same
// Artifact Type twice in one submission (each checkbox is independent
// state) - enforced here instead, since two rows of the same type in one
// batch would just be a confusing duplicate, not a meaningful "two
// screenshots" case (submit those as a second, separate submission).
@ValidatorConstraint({ name: 'UniqueArtifactTypes', async: false })
class UniqueArtifactTypesConstraint implements ValidatorConstraintInterface {
  validate(items: unknown): boolean {
    if (!Array.isArray(items)) return true; // let @IsArray report the real problem
    const types = items.map((item) => item?.type);
    return new Set(types).size === types.length;
  }

  defaultMessage(): string {
    return 'Each Artifact Type can only be selected once per submission.';
  }
}

export class CreateEvidenceDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'Select at least one Artifact Type.' })
  @ValidateNested({ each: true })
  @Type(() => CreateEvidenceItemDto)
  @Validate(UniqueArtifactTypesConstraint)
  items: CreateEvidenceItemDto[];
}
