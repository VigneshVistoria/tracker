import { IsString, MinLength, MaxLength, IsOptional, IsArray, IsBoolean, IsInt, ArrayMaxSize } from 'class-validator';

// No fieldType - it's fixed once created (see TestCaseCustomField).
export class UpdateTestCaseCustomFieldDto {
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Name is required.' })
  @MaxLength(60)
  name?: string;

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
