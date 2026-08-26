import { IsString, MinLength, IsOptional, IsInt, IsEnum } from 'class-validator';
import { Priority } from '../../common/priority.enum';
import { IssueCategory } from '../../issues/issue.entity';
import { TestCaseStatus } from '../test-case.entity';

export class UpdateTestCaseDto {
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Title is required' })
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  preconditions?: string;

  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Steps are required' })
  steps?: string;

  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Expected result is required' })
  expectedResult?: string;

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
  @IsEnum(TestCaseStatus)
  status?: TestCaseStatus;
}
