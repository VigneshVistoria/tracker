import { IsString, MinLength, MaxLength, IsOptional, IsEnum, IsArray, IsBoolean, IsInt, ArrayMaxSize } from 'class-validator';
import { CustomFieldType } from '../test-case-custom-field.entity';

export class CreateTestCaseCustomFieldDto {
  @IsString()
  @MinLength(1, { message: 'Name is required.' })
  @MaxLength(60)
  name: string;

  @IsEnum(CustomFieldType)
  fieldType: CustomFieldType;

  // Dropdown choices - required (at least one) for Dropdown, ignored for
  // every other type.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  options?: string[];

  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}
