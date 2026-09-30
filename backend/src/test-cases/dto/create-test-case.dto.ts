import { IsString, MinLength, IsOptional, IsInt, IsEnum, IsArray, IsObject } from 'class-validator';
import { Priority } from '../../common/priority.enum';
import { IssueCategory } from '../../issues/issue.entity';

export class CreateTestCaseDto {
  @IsString()
  @MinLength(1, { message: 'Title is required' })
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  preconditions?: string;

  @IsString()
  @MinLength(1, { message: 'Steps are required' })
  steps: string;

  @IsString()
  @MinLength(1, { message: 'Expected result is required' })
  expectedResult: string;

  @IsOptional()
  @IsEnum(Priority)
  priority?: Priority;

  @IsOptional()
  @IsEnum(IssueCategory)
  category?: IssueCategory;

  @IsOptional()
  @IsInt()
  projectId?: number;

  @IsOptional()
  @IsInt()
  moduleId?: number;

  @IsOptional()
  @IsInt()
  phaseId?: number;

  // Label ids from GET /labels. Replaces the whole set when sent.
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  labelIds?: number[];

  // Custom field values keyed by field id - see TestCase.customFields. On
  // update, only the keys sent are changed; null or '' clears a value.
  @IsOptional()
  @IsObject()
  customFields?: Record<string, unknown>;
}
