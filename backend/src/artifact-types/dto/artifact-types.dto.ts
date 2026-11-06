import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { ARTIFACT_REQUIREMENTS } from '../artifact-type-rule.entity';
import { ARTIFACT_LABEL_MAX, ARTIFACT_TYPES_MAX } from '../artifact-types.service';

export class CreateArtifactTypeDto {
  @IsString()
  @MaxLength(ARTIFACT_LABEL_MAX)
  label: string;
}

export class UpdateArtifactTypeDto {
  @IsOptional()
  @IsString()
  @MaxLength(ARTIFACT_LABEL_MAX)
  label?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class ReorderArtifactTypesDto {
  @IsArray()
  @ArrayMaxSize(ARTIFACT_TYPES_MAX)
  @IsInt({ each: true })
  ids: number[];
}

export class ArtifactRuleDto {
  @IsInt()
  artifactTypeId: number;

  @IsIn(ARTIFACT_REQUIREMENTS)
  requirement: string;
}

export class SetArtifactRulesDto {
  @IsArray()
  @ArrayMaxSize(ARTIFACT_TYPES_MAX)
  @ValidateNested({ each: true })
  @Type(() => ArtifactRuleDto)
  rules: ArtifactRuleDto[];
}
